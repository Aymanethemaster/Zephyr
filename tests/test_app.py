import json
import os
import time
from unittest.mock import patch, MagicMock

import pytest
import requests

import app as zephyr_app
from app import (
    app,
    clean_location_name,
    parse_coordinates,
    _is_local_or_private_ip,
    _get_from_cache,
    _get_fresh_cached,
    _set_to_cache,
    _set_to_cache_stale,
    _CACHE,
    _RATE_BUCKETS,
    _WEATHER_BREAKER,
    CircuitBreaker,
    MAX_CACHE_SIZE,
    MAX_RATE_BUCKETS,
    RATE_LIMIT_REQUESTS,
    RATE_LIMIT_WINDOW,
    _check_rate_limit,
    _get_client_ip,
)


@pytest.fixture
def client():
    app.config['TESTING'] = True
    _CACHE.clear()
    _RATE_BUCKETS.clear()
    _WEATHER_BREAKER.failures = 0
    _WEATHER_BREAKER.state = 'CLOSED'
    _WEATHER_BREAKER._half_open_in_flight = False
    with app.test_client() as client:
        yield client
    _CACHE.clear()
    _RATE_BUCKETS.clear()


# ==============================================================================
# 1. Pure Utility & Validation Functions
# ==============================================================================

class TestCleanLocationName:
    def test_plain_latin_name(self):
        assert clean_location_name('Paris') == 'Paris'
        assert clean_location_name('New York') == 'New York'

    def test_slash_and_semicolon_delimiters(self):
        assert clean_location_name('London/City of London;Greater London') == 'London'
        assert clean_location_name('Geneva / Genève') == 'Geneva'
        assert clean_location_name('Brussels;Bruxelles') == 'Brussels'

    def test_multilingual_bilingual_string_extracts_latin_prefix(self):
        assert clean_location_name('Tangier طنجة') == 'Tangier'
        assert clean_location_name('Casablanca الدار البيضاء') == 'Casablanca'

    def test_preserves_parentheses_and_hyphens(self):
        assert clean_location_name('Frankfurt (Oder)') == 'Frankfurt (Oder)'
        assert clean_location_name('Saint-Étienne') == 'Saint-Étienne'
        assert clean_location_name("L'Aquila") == "L'Aquila"

    def test_preserves_pure_non_latin_scripts(self):
        assert clean_location_name('北京') == '北京'
        assert clean_location_name('東京') == '東京'
        assert clean_location_name('Москва') == 'Москва'
        assert clean_location_name('الرباط') == 'الرباط'

    def test_empty_and_none_inputs(self):
        assert clean_location_name('') == ''
        assert clean_location_name(None) == ''


class TestParseCoordinates:
    def test_valid_coordinates_and_rounding(self):
        assert parse_coordinates('33.581234', '-7.601234') == (33.5812, -7.6012)
        assert parse_coordinates(48.8566, 2.3522) == (48.8566, 2.3522)
        assert parse_coordinates('0', '0') == (0.0, 0.0)
        assert parse_coordinates('-90', '180') == (-90.0, 180.0)
        assert parse_coordinates('90', '-180') == (90.0, -180.0)

    def test_missing_or_empty_coordinates(self):
        assert parse_coordinates(None, '10') == (None, None)
        assert parse_coordinates('10', None) == (None, None)
        assert parse_coordinates('', '10') == (None, None)
        assert parse_coordinates('10', '') == (None, None)

    def test_non_numeric_or_non_finite_coordinates(self):
        assert parse_coordinates('abc', 'def') == (None, None)
        assert parse_coordinates('NaN', '0') == (None, None)
        assert parse_coordinates('0', 'Infinity') == (None, None)
        assert parse_coordinates('-inf', '10') == (None, None)

    def test_out_of_range_coordinates(self):
        assert parse_coordinates('90.001', '0') == (None, None)
        assert parse_coordinates('-90.1', '0') == (None, None)
        assert parse_coordinates('0', '180.001') == (None, None)
        assert parse_coordinates('0', '-180.1') == (None, None)


