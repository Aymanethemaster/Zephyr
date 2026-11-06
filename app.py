import ipaddress
import json
import logging
import math
import os
import re
import threading
import time
from collections import OrderedDict
from urllib.parse import urlparse
import requests
from requests.adapters import HTTPAdapter
from flask import Flask, request, jsonify, send_from_directory, make_response

# Configure application logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('zephyr')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Serve static files from /static; index.html lives in project root for dual static/Flask compatibility
app = Flask(__name__, static_folder='static', static_url_path='/static')

# Allowed origins for cross-origin API calls (comma-separated env var, e.g. "https://zephyr.example.com")
# When unset/empty, same-origin requests and permissive local development continue working seamlessly.
ALLOWED_ORIGINS = {
    origin.strip().rstrip('/').lower()
    for origin in os.environ.get('ALLOWED_ORIGINS', '').split(',')
    if origin.strip()
}


@app.before_request
def verify_api_origin():
    """Guard /api/* endpoints against unauthorized cross-origin abuse when ALLOWED_ORIGINS is configured."""
    if request.path.startswith('/api/') and request.path != '/api/health':
        if not ALLOWED_ORIGINS:
            return None

        # Modern browsers send Sec-Fetch-Site; allow same-origin and same-site requests automatically
        sec_fetch_site = request.headers.get('Sec-Fetch-Site', '').lower()
        if sec_fetch_site in ('same-origin', 'same-site', 'none'):
            return None

        raw_origin = request.headers.get('Origin') or request.headers.get('Referer')
        if not raw_origin:
            return jsonify({'error': 'Forbidden: missing origin or referer header'}), 403

        parsed = urlparse(raw_origin)
        if parsed.scheme and parsed.netloc:
            origin_normalized = f"{parsed.scheme}://{parsed.netloc}".lower()
        else:
            origin_normalized = raw_origin.strip().rstrip('/').lower()

        if origin_normalized not in ALLOWED_ORIGINS and parsed.netloc.lower() not in ALLOWED_ORIGINS:
            logger.warning(f"Blocked unauthorized cross-origin API request from: {raw_origin}")
            return jsonify({'error': 'Forbidden: unauthorized cross-origin proxy request'}), 403

    return None


