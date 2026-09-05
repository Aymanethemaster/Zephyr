import os
import json
import time
import logging
import re
import math
import threading
from collections import defaultdict, deque
from flask import Flask, render_template, request, jsonify, send_from_directory
import requests
from requests.adapters import HTTPAdapter
from werkzeug.middleware.proxy_fix import ProxyFix

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(
    __name__,
    template_folder=BASE_DIR,
    static_folder=os.path.join(BASE_DIR, "static"),
    static_url_path="/static"
)

# Apply ProxyFix when running behind a trusted reverse proxy (Render, Heroku, AWS, Cloudflare)
if os.environ.get("BEHIND_PROXY") == "1" or os.environ.get("RENDER") or os.environ.get("HEROKU"):
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# Persistent HTTP session with connection pooling for upstream APIs
HTTP_SESSION = requests.Session()
_adapter = HTTPAdapter(pool_connections=25, pool_maxsize=25, max_retries=1)
HTTP_SESSION.mount("https://", _adapter)
HTTP_SESSION.mount("http://", _adapter)

def http_get(url, **kwargs):
    """Executes GET via connection pool; respects monkeypatched requests.get in test fixtures."""
    if requests.get != requests.api.get:
        return requests.get(url, **kwargs)
    return HTTP_SESSION.get(url, **kwargs)

# Simple in-memory cache to reduce external latency and respect API fairness
# Structure: { key: (expiry_timestamp, data) }
CACHE = {}
CACHE_LOCK = threading.Lock()
CACHE_TTL_WEATHER = 600       # 10 minutes
CACHE_TTL_GEOCODING = 3600    # 1 hour
CACHE_TTL_AQI = 900           # 15 minutes

# Shared Open-Meteo request definition, also used by the frontend
# (static/js/weather-api.js fetches the same file) so the proxied and
# direct-client requests always ask for identical fields.
PARAMS_PATH = os.path.join(BASE_DIR, "static", "js", "weather-params.json")

DEFAULT_OPEN_METEO_PARAMS = {
    "current": ["temperature_2m", "relative_humidity_2m", "apparent_temperature",
                "is_day", "precipitation", "weather_code", "cloud_cover",
                "pressure_msl", "surface_pressure", "wind_speed_10m",
                "wind_direction_10m", "wind_gusts_10m", "uv_index"],
    "hourly": ["temperature_2m", "relative_humidity_2m", "dew_point_2m",
               "apparent_temperature", "precipitation_probability", "precipitation",
               "weather_code", "pressure_msl", "visibility", "wind_speed_10m",
               "wind_direction_10m", "uv_index", "is_day"],
    "daily": ["weather_code", "temperature_2m_max", "temperature_2m_min",
              "apparent_temperature_max", "apparent_temperature_min", "sunrise",
              "sunset", "uv_index_max", "precipitation_sum", "precipitation_hours",
              "precipitation_probability_max", "wind_speed_10m_max"],
    "forecast_days": 8
}

def load_open_meteo_params():
    try:
        with open(PARAMS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if all(k in data for k in ("current", "hourly", "daily")):
            return data
        logger.warning("weather-params.json is missing sections; using defaults")
    except Exception as e:
        logger.warning(f"Could not read {PARAMS_PATH}: {e}; using defaults")
    return DEFAULT_OPEN_METEO_PARAMS

OPEN_METEO_PARAMS = load_open_meteo_params()

# Sliding-window per-IP rate limit for API proxy routes
RATE_LIMIT_REQUESTS = 60   # requests...
RATE_LIMIT_WINDOW = 60     # ...per this many seconds
RATE_BUCKETS = defaultdict(deque)
RATE_LOCK = threading.Lock()

def check_rate_limit():
    raw_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown")
    ip = raw_ip.split(",")[0].strip() if raw_ip else "unknown"
    now = time.time()
    with RATE_LOCK:
        # Periodically prune stale IP buckets if tracking dictionary grows large
        if len(RATE_BUCKETS) > 1000:
            stale_ips = [k for k, b in RATE_BUCKETS.items() if not b or b[-1] < now - RATE_LIMIT_WINDOW]
            for k in stale_ips:
                del RATE_BUCKETS[k]

        bucket = RATE_BUCKETS[ip]
        while bucket and bucket[0] < now - RATE_LIMIT_WINDOW:
            bucket.popleft()
        if len(bucket) >= RATE_LIMIT_REQUESTS:
            return False
        bucket.append(now)
        return True

def get_from_cache(key: str):
    with CACHE_LOCK:
        if key in CACHE:
            expiry, data = CACHE[key]
            if time.time() < expiry:
                return data
            else:
                del CACHE[key]
    return None

def set_to_cache(key: str, data, ttl: int):
    with CACHE_LOCK:
        # Periodically prune stale entries if cache gets large
        if len(CACHE) > 500:
            now = time.time()
            stale_keys = [k for k, (exp, _) in CACHE.items() if exp < now]
            for k in stale_keys:
                del CACHE[k]
        CACHE[key] = (time.time() + ttl, data)


def clean_location_name(name_str):
    if not name_str:
        return ""
    first = str(name_str).split("/")[0].split(";")[0].strip()
    # Unicode-aware: keeps non-Latin scripts (Cyrillic, Arabic, CJK, ...) and parenthetical qualifiers intact
    latin = re.search(r"^[\w\s\-\.\'\(\)]+", first, re.UNICODE)
    if latin and len(latin.group(0).strip()) >= 2:
        return latin.group(0).strip()
    return first


def parse_coordinates(lat, lon):
    """
    Validates and bounds-checks latitude and longitude coordinates.
    Returns (lat_f, lon_f) rounded to 4 decimals, or (None, None) if invalid.
    """
    if lat is None or lon is None:
        return None, None
    try:
        lat_f = float(lat)
        lon_f = float(lon)
        if not (math.isfinite(lat_f) and math.isfinite(lon_f)):
            return None, None
        if not (-90.0 <= lat_f <= 90.0 and -180.0 <= lon_f <= 180.0):
            return None, None
        return round(lat_f, 4), round(lon_f, 4)
    except (ValueError, TypeError, OverflowError):
        return None, None


@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(self)"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self' https://*.open-meteo.com https://photon.komoot.io https://api.bigdatacloud.net https://get.geojs.io; "
        "manifest-src 'self'; "
        "frame-ancestors 'none';"
    )
    return response