class TestIpClassificationAndExtraction:
    def test_local_and_private_ips(self):
        assert _is_local_or_private_ip('127.0.0.1') is True
        assert _is_local_or_private_ip('::1') is True
        assert _is_local_or_private_ip('localhost') is True
        assert _is_local_or_private_ip('unknown') is True
        assert _is_local_or_private_ip('') is True
        assert _is_local_or_private_ip(None) is True
        assert _is_local_or_private_ip('10.0.0.1') is True
        assert _is_local_or_private_ip('172.16.0.1') is True
        assert _is_local_or_private_ip('172.31.255.254') is True
        assert _is_local_or_private_ip('192.168.1.1') is True
        assert _is_local_or_private_ip('169.254.1.1') is True
        assert _is_local_or_private_ip('fe80::1') is True
        assert _is_local_or_private_ip('not-an-ip') is True

    def test_public_ips(self):
        assert _is_local_or_private_ip('8.8.8.8') is False
        assert _is_local_or_private_ip('1.1.1.1') is False
        assert _is_local_or_private_ip('172.32.0.1') is False
        assert _is_local_or_private_ip('2606:4700:4700::1111') is False

    def test_get_client_ip_ignores_xff_when_not_behind_proxy(self, monkeypatch):
        monkeypatch.setattr(zephyr_app, '_PROXY_HOPS', 0)
        with app.test_request_context('/api/weather', headers={'X-Forwarded-For': '1.2.3.4, 5.6.7.8'}, environ_base={'REMOTE_ADDR': '9.9.9.9'}):
            assert _get_client_ip() == '9.9.9.9'

    def test_get_client_ip_reads_rightmost_hop_behind_proxy(self, monkeypatch):
        monkeypatch.setattr(zephyr_app, '_PROXY_HOPS', 1)
        with app.test_request_context('/api/weather', headers={'X-Forwarded-For': 'spoofed.ip, 203.0.113.50'}, environ_base={'REMOTE_ADDR': '10.0.0.1'}):
            assert _get_client_ip() == '203.0.113.50'

        monkeypatch.setattr(zephyr_app, '_PROXY_HOPS', 2)
        with app.test_request_context('/api/weather', headers={'X-Forwarded-For': 'spoofed.ip, 198.51.100.7, 10.0.0.2'}, environ_base={'REMOTE_ADDR': '10.0.0.1'}):
            assert _get_client_ip() == '198.51.100.7'


# ==============================================================================
# 2. LRU Cache, Rate Limiter & Circuit Breaker
# ==============================================================================

class TestCacheAndResilience:
    def test_cache_set_and_get_updates_lru(self):
        _CACHE.clear()
        _set_to_cache('a', 1, ttl=60)
        _set_to_cache('b', 2, ttl=60)
        assert list(_CACHE.keys()) == ['a', 'b']

        # Accessing 'a' moves it to the end
        assert _get_from_cache('a') == 1
        assert list(_CACHE.keys()) == ['b', 'a']

    def test_cache_evicts_oldest_when_full(self, monkeypatch):
        _CACHE.clear()
        monkeypatch.setattr(zephyr_app, 'MAX_CACHE_SIZE', 3)
        _set_to_cache('k1', 'v1', ttl=60)
        _set_to_cache('k2', 'v2', ttl=60)
        _set_to_cache('k3', 'v3', ttl=60)
        _set_to_cache('k4', 'v4', ttl=60)
        assert 'k1' not in _CACHE
        assert list(_CACHE.keys()) == ['k2', 'k3', 'k4']

    def test_cache_expiry_and_stale_window(self):
        _CACHE.clear()
        _set_to_cache('short', {'x': 1}, ttl=-1, stale_ttl=-1)
        assert _get_from_cache('short') is None
        assert 'short' not in _CACHE

        # Fresh expired, but still within stale window: _get_from_cache returns None without deleting
        _set_to_cache('stale_ok', {'x': 2}, ttl=-1, stale_ttl=60)
        assert _get_from_cache('stale_ok') is None
        assert 'stale_ok' in _CACHE
        assert _get_fresh_cached('stale_ok') is None

    def test_rate_limiter_sliding_window(self, monkeypatch):
        _RATE_BUCKETS.clear()
        monkeypatch.setattr(zephyr_app, 'RATE_LIMIT_REQUESTS', 3)
        ip = '192.0.2.10'
        assert _check_rate_limit(ip) is True
        assert _check_rate_limit(ip) is True
        assert _check_rate_limit(ip) is True
        assert _check_rate_limit(ip) is False

    def test_circuit_breaker_lifecycle(self):
        cb = CircuitBreaker(failure_threshold=3, recovery_timeout=10.0)
        assert cb.state == 'CLOSED'
        assert cb.allow_request() is True

        cb.record_failure()
        cb.record_failure()
        assert cb.state == 'CLOSED'

        cb.record_failure()
        assert cb.state == 'OPEN'
        assert cb.allow_request() is False

        # Simulate recovery timeout elapsed
        cb.last_change -= 15.0
        assert cb.allow_request() is True
        assert cb.state == 'HALF_OPEN'
        # Second concurrent probe blocked while canary in flight
        assert cb.allow_request() is False

        # Success closes circuit
        cb.record_success()
        assert cb.state == 'CLOSED'
        assert cb.failures == 0
        assert cb.allow_request() is True