@app.after_request
def set_security_headers(response):
    """Add baseline security headers and Content Security Policy (ISSUE-019)."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = 'geolocation=(self)'

    is_secure = (
        request.is_secure
        or request.headers.get('X-Forwarded-Proto', '').lower() == 'https'
    )
    if is_secure:
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload'

    csp_directives = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https: blob:",
        "connect-src 'self' https://*.open-meteo.com https://photon.komoot.io https://api.bigdatacloud.net https://get.geojs.io",
        "manifest-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
    ]
    if is_secure:
        csp_directives.append("upgrade-insecure-requests")

    response.headers['Content-Security-Policy'] = "; ".join(csp_directives) + ";"
    return response


# Thread-safe bounded LRU Cache supporting Stale-While-Revalidate (ISSUE-BE-01)
# Each entry is stored as (fresh_until, stale_until, data)
MAX_CACHE_SIZE = 2000
_CACHE = OrderedDict()
_CACHE_LOCK = threading.Lock()

CACHE_TTL_WEATHER = 600    # 10 minutes
CACHE_TTL_GEOCODING = 3600 # 1 hour
CACHE_TTL_AQI = 900        # 15 minutes

# Shared Open-Meteo request definition (single source of truth with static/js/weather-params.json)
_PARAMS_PATH = os.path.join(BASE_DIR, 'static', 'js', 'weather-params.json')
_DEFAULT_OPEN_METEO_PARAMS = {
    'current': [
        'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
        'is_day', 'precipitation', 'weather_code', 'cloud_cover',
        'pressure_msl', 'surface_pressure', 'wind_speed_10m',
        'wind_direction_10m', 'wind_gusts_10m', 'uv_index'
    ],
    'hourly': [
        'temperature_2m', 'relative_humidity_2m', 'dew_point_2m',
        'apparent_temperature', 'precipitation_probability', 'precipitation',
        'weather_code', 'pressure_msl', 'visibility', 'wind_speed_10m',
        'wind_direction_10m', 'uv_index', 'is_day'
    ],
    'daily': [
        'weather_code', 'temperature_2m_max', 'temperature_2m_min',
        'apparent_temperature_max', 'apparent_temperature_min', 'sunrise',
        'sunset', 'uv_index_max', 'precipitation_sum', 'precipitation_hours',
        'precipitation_probability_max', 'wind_speed_10m_max'
    ],
    'forecast_days': 8,
}


def _load_open_meteo_params():
    try:
        with open(_PARAMS_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if all(k in data for k in ('current', 'hourly', 'daily')):
            return data
    except Exception as e:
        logger.warning(f"Could not read {_PARAMS_PATH}: {e}; using defaults")
    return _DEFAULT_OPEN_METEO_PARAMS


OPEN_METEO_PARAMS = _load_open_meteo_params()

# Sliding-window per-IP rate limit for API proxy routes (ISSUE-BE-02)
MAX_RATE_BUCKETS = 5000
RATE_LIMIT_REQUESTS = 60
RATE_LIMIT_WINDOW = 60  # seconds
_RATE_BUCKETS = OrderedDict()
_RATE_LOCK = threading.Lock()

# Number of trusted reverse-proxy hops when reading X-Forwarded-For (default 0 unless BEHIND_PROXY/RENDER/HEROKU set)
_RAW_HOPS = os.environ.get('PROXY_HOPS')
if _RAW_HOPS is not None and _RAW_HOPS.isdigit():
    _PROXY_HOPS = int(_RAW_HOPS)
elif os.environ.get('BEHIND_PROXY') == '1' or os.environ.get('RENDER') or os.environ.get('HEROKU'):
    _PROXY_HOPS = 1
else:
    _PROXY_HOPS = 0


def _get_client_ip():
    """Return client IP safely, inspecting X-Forwarded-For from right-to-left only when behind a trusted proxy."""
    if _PROXY_HOPS > 0:
        xff = request.headers.get('X-Forwarded-For', '')
        if xff:
            parts = [p.strip() for p in xff.split(',') if p.strip()]
            if parts:
                idx = max(0, len(parts) - _PROXY_HOPS)
                return parts[idx]
    return request.remote_addr or '127.0.0.1'


def _is_local_or_private_ip(ip_str):
    """Check whether an IP string is loopback, private (RFC1918/RFC4193), link-local, or invalid."""
    if not ip_str or ip_str in ('localhost', 'unknown'):
        return True
    try:
        addr = ipaddress.ip_address(ip_str)
        return (
            addr.is_loopback
            or addr.is_private
            or addr.is_link_local
            or addr.is_reserved
            or addr.is_multicast
            or addr.is_unspecified
        )
    except ValueError:
        return True


def _check_rate_limit(ip):
    """Return True if request is within rate limit, False if throttled."""
    now = time.time()
    cutoff = now - RATE_LIMIT_WINDOW
    with _RATE_LOCK:
        # Opportunistically prune inactive IP buckets from the LRU head (oldest activity first)
        stale_ips = []
        for oldest_ip, oldest_bucket in _RATE_BUCKETS.items():
            if not oldest_bucket or oldest_bucket[-1] < cutoff:
                stale_ips.append(oldest_ip)
            else:
                break
        for stale_ip in stale_ips:
            del _RATE_BUCKETS[stale_ip]

        bucket = _RATE_BUCKETS.get(ip)
        if bucket is not None:
            _RATE_BUCKETS.move_to_end(ip)
        else:
            if len(_RATE_BUCKETS) >= MAX_RATE_BUCKETS:
                # All existing buckets are actively within the current rate-limit window;
                # reject new unseen IPs during flood instead of evicting tracked attacker buckets.
                return False
            bucket = []
            _RATE_BUCKETS[ip] = bucket

        # Prune timestamps outside the current sliding window for this IP
        while bucket and bucket[0] < cutoff:
            bucket.pop(0)

        if len(bucket) >= RATE_LIMIT_REQUESTS:
            return False

        bucket.append(now)
        return True


def _get_from_cache(key):
    """Retrieve fresh item from cache and update LRU order, or return None if expired/missing."""
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if entry is not None:
            fresh_until, stale_until, data = entry
            now = time.time()
            if now < fresh_until:
                _CACHE.move_to_end(key)
                return data
            elif now >= stale_until:
                del _CACHE[key]
        return None


def _get_fresh_cached(key):
    """Return fresh cached data and update LRU order without deleting stale entries."""
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if entry is not None:
            fresh_until, _stale_until, data = entry
            if time.time() < fresh_until:
                _CACHE.move_to_end(key)
                return data
        return None


def _set_to_cache(key, data, ttl, stale_ttl=None):
    """Store item in bounded LRU cache with TTL and optional stale-while-revalidate window."""
    now = time.time()
    fresh_until = now + ttl
    if stale_ttl is not None:
        stale_until = now + stale_ttl
    else:
        stale_until = fresh_until + (ttl * 2 if ttl > 0 else 0)
    with _CACHE_LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
        elif len(_CACHE) >= MAX_CACHE_SIZE:
            _CACHE.popitem(last=False)
        _CACHE[key] = (fresh_until, stale_until, data)


def _set_to_cache_stale(key, data, fresh_ttl=600, stale_ttl=7200):
    """Store weather payload with a fresh TTL (10m) and extended stale fallback window (2h)."""
    _set_to_cache(key, data, fresh_ttl, stale_ttl=stale_ttl)


class CircuitBreaker:
    """Thread-safe circuit breaker to prevent cascading timeouts when upstream APIs degrade."""
    def __init__(self, failure_threshold=4, recovery_timeout=30.0):
        self.threshold = failure_threshold
        self.recovery = recovery_timeout
        self.failures = 0
        self.state = 'CLOSED'
        self.last_change = time.time()
        self._lock = threading.Lock()
        self._half_open_in_flight = False
        self._half_open_started = 0.0

    def allow_request(self):
        with self._lock:
            now = time.time()
            if self.state == 'OPEN':
                if now - self.last_change > self.recovery:
                    self.state = 'HALF_OPEN'
                    self._half_open_in_flight = True
                    self._half_open_started = now
                    return True
                return False
            elif self.state == 'HALF_OPEN':
                # Allow only a single canary probe while HALF_OPEN to prevent stampedes,
                # unless the canary has been stuck longer than the recovery timeout.
                if self._half_open_in_flight and (now - self._half_open_started < self.recovery):
                    return False
                self._half_open_in_flight = True
                self._half_open_started = now
                return True
            return True

    def record_success(self):
        with self._lock:
            self.failures = 0
            self.state = 'CLOSED'
            self._half_open_in_flight = False

    def record_failure(self):
        with self._lock:
            self.failures += 1
            self._half_open_in_flight = False
            if self.failures >= self.threshold or self.state == 'HALF_OPEN':
                self.state = 'OPEN'
                self.last_change = time.time()


_WEATHER_BREAKER = CircuitBreaker()


def clean_location_name(name_str):
    """Clean multilingual names (e.g., 'Tangier طنجة' -> 'Tangier') while preserving non-Latin scripts."""
    if not name_str:
        return ''
    first = str(name_str).split('/')[0].split(';')[0].strip()
    # Extract leading Latin/extended-Latin segment if present (e.g. "Frankfurt (Oder)" or "Tangier طنجة")
    match = re.match(r'^[\w\s\-\.\'\(\)\u00C0-\u024F]+', first, re.ASCII)
    if match and len(match.group(0).strip()) >= 2:
        return match.group(0).strip()
    return first


def parse_coordinates(lat, lon):
    """Validate and round latitude/longitude coordinates to 4 decimal places."""
    if lat is None or lon is None or lat == '' or lon == '':
        return None, None
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (ValueError, TypeError):
        return None, None

    if not (math.isfinite(lat_f) and math.isfinite(lon_f)):
        return None, None

    if not (-90.0 <= lat_f <= 90.0 and -180.0 <= lon_f <= 180.0):
        return None, None

    return round(lat_f, 4), round(lon_f, 4)


# Shared HTTP session with connection pooling (ISSUE-BE-03)
_HTTP_SESSION = requests.Session()
_ADAPTER = HTTPAdapter(pool_connections=16, pool_maxsize=32, max_retries=0)
_HTTP_SESSION.mount('https://', _ADAPTER)
_HTTP_SESSION.mount('http://', _ADAPTER)


def _http_get(url, params=None, timeout=5.0, headers=None):
    """Perform an outbound GET request via the pooled session with redirects disabled."""
    return _HTTP_SESSION.get(
        url,
        params=params,
        timeout=timeout,
        headers=headers,
        allow_redirects=False
    )


@app.route('/')
def index():
    """Serve the main weather application interface with fresh cache headers."""
    response = make_response(send_from_directory(BASE_DIR, 'index.html'))
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


@app.route('/sw.js')
def service_worker():
    """Serve the PWA Service Worker at root scope with strict no-cache headers."""
    response = make_response(send_from_directory(BASE_DIR, 'sw.js', mimetype='application/javascript'))
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


@app.route('/static/icons/<path:filename>')
def serve_weather_icon(filename):
    """Serve local weather SVG icons with revalidation-friendly caching."""
    icons_dir = os.path.join(BASE_DIR, 'static', 'icons')
    response = make_response(send_from_directory(icons_dir, filename))
    response.headers['Cache-Control'] = 'public, max-age=3600, stale-while-revalidate=86400'
    return response


@app.route('/api/health')
def health_check():
    """Lightweight health check endpoint for uptime monitoring."""
    return jsonify({'status': 'healthy', 'service': 'zephyr-weather-app'}), 200


@app.route('/api/geocoding')
def geocoding():
    """Search for cities and locations using Open-Meteo Geocoding API with Photon fuzzy fallback."""
    ip = _get_client_ip()
    if not _check_rate_limit(ip):
        return jsonify({'error': 'Too many requests. Please slow down.'}), 429

    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'results': []})
    query = query[:100]  # Bound query length to prevent abuse

    cache_key = f"geo:{query.lower()}"
    cached = _get_from_cache(cache_key)
    if cached:
        return jsonify(cached)

    results = []
    seen_coords = set()
    open_meteo_failed = False
    photon_failed = False

    # 1. Primary: Open-Meteo Geocoding API (fast, exact prefix match)
    try:
        resp = _http_get(
            'https://geocoding-api.open-meteo.com/v1/search',
            params={
                'name': query,
                'count': 8,
                'language': 'en',
                'format': 'json'
            },
            timeout=5
        )
        resp.raise_for_status()
        data = resp.json()
        if 'results' in data and isinstance(data['results'], list):
            for item in data['results']:
                coord_key = f"{round(item.get('latitude', 0), 2)},{round(item.get('longitude', 0), 2)}"
                if coord_key not in seen_coords:
                    seen_coords.add(coord_key)
                    results.append({
                        'id': item.get('id'),
                        'name': item.get('name'),
                        'latitude': item.get('latitude'),
                        'longitude': item.get('longitude'),
                        'country': item.get('country', ''),
                        'country_code': item.get('country_code', ''),
                        'admin1': item.get('admin1', ''),
                        'timezone': item.get('timezone', 'auto')
                    })
    except requests.RequestException as e:
        open_meteo_failed = True
        logger.warning(f"Open-Meteo geocoding warning for query '{query}': {e}")

    # 2. Secondary / Fuzzy Fallback: Photon (OpenStreetMap) handles typos & alternate spellings
    if len(results) < 2:
        try:
            p_resp = _http_get(
                'https://photon.komoot.io/api/',
                params={'q': query, 'limit': 8},
                headers={'User-Agent': 'ZephyrWeatherApp/1.0'},
                timeout=4.5
            )
            p_resp.raise_for_status()
            p_data = p_resp.json()
            for feat in p_data.get('features', []):
                props = feat.get('properties', {})
                osm_key = props.get('osm_key', '')
                osm_val = props.get('osm_value', '')
                # Skip non-geographic POIs (e.g. bars, cafes, breweries named after cities)
                if osm_key in ('amenity', 'craft', 'shop', 'tourism', 'leisure') and osm_val in (
                    'brewery', 'bar', 'cafe', 'pub', 'restaurant', 'hotel', 'hostel', 'nightclub', 'supermarket'
                ):
                    continue
                coords = feat.get('geometry', {}).get('coordinates', [])
                if len(coords) >= 2:
                    lon, lat = round(float(coords[0]), 4), round(float(coords[1]), 4)
                    coord_key = f"{round(lat, 2)},{round(lon, 2)}"
                    if coord_key not in seen_coords:
                        seen_coords.add(coord_key)
                        raw_name = props.get('name') or props.get('city') or props.get('district') or query
                        raw_country = props.get('country', '')
                        raw_admin = props.get('state') or props.get('county') or ''
                        results.append({
                            'id': props.get('osm_id', f"osm_{lat}_{lon}"),
                            'name': clean_location_name(raw_name),
                            'latitude': lat,
                            'longitude': lon,
                            'country': clean_location_name(raw_country),
                            'country_code': (props.get('countrycode') or '').upper(),
                            'admin1': clean_location_name(raw_admin),
                            'timezone': 'auto'
                        })
        except requests.RequestException as e:
            photon_failed = True
            logger.warning(f"Photon fallback geocoding warning for query '{query}': {e}")

    # Distinguish total upstream outage from a genuine zero-result search
    if not results and open_meteo_failed and photon_failed:
        return jsonify({'error': 'Upstream geocoding providers unavailable', 'results': []}), 502

    result_payload = {'results': results}
    if results:
        _set_to_cache(cache_key, result_payload, CACHE_TTL_GEOCODING)
    return jsonify(result_payload)


@app.route('/api/ip-location')
def get_ip_location():
    """Approximate user location via IP address when browser GPS is unavailable or denied."""
    ip = _get_client_ip()
    if not _check_rate_limit(ip):
        return jsonify({'error': 'Too many requests. Please slow down.'}), 429

    is_local_ip = _is_local_or_private_ip(ip)
    cache_key = f"iploc:{ip}"
    cached = _get_from_cache(cache_key)
    if cached:
        return jsonify(cached)

    # 1. Primary: BigDataCloud IP Geocoding (Forward client IP in production)
    try:
        bdc_params = {'localityLanguage': 'en'}
        if not is_local_ip:
            bdc_params['ip'] = ip
        resp = _http_get(
            'https://api.bigdatacloud.net/data/reverse-geocode-client',
            params=bdc_params,
            timeout=4
        )
        resp.raise_for_status()
        data = resp.json()
        lat = data.get('latitude')
        lon = data.get('longitude')
        if lat is not None and lon is not None:
            city = (
                data.get('city')
                or data.get('locality')
                or data.get('principalSubdivision')
                or data.get('countryName')
                or 'Current Location'
            )
            admin1 = data.get('principalSubdivision', '')
            payload = {
                'name': city,
                'admin1': admin1 if admin1 != city else '',
                'country': data.get('countryName', ''),
                'country_code': data.get('countryCode', ''),
                'latitude': round(float(lat), 4),
                'longitude': round(float(lon), 4),
                'timezone': 'auto'
            }
            _set_to_cache(cache_key, payload, CACHE_TTL_GEOCODING)
            return jsonify(payload)
    except (requests.RequestException, ValueError, TypeError) as e:
        logger.warning(f"BigDataCloud IP location warning for IP '{ip}': {e}")

    # 2. Secondary: GeoJS IP Lookup Fallback
    try:
        g_url = f'https://get.geojs.io/v1/ip/geo/{ip}.json' if not is_local_ip else 'https://get.geojs.io/v1/ip/geo.json'
        g_resp = _http_get(g_url, timeout=3.5)
        g_resp.raise_for_status()
        g_data = g_resp.json()
        lat = g_data.get('latitude')
        lon = g_data.get('longitude')
        if lat is not None and lon is not None:
            city = g_data.get('city') or g_data.get('region') or g_data.get('country') or 'Current Location'
            admin1 = g_data.get('region', '')
            payload = {
                'name': city,
                'admin1': admin1 if admin1 != city else '',
                'country': g_data.get('country', ''),
                'country_code': g_data.get('country_code', ''),
                'latitude': round(float(lat), 4),
                'longitude': round(float(lon), 4),
                'timezone': g_data.get('timezone', 'auto')
            }
            _set_to_cache(cache_key, payload, CACHE_TTL_GEOCODING)
            return jsonify(payload)
    except (requests.RequestException, ValueError, TypeError) as e:
        logger.warning(f"GeoJS IP location warning for IP '{ip}': {e}")

    return jsonify({'error': 'Unable to determine location from IP'}), 404


@app.route('/api/reverse-geocode')
def reverse_geocode():
    """Resolve latitude and longitude into a human-readable city name."""
    ip = _get_client_ip()
    if not _check_rate_limit(ip):
        return jsonify({'error': 'Too many requests. Please slow down.'}), 429

    lat = request.args.get('lat')
    lon = request.args.get('lon')
    if not lat or not lon:
        return jsonify({'error': 'Missing coordinates'}), 400

    lat_f, lon_f = parse_coordinates(lat, lon)
    if lat_f is None or lon_f is None:
        return jsonify({'error': 'Invalid coordinates format'}), 400

    cache_key = f"revgeo:{lat_f:.3f}:{lon_f:.3f}"
    cached = _get_from_cache(cache_key)
    if cached:
        return jsonify(cached)

    try:
        resp = _http_get(
            'https://api.bigdatacloud.net/data/reverse-geocode-client',
            params={
                'latitude': lat_f,
                'longitude': lon_f,
                'localityLanguage': 'en'
            },
            timeout=4
        )
        resp.raise_for_status()
        data = resp.json()

        city = (
            data.get('city')
            or data.get('locality')
            or data.get('principalSubdivision')
            or data.get('countryName')
            or 'Current Location'
        )
        admin1 = data.get('principalSubdivision', '')
        payload = {
            'name': city,
            'admin1': admin1 if admin1 != city else '',
            'country': data.get('countryName', ''),
            'country_code': data.get('countryCode', ''),
            'latitude': lat_f,
            'longitude': lon_f
        }
        _set_to_cache(cache_key, payload, CACHE_TTL_GEOCODING)
        return jsonify(payload)
    except requests.RequestException as e:
        logger.warning(f"Reverse geocode fallback for ({lat_f}, {lon_f}): {e}")
        return jsonify({
            'name': f"{lat_f:.2f}°, {lon_f:.2f}°",
            'admin1': '',
            'country': '',
            'country_code': '',
            'latitude': lat_f,
            'longitude': lon_f
        })


@app.route('/api/weather')
def get_weather():
    """Fetch current, hourly, and 7-day forecast weather data from Open-Meteo."""
    lat = request.args.get('lat')
    lon = request.args.get('lon')
    timezone = request.args.get('timezone', 'auto')

    if not lat or not lon:
        return jsonify({'error': 'Latitude and longitude are required'}), 400

    lat_f, lon_f = parse_coordinates(lat, lon)
    if lat_f is None or lon_f is None:
        return jsonify({'error': 'Invalid coordinates format'}), 400

    timezone = str(timezone).strip()[:50] or 'auto'
    if not re.match(r'^[A-Za-z0-9_/+\-]+$', timezone):
        timezone = 'auto'

    cache_key = f"weather:{lat_f}:{lon_f}:{timezone}"

    # Fast path: serve fresh cached weather before consuming rate-limit tokens
    fresh_cached = _get_fresh_cached(cache_key)
    if fresh_cached is not None:
        return jsonify(fresh_cached)

    ip = _get_client_ip()
    if not _check_rate_limit(ip):
        return jsonify({'error': 'Too many requests. Please slow down.'}), 429

    # Check if we have a stale candidate in case upstream is down or circuit is open
    candidate = None
    with _CACHE_LOCK:
        entry = _CACHE.get(cache_key)
        if entry is not None:
            fresh_until, stale_until, data = entry
            now = time.time()
            if now < fresh_until:
                _CACHE.move_to_end(cache_key)
                return jsonify(data)
            elif now < stale_until:
                candidate = data

    if not _WEATHER_BREAKER.allow_request():
        if candidate:
            resp = make_response(jsonify(candidate))
            resp.headers['X-Zephyr-Stale'] = '1'
            return resp
        return jsonify({'error': 'Upstream weather service temporarily unavailable (circuit open)'}), 503

    try:
        resp = _http_get(
            'https://api.open-meteo.com/v1/forecast',
            params={
                'latitude': lat_f,
                'longitude': lon_f,
                'current': ','.join(OPEN_METEO_PARAMS['current']),
                'hourly': ','.join(OPEN_METEO_PARAMS['hourly']),
                'daily': ','.join(OPEN_METEO_PARAMS['daily']),
                'timezone': timezone,
                'forecast_days': OPEN_METEO_PARAMS.get('forecast_days', 8)
            },
            timeout=8
        )
        resp.raise_for_status()
        data = resp.json()
        _WEATHER_BREAKER.record_success()
        _set_to_cache_stale(cache_key, data, fresh_ttl=CACHE_TTL_WEATHER, stale_ttl=7200)
        return jsonify(data)
    except requests.RequestException as e:
        _WEATHER_BREAKER.record_failure()
        logger.error(f"Open-Meteo forecast API error: {e}")
        if candidate:
            resp = make_response(jsonify(candidate))
            resp.headers['X-Zephyr-Stale'] = '1'
            return resp
        return jsonify({'error': 'Failed to fetch weather forecast data'}), 502


@app.route('/api/air-quality')
def get_air_quality():
    """Fetch current air quality and pollutant metrics from Open-Meteo Air Quality API."""
    lat = request.args.get('lat')
    lon = request.args.get('lon')
    if not lat or not lon:
        return jsonify({'error': 'Missing coordinates'}), 400

    lat_f, lon_f = parse_coordinates(lat, lon)
    if lat_f is None or lon_f is None:
        return jsonify({'error': 'Invalid coordinates format'}), 400

    cache_key = f"aqi:{lat_f}:{lon_f}"
    cached = _get_from_cache(cache_key)
    if cached:
        return jsonify(cached)

    ip = _get_client_ip()
    if not _check_rate_limit(ip):
        return jsonify({'error': 'Too many requests. Please slow down.'}), 429

    try:
        resp = _http_get(
            'https://air-quality-api.open-meteo.com/v1/air-quality',
            params={
                'latitude': lat_f,
                'longitude': lon_f,
                'current': 'european_aqi,us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone'
            },
            timeout=6
        )
        resp.raise_for_status()
        data = resp.json()
        _set_to_cache(cache_key, data, CACHE_TTL_AQI)
        return jsonify(data)
    except requests.RequestException as e:
        logger.warning(f"Air quality fetch warning for ({lat_f}, {lon_f}): {e}")
        return jsonify({
            'current': {
                'us_aqi': None,
                'pm2_5': None,
                'pm10': None,
                'ozone': None
            }
        })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug_mode = os.environ.get('FLASK_DEBUG', '0').lower() in ('1', 'true', 'yes')
    logger.info(f"Starting Zephyr Weather App on http://127.0.0.1:{port} (debug={debug_mode}) ...")
    app.run(host='0.0.0.0', port=port, debug=debug_mode)