@app.route("/")
@app.route("/index.html")
def index():
    return render_template("index.html")


@app.route("/sw.js")
def service_worker():
    return send_from_directory(BASE_DIR, "sw.js", mimetype="application/javascript")


@app.route("/api/geocoding")
def geocode():
    if not check_rate_limit():
        return jsonify({"error": "Too many requests. Please slow down."}), 429
    raw_query = request.args.get("q", "").strip()
    if not raw_query:
        return jsonify({"results": []})
    query = raw_query[:100]
    
    cache_key = f"geo:{query.lower()}"
    cached = get_from_cache(cache_key)
    if cached:
        return jsonify(cached)

    results = []
    seen_coords = set()

    # 1. Primary: Open-Meteo Geocoding API (Fast prefix matching)
    try:
        url = "https://geocoding-api.open-meteo.com/v1/search"
        params = {
            "name": query,
            "count": 8,
            "language": "en",
            "format": "json"
        }
        resp = http_get(url, params=params, timeout=5)
        if resp.ok:
            data = resp.json()
            if "results" in data and isinstance(data["results"], list):
                for item in data["results"]:
                    lat = item.get("latitude")
                    lon = item.get("longitude")
                    coord_key = (round(float(lat), 2), round(float(lon), 2))
                    if coord_key not in seen_coords:
                        seen_coords.add(coord_key)
                        results.append({
                            "id": item.get("id"),
                            "name": item.get("name"),
                            "latitude": lat,
                            "longitude": lon,
                            "country": item.get("country", ""),
                            "country_code": item.get("country_code", ""),
                            "admin1": item.get("admin1", ""),
                            "timezone": item.get("timezone", "auto")
                        })
    except Exception as e:
        logger.warning(f"Open-Meteo geocoding warning for query '{query}': {e}")

    # 2. Secondary / Fuzzy Fallback: Photon (OpenStreetMap multilingual & typo-tolerant)
    if len(results) < 2:
        try:
            p_url = "https://photon.komoot.io/api/"
            p_params = {"q": query, "limit": 8}
            p_headers = {"User-Agent": "ZephyrWeatherApp/1.0"}
            p_resp = http_get(p_url, params=p_params, headers=p_headers, timeout=4.5)
            if p_resp.ok:
                p_data = p_resp.json()
                for feat in p_data.get("features", []):
                    props = feat.get("properties", {})
                    osm_key = props.get("osm_key", "")
                    osm_val = props.get("osm_value", "")
                    # Skip commercial venues (breweries, bars, cafes, shops) when searching cities
                    if osm_key in ("amenity", "craft", "shop", "tourism", "leisure") and osm_val in (
                        "brewery", "bar", "cafe", "pub", "restaurant", "hotel", "hostel", "nightclub", "supermarket"
                    ):
                        continue

                    coords = feat.get("geometry", {}).get("coordinates", [])
                    if len(coords) >= 2:
                        lon = round(float(coords[0]), 4)
                        lat = round(float(coords[1]), 4)
                        coord_key = (round(lat, 2), round(lon, 2))
                        if coord_key not in seen_coords:
                            seen_coords.add(coord_key)
                            raw_name = props.get("name") or props.get("city") or props.get("district") or query
                            raw_country = props.get("country") or ""
                            raw_admin = props.get("state") or props.get("county") or ""
                            results.append({
                                "id": props.get("osm_id") or f"osm_{lat}_{lon}",
                                "name": clean_location_name(raw_name),
                                "latitude": lat,
                                "longitude": lon,
                                "country": clean_location_name(raw_country),
                                "country_code": (props.get("countrycode") or "").upper(),
                                "admin1": clean_location_name(raw_admin),
                                "timezone": "auto"
                            })
        except Exception as e:
            logger.warning(f"Photon fallback geocoding warning for query '{query}': {e}")

    result_payload = {"results": results}
    if results:
        set_to_cache(cache_key, result_payload, CACHE_TTL_GEOCODING)
    return jsonify(result_payload)