# ==============================================================================
# 3. Static Asset Routes, Security Headers & Origin Verification
# ==============================================================================

class TestStaticAndSecurityHeaders:
    def test_index_route_and_headers(self, client):
        resp = client.get('/')
        assert resp.status_code == 200
        assert b'Zephyr' in resp.data
        assert resp.headers.get('Cache-Control') == 'no-cache, no-store, must-revalidate'
        assert resp.headers.get('X-Content-Type-Options') == 'nosniff'
        assert resp.headers.get('Referrer-Policy') == 'strict-origin-when-cross-origin'
        assert 'Content-Security-Policy' in resp.headers

    def test_service_worker_route(self, client):
        resp = client.get('/sw.js')
        assert resp.status_code == 200
        assert 'javascript' in resp.headers.get('Content-Type', '')
        assert resp.headers.get('Cache-Control') == 'no-cache, no-store, must-revalidate'

    def test_weather_icon_route(self, client):
        resp = client.get('/static/icons/clear-day.svg')
        assert resp.status_code == 200
        assert 'public, max-age=3600' in resp.headers.get('Cache-Control', '')

    def test_hsts_and_upgrade_insecure_requests_on_https(self, client):
        resp = client.get('/api/health', headers={'X-Forwarded-Proto': 'https'})
        assert resp.status_code == 200
        assert 'max-age=31536000' in resp.headers.get('Strict-Transport-Security', '')
        assert 'upgrade-insecure-requests' in resp.headers.get('Content-Security-Policy', '')

    def test_health_check_endpoint(self, client):
        resp = client.get('/api/health')
        assert resp.status_code == 200
        assert resp.get_json() == {'status': 'healthy', 'service': 'zephyr-weather-app'}

    def test_origin_verification_when_allowed_origins_configured(self, client, monkeypatch):
        monkeypatch.setattr(zephyr_app, 'ALLOWED_ORIGINS', {'https://zephyr.example.com'})

        # 1. Missing Origin/Referer & no Sec-Fetch-Site -> 403
        r1 = client.get('/api/geocoding?q=Paris')
        assert r1.status_code == 403

        # 2. Unauthorized Origin -> 403
        r2 = client.get('/api/geocoding?q=Paris', headers={'Origin': 'https://evil.example.org'})
        assert r2.status_code == 403

        # 3. Same-origin Sec-Fetch-Site -> allowed
        r3 = client.get('/api/geocoding?q=', headers={'Sec-Fetch-Site': 'same-origin'})
        assert r3.status_code == 200

        # 4. Authorized Origin -> allowed
        r4 = client.get('/api/geocoding?q=', headers={'Origin': 'https://zephyr.example.com'})
        assert r4.status_code == 200

        # 5. /api/health always bypasses origin check
        r5 = client.get('/api/health', headers={'Origin': 'https://evil.example.org'})
        assert r5.status_code == 200


# ==============================================================================
# 4. API Proxy Endpoints (/api/geocoding, /api/ip-location, /api/reverse-geocode, /api/weather, /api/air-quality)
# ==============================================================================