@app.route("/api/ip-location")
def get_ip_location():
    if not check_rate_limit():
        return jsonify({"error": "Too many requests. Please slow down."}), 429

    raw_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown")
    ip = raw_ip.split(",")[0].strip() if raw_ip else "unknown"
    is_local_ip = ip in ("127.0.0.1", "localhost", "::1", "unknown") or ip.startswith("192.168.") or ip.startswith("10.") or ip.startswith("172.")
    cache_key = f"iploc:{ip}"
    cached = get_from_cache(cache_key)
    if cached:
        return jsonify(cached)

    # 1. Primary: BigDataCloud IP Geocoding
    try:
        url = "https://api.bigdatacloud.net/data/reverse-geocode-client"
        params = {"localityLanguage": "en"}
        if not is_local_ip:
            params["ip"] = ip
        resp = http_get(url, params=params, timeout=4.0)
        if resp.ok:
            data = resp.json()
            lat = data.get("latitude")
            lon = data.get("longitude")
            if lat is not None and lon is not None:
                city = data.get("city") or data.get("locality") or data.get("principalSubdivision") or data.get("countryName") or "Current Location"
                admin1 = data.get("principalSubdivision") or ""
                country = data.get("countryName") or ""
                country_code = data.get("countryCode") or ""
                payload = {
                    "name": city,
                    "admin1": admin1 if admin1 != city else "",
                    "country": country,
                    "country_code": country_code,
                    "latitude": round(float(lat), 4),
                    "longitude": round(float(lon), 4),
                    "timezone": "auto"
                }
                set_to_cache(cache_key, payload, CACHE_TTL_GEOCODING)
                return jsonify(payload)
    except Exception as e:
        logger.warning(f"BigDataCloud IP location warning for IP '{ip}': {e}")

    # 2. Secondary: GeoJS IP Lookup Fallback
    try:
        g_url = f"https://get.geojs.io/v1/ip/geo/{ip}.json" if not is_local_ip else "https://get.geojs.io/v1/ip/geo.json"
        g_resp = http_get(g_url, timeout=3.5)
        if g_resp.ok:
            g_data = g_resp.json()
            lat = g_data.get("latitude")
            lon = g_data.get("longitude")
            if lat and lon:
                city = g_data.get("city") or g_data.get("region") or g_data.get("country") or "Current Location"
                admin1 = g_data.get("region") or ""
                country = g_data.get("country") or ""
                country_code = g_data.get("country_code") or ""
                payload = {
                    "name": city,
                    "admin1": admin1 if admin1 != city else "",
                    "country": country,
                    "country_code": country_code,
                    "latitude": round(float(lat), 4),
                    "longitude": round(float(lon), 4),
                    "timezone": g_data.get("timezone") or "auto"
                }
                set_to_cache(cache_key, payload, CACHE_TTL_GEOCODING)
                return jsonify(payload)
    except Exception as e:
        logger.warning(f"GeoJS IP location warning for IP '{ip}': {e}")

    return jsonify({"error": "Unable to determine location from IP"}), 404