class TestGeocodingEndpoint:
    def test_empty_query_returns_empty_list(self, client):
        resp = client.get('/api/geocoding?q=   ')
        assert resp.status_code == 200
        assert resp.get_json() == {'results': []}

    @patch('app._http_get')
    def test_primary_open_meteo_geocoding_success_and_caching(self, mock_get, client):
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_resp.json.return_value = {
            'results': [
                {
                    'id': 1,
                    'name': 'Rabat',
                    'latitude': 34.0209,
                    'longitude': -6.8416,
                    'country': 'Morocco',
                    'country_code': 'MA',
                    'admin1': 'Rabat-Salé-Kénitra',
                    'timezone': 'Africa/Casablanca',
                },
                {
                    'id': 2,
                    'name': 'Salé',
                    'latitude': 34.0531,
                    'longitude': -6.7985,
                    'country': 'Morocco',
                    'country_code': 'MA',
                    'admin1': 'Rabat-Salé-Kénitra',
                    'timezone': 'Africa/Casablanca',
                },
            ]
        }
        mock_get.return_value = mock_resp

        r1 = client.get('/api/geocoding?q=Rabat')
        assert r1.status_code == 200
        data = r1.get_json()
        assert len(data['results']) == 2
        assert data['results'][0]['name'] == 'Rabat'
        assert mock_get.call_count == 1

        # Second call hits cache
        r2 = client.get('/api/geocoding?q=rabat')
        assert r2.status_code == 200
        assert mock_get.call_count == 1

    @patch('app._http_get')
    def test_photon_fallback_filters_non_geographic_pois(self, mock_get, client):
        om_resp = MagicMock()
        om_resp.raise_for_status.return_value = None
        om_resp.json.return_value = {'results': []}

        photon_resp = MagicMock()
        photon_resp.raise_for_status.return_value = None
        photon_resp.json.return_value = {
            'features': [
                {
                    'properties': {'osm_key': 'amenity', 'osm_value': 'bar', 'name': 'Rabat Bar'},
                    'geometry': {'coordinates': [-6.84, 34.02]},
                },
                {
                    'properties': {
                        'osm_id': 999,
                        'osm_key': 'place',
                        'osm_value': 'city',
                        'name': 'Tangier طنجة',
                        'country': 'Morocco',
                        'countrycode': 'ma',
                        'state': 'Tanger-Tetouan-Al Hoceima',
                    },
                    'geometry': {'coordinates': [-5.834, 35.7595]},
                },
            ]
        }
        mock_get.side_effect = [om_resp, photon_resp]

        resp = client.get('/api/geocoding?q=Tangier')
        assert resp.status_code == 200
        results = resp.get_json()['results']
        assert len(results) == 1
        assert results[0]['name'] == 'Tangier'
        assert results[0]['country_code'] == 'MA'

    @patch('app._http_get')
    def test_both_geocoding_providers_fail_returns_502(self, mock_get, client):
        mock_get.side_effect = requests.RequestException('Network down')
        resp = client.get('/api/geocoding?q=London')
        assert resp.status_code == 502
        assert 'error' in resp.get_json()


class TestIpLocationEndpoint:
    @patch('app._http_get')
    def test_primary_bigdatacloud_ip_location(self, mock_get, client):
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_resp.json.return_value = {
            'city': 'Casablanca',
            'principalSubdivision': 'Casablanca-Settat',
            'countryName': 'Morocco',
            'countryCode': 'MA',
            'latitude': 33.5731,
            'longitude': -7.5898,
        }
        mock_get.return_value = mock_resp

        resp = client.get('/api/ip-location')
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['name'] == 'Casablanca'
        assert data['country_code'] == 'MA'

    @patch('app._http_get')
    def test_geojs_fallback_when_bigdatacloud_fails_including_zero_coords(self, mock_get, client):
        bdc_fail = requests.RequestException('BDC timeout')
        geojs_resp = MagicMock()
        geojs_resp.raise_for_status.return_value = None
        geojs_resp.json.return_value = {
            'city': 'Null Island',
            'region': 'Atlantic',
            'country': 'International',
            'country_code': 'XX',
            'latitude': 0.0,
            'longitude': 0.0,
            'timezone': 'UTC',
        }
        mock_get.side_effect = [bdc_fail, geojs_resp]

        resp = client.get('/api/ip-location')
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['name'] == 'Null Island'
        assert data['latitude'] == 0.0
        assert data['longitude'] == 0.0

    @patch('app._http_get')
    def test_all_ip_providers_fail_returns_404(self, mock_get, client):
        mock_get.side_effect = requests.RequestException('All failed')
        resp = client.get('/api/ip-location')
        assert resp.status_code == 404