@app.route("/api/reverse-geocode")
def reverse_geocode():
    if not check_rate_limit():
        return jsonify({"error": "Too many requests. Please slow down."}), 429
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if not lat or not lon:
        return jsonify({"error": "Missing coordinates"}), 400

    lat_f, lon_f = parse_coordinates(lat, lon)
    if lat_f is None or lon_f is None:
        return jsonify({"error": "Invalid coordinates format"}), 400

    cache_key = f"revgeo:{round(lat_f, 3)}:{round(lon_f, 3)}"
    cached = get_from_cache(cache_key)
    if cached:
        return jsonify(cached)

    try:
        # Use BigDataCloud reverse geocode client (free, client-side friendly, no auth)
        url = "https://api.bigdatacloud.net/data/reverse-geocode-client"
        params = {
            "latitude": lat_f,
            "longitude": lon_f,
            "localityLanguage": "en"
        }
        resp = http_get(url, params=params, timeout=4.0)
        resp.raise_for_status()
        data = resp.json()

        city = data.get("city") or data.get("locality") or data.get("principalSubdivision") or data.get("countryName") or "Current Location"
        country = data.get("countryName") or ""
        country_code = data.get("countryCode") or ""
        admin1 = data.get("principalSubdivision") or ""

        payload = {
            "name": city,
            "admin1": admin1 if admin1 != city else "",
            "country": country,
            "country_code": country_code,
            "latitude": lat_f,
            "longitude": lon_f
        }
        set_to_cache(cache_key, payload, CACHE_TTL_GEOCODING)
        return jsonify(payload)
    except Exception as e:
        logger.warning(f"Reverse geocode fallback for ({lat_f}, {lon_f}): {e}")
        # Fallback payload with coordinates
        return jsonify({
            "name": f"{round(lat_f, 2)}°, {round(lon_f, 2)}°",
            "admin1": "",
            "country": "",
            "country_code": "",
            "latitude": lat_f,
            "longitude": lon_f
        })


@app.route("/api/weather")
def get_weather():
    if not check_rate_limit():
        return jsonify({"error": "Too many requests. Please slow down."}), 429
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    raw_tz = request.args.get("timezone", "auto")

    if not lat or not lon:
        return jsonify({"error": "Latitude and longitude are required"}), 400

    lat_f, lon_f = parse_coordinates(lat, lon)
    if lat_f is None or lon_f is None:
        return jsonify({"error": "Invalid coordinates format"}), 400

    timezone = raw_tz.strip()[:50] if raw_tz else "auto"
    if not re.match(r"^[A-Za-z0-9_\/\+\-]+$", timezone):
        timezone = "auto"

    cache_key = f"weather:{lat_f}:{lon_f}:{timezone}"
    cached = get_from_cache(cache_key)
    if cached:
        return jsonify(cached)

    try:
        url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude": lat_f,
            "longitude": lon_f,
            "current": OPEN_METEO_PARAMS["current"],
            "hourly": OPEN_METEO_PARAMS["hourly"],
            "daily": OPEN_METEO_PARAMS["daily"],
            "timezone": timezone,
            "forecast_days": OPEN_METEO_PARAMS.get("forecast_days", 8)
        }

        resp = http_get(url, params=params, timeout=8)
        resp.raise_for_status()
        data = resp.json()

        set_to_cache(cache_key, data, CACHE_TTL_WEATHER)
        return jsonify(data)
    except requests.exceptions.RequestException as e:
        logger.error(f"Open-Meteo forecast API error: {e}")
        return jsonify({"error": "Failed to fetch weather forecast data", "details": str(e)}), 502
    except Exception as e:
        logger.error(f"Unexpected error in get_weather: {e}")
        return jsonify({"error": "Internal server error", "details": str(e)}), 500


@app.route("/api/air-quality")
def get_air_quality():
    if not check_rate_limit():
        return jsonify({"error": "Too many requests. Please slow down."}), 429
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if not lat or not lon:
        return jsonify({"error": "Missing coordinates"}), 400

    lat_f, lon_f = parse_coordinates(lat, lon)
    if lat_f is None or lon_f is None:
        return jsonify({"error": "Invalid coordinates format"}), 400

    cache_key = f"aqi:{lat_f}:{lon_f}"
    cached = get_from_cache(cache_key)
    if cached:
        return jsonify(cached)

    try:
        url = "https://air-quality-api.open-meteo.com/v1/air-quality"
        params = {
            "latitude": lat_f,
            "longitude": lon_f,
            "current": [
                "european_aqi",
                "us_aqi",
                "pm10",
                "pm2_5",
                "carbon_monoxide",
                "nitrogen_dioxide",
                "sulphur_dioxide",
                "ozone"
            ]
        }
        resp = http_get(url, params=params, timeout=6)
        resp.raise_for_status()
        data = resp.json()

        set_to_cache(cache_key, data, CACHE_TTL_AQI)
        return jsonify(data)
    except Exception as e:
        logger.warning(f"Air quality fetch warning for ({lat}, {lon}): {e}")
        return jsonify({"current": {
            "us_aqi": None,
            "pm2_5": None,
            "pm10": None,
            "ozone": None
        }})


@app.route("/api/health")
def health():
    return jsonify({"status": "healthy", "service": "zephyr-weather-app"})


if __name__ == "__main__":
    logger.info("Starting Weather App on http://127.0.0.1:5000 ...")
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=os.environ.get("FLASK_DEBUG") == "1"
    )