class TestReverseGeocodeEndpoint:
    def test_missing_or_invalid_coords(self, client):
        assert client.get('/api/reverse-geocode').status_code == 400
        assert client.get('/api/reverse-geocode?lat=abc&lon=10').status_code == 400
        assert client.get('/api/reverse-geocode?lat=95&lon=10').status_code == 400

    @patch('app._http_get')
    def test_reverse_geocode_success_and_fallback(self, mock_get, client):
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_resp.json.return_value = {
            'city': 'Madrid',
            'principalSubdivision': 'Madrid',
            'countryName': 'Spain',
            'countryCode': 'ES',
        }
        mock_get.return_value = mock_resp

        r1 = client.get('/api/reverse-geocode?lat=40.4168&lon=-3.7038')
        assert r1.status_code == 200
        d1 = r1.get_json()
        assert d1['name'] == 'Madrid'
        assert d1['admin1'] == ''  # deduplicated when identical to city

        # Fallback on upstream error returns formatted coordinate string
        mock_get.side_effect = requests.RequestException('Upstream error')
        r2 = client.get('/api/reverse-geocode?lat=12.3456&lon=65.4321')
        assert r2.status_code == 200
        assert '12.35°' in r2.get_json()['name']


class TestWeatherAndAirQualityEndpoints:
    def test_weather_validation(self, client):
        assert client.get('/api/weather').status_code == 400
        assert client.get('/api/weather?lat=invalid&lon=0').status_code == 400
        assert client.get('/api/weather?lat=100&lon=0').status_code == 400

    @patch('app._http_get')
    def test_weather_fetch_and_stale_fallback_on_failure(self, mock_get, client):
        sample_weather = {
            'current': {'temperature_2m': 22.5, 'weather_code': 0, 'is_day': 1},
            'hourly': {'time': [], 'temperature_2m': []},
            'daily': {'time': [], 'temperature_2m_max': [], 'temperature_2m_min': []},
        }
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_resp.json.return_value = sample_weather
        mock_get.return_value = mock_resp

        r1 = client.get('/api/weather?lat=34.02&lon=-6.84&timezone=Africa/Casablanca')
        assert r1.status_code == 200
        assert r1.get_json()['current']['temperature_2m'] == 22.5

        # Expire fresh TTL but keep within stale window
        cache_key = 'weather:34.02:-6.84:Africa/Casablanca'
        now = time.time()
        _CACHE[cache_key] = (now - 10, now + 3600, sample_weather)

        # Simulate upstream failure -> should serve stale data with X-Zephyr-Stale: 1
        mock_get.side_effect = requests.RequestException('Open-Meteo outage')
        r2 = client.get('/api/weather?lat=34.02&lon=-6.84&timezone=Africa/Casablanca')
        assert r2.status_code == 200
        assert r2.headers.get('X-Zephyr-Stale') == '1'
        assert r2.get_json()['current']['temperature_2m'] == 22.5

    @patch('app._http_get')
    def test_air_quality_endpoint_success_and_graceful_degradation(self, mock_get, client):
        assert client.get('/api/air-quality').status_code == 400
        assert client.get('/api/air-quality?lat=bad&lon=0').status_code == 400

        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_resp.json.return_value = {'current': {'us_aqi': 35, 'pm2_5': 8.2}}
        mock_get.return_value = mock_resp

        r1 = client.get('/api/air-quality?lat=48.85&lon=2.35')
        assert r1.status_code == 200
        assert r1.get_json()['current']['us_aqi'] == 35

        # Upstream error degrades gracefully with null metrics (HTTP 200)
        mock_get.side_effect = requests.RequestException('AQI timeout')
        r2 = client.get('/api/air-quality?lat=35.68&lon=139.76')
        assert r2.status_code == 200
        assert r2.get_json()['current']['us_aqi'] is None
