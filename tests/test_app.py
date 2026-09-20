import os
import sys
import time
import pytest

# Ensure repository root is on sys.path regardless of execution environment
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from unittest.mock import patch, MagicMock
import requests

from app import (
    app,
    clean_location_name,
    get_from_cache,
    set_to_cache,
    set_to_cache_stale,
    parse_coordinates,
    CACHE,
    CACHE_LOCK,
    WEATHER_BREAKER,
    RATE_BUCKETS,
    RATE_LOCK,
    MAX_CACHE_SIZE,
)


@pytest.fixture()
def client():
    app.config["TESTING"] = True
    CACHE.clear()
    WEATHER_BREAKER.record_success()
    with RATE_LOCK:
        RATE_BUCKETS.clear()
    with app.test_client() as c:
        yield c
    CACHE.clear()
    WEATHER_BREAKER.record_success()
    with RATE_LOCK:
        RATE_BUCKETS.clear()


# --- clean_location_name -------------------------------------------------

def test_clean_name_plain():
    assert clean_location_name("Paris") == "Paris"


def test_clean_name_strips_suffixes():
    assert clean_location_name("London/City of London;Greater London") == "London"


def test_clean_name_parentheses():
    assert clean_location_name("Frankfurt (Oder)") == "Frankfurt (Oder)"
    assert clean_location_name("Freiburg (Breisgau)") == "Freiburg (Breisgau)"


def test_clean_name_keeps_non_latin_scripts():
    assert clean_location_name("北京") == "北京"
    assert clean_location_name("Москва") == "Москва"
    assert clean_location_name("الرباط") == "الرباط"


def test_clean_name_empty():
    assert clean_location_name("") == ""
    assert clean_location_name(None) == ""


# --- cache ---------------------------------------------------------------

def test_cache_roundtrip():
    set_to_cache("k", {"v": 1}, ttl=60)
    assert get_from_cache("k") == {"v": 1}


def test_cache_expiry():
    set_to_cache("expired", "x", ttl=-1)
    assert get_from_cache("expired") is None
    assert "expired" not in CACHE


def test_cache_miss():
    assert get_from_cache("nope") is None


def test_cache_overwrite():
    set_to_cache("k", 1, ttl=60)
    set_to_cache("k", 2, ttl=60)
    assert get_from_cache("k") == 2


# --- shared Open-Meteo params --------------------------------------------

def test_shared_params_file_loads():
    from app import OPEN_METEO_PARAMS
    assert "temperature_2m" in OPEN_METEO_PARAMS["current"]
    assert "dew_point_2m" in OPEN_METEO_PARAMS["hourly"]
    assert "sunrise" in OPEN_METEO_PARAMS["daily"]
    assert isinstance(OPEN_METEO_PARAMS.get("forecast_days"), int)


# --- routes ---------------------------------------------------------------

def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.get_json()["status"] == "healthy"


def test_index(client):
    res = client.get("/")
    assert res.status_code == 200
    assert b"Zeph" in res.data


def test_index_html(client):
    res = client.get("/index.html")
    assert res.status_code == 200
    assert b"Zeph" in res.data


def test_service_worker(client):
    res = client.get("/sw.js")
    assert res.status_code == 200
    assert b"zephyr" in res.data
    assert "javascript" in res.headers.get("Content-Type", "")


def test_weather_requires_coords(client):
    res = client.get("/api/weather")
    assert res.status_code == 400


def test_weather_rejects_bad_coords(client):
    res = client.get("/api/weather?lat=abc&lon=def")
    assert res.status_code == 400


def test_reverse_geocode_requires_coords(client):
    res = client.get("/api/reverse-geocode")
    assert res.status_code == 400


def test_geocoding_empty_query(client):
    res = client.get("/api/geocoding?q=")
    assert res.status_code == 200
    assert res.get_json() == {"results": []}


def test_ip_location_route(client, monkeypatch):
    class MockResp:
        ok = True
        def json(self):
            return {
                "city": "Casablanca",
                "locality": "Casablanca",
                "principalSubdivision": "Casablanca-Settat",
                "countryName": "Morocco",
                "countryCode": "MA",
                "latitude": 33.5731,
                "longitude": -7.5898
            }

    monkeypatch.setattr("app.requests.get", lambda *args, **kwargs: MockResp())
    res = client.get("/api/ip-location")
    assert res.status_code == 200
    data = res.get_json()
    assert data["name"] == "Casablanca"
    assert data["country"] == "Morocco"
    assert data["latitude"] == 33.5731


def test_rate_limit(client, monkeypatch):
    # Block outbound HTTP so the test never touches the network; the geocode
    # route logs and returns an empty payload, exercising only the limiter.
    def no_network(*args, **kwargs):
        raise RuntimeError("network disabled in test")

    monkeypatch.setattr("app.requests.get", no_network)
    monkeypatch.setattr("app.RATE_LIMIT_REQUESTS", 3)
    from app import RATE_BUCKETS
    RATE_BUCKETS.clear()
    statuses = [client.get("/api/geocoding?q=paris").status_code for _ in range(5)]
    assert statuses[:3] == [200, 200, 200]
    assert 429 in statuses[3:]


def test_security_headers(client):
    res = client.get("/api/health")
    assert res.headers.get("X-Content-Type-Options") == "nosniff"
    assert res.headers.get("X-Frame-Options") == "DENY"
    assert res.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
    assert "geolocation=(self)" in res.headers.get("Permissions-Policy", "")
    assert "default-src 'self'" in res.headers.get("Content-Security-Policy", "")


def test_hsts_header_on_https(client):
    # Plain HTTP responses do not force HSTS
    assert "Strict-Transport-Security" not in client.get("/api/health").headers
    # HTTPS (or proxied HTTPS) responses enforce HSTS
    res = client.get("/api/health", base_url="https://localhost")
    assert "max-age=31536000" in res.headers.get("Strict-Transport-Security", "")
    res2 = client.get("/api/health", headers={"X-Forwarded-Proto": "https"})
    assert "max-age=31536000" in res2.headers.get("Strict-Transport-Security", "")


def test_weather_error_does_not_leak_details(client, monkeypatch):
    def boom(url, params=None, **kwargs):
        raise RuntimeError("sensitive internal path C:\\secret\\traceback")

    monkeypatch.setattr("app.requests.get", boom)
    res = client.get("/api/weather?lat=40.7&lon=-74.0")
    assert res.status_code == 500
    body = res.get_json()
    assert "details" not in body
    assert "sensitive" not in str(body)


def test_rate_limit_pruning():
    from app import RATE_BUCKETS, check_rate_limit
    from collections import deque
    RATE_BUCKETS.clear()
    now = time.time()
    # Populate dummy old buckets exceeding 1000 threshold
    for i in range(1005):
        RATE_BUCKETS[f"10.0.0.{i}"] = deque([now - 120])

    with app.test_request_context("/", headers={"X-Forwarded-For": "10.0.0.1"}):
        check_rate_limit()

    # Stale buckets should be pruned down to active ones
    assert len(RATE_BUCKETS) <= 2


def test_weather_success_mock(client, monkeypatch):
    class MockResp:
        ok = True
        status_code = 200
        def raise_for_status(self):
            pass
        def json(self):
            return {
                "latitude": 33.58,
                "longitude": -7.60,
                "current": {"temperature_2m": 22.5, "weather_code": 0}
            }

    monkeypatch.setattr("app.requests.get", lambda *args, **kwargs: MockResp())
    res = client.get("/api/weather?lat=33.58&lon=-7.60")
    assert res.status_code == 200
    data = res.get_json()
    assert data["latitude"] == 33.58
    assert data["current"]["temperature_2m"] == 22.5


def test_weather_upstream_error(client, monkeypatch):
    import requests
    def mock_get_fail(*args, **kwargs):
        raise requests.exceptions.RequestException("Upstream timeout")

    monkeypatch.setattr("app.requests.get", mock_get_fail)
    res = client.get("/api/weather?lat=33.58&lon=-7.60")
    assert res.status_code == 502
    assert "Failed to fetch weather forecast data" in res.get_json()["error"]


def test_air_quality_requires_coords(client):
    res = client.get("/api/air-quality")
    assert res.status_code == 400


def test_air_quality_success_mock(client, monkeypatch):
    class MockResp:
        ok = True
        status_code = 200
        def raise_for_status(self):
            pass
        def json(self):
            return {
                "current": {"us_aqi": 35, "pm2_5": 8.4}
            }

    monkeypatch.setattr("app.requests.get", lambda *args, **kwargs: MockResp())
    res = client.get("/api/air-quality?lat=33.58&lon=-7.60")
    assert res.status_code == 200
    assert res.get_json()["current"]["us_aqi"] == 35


def test_air_quality_fallback_on_error(client, monkeypatch):
    def mock_get_fail(*args, **kwargs):
        raise RuntimeError("AQI service unavailable")

    monkeypatch.setattr("app.requests.get", mock_get_fail)
    res = client.get("/api/air-quality?lat=33.58&lon=-7.60")
    assert res.status_code == 200
    data = res.get_json()
    assert "current" in data
    assert data["current"]["us_aqi"] is None


def test_reverse_geocode_success_mock(client, monkeypatch):
    class MockResp:
        ok = True
        status_code = 200
        def raise_for_status(self):
            pass
        def json(self):
            return {
                "city": "Rabat",
                "locality": "Rabat",
                "principalSubdivision": "Rabat-Salé-Kénitra",
                "countryName": "Morocco",
                "countryCode": "MA"
            }

    monkeypatch.setattr("app.requests.get", lambda *args, **kwargs: MockResp())
    res = client.get("/api/reverse-geocode?lat=34.02&lon=-6.83")
    assert res.status_code == 200
    data = res.get_json()
    assert data["name"] == "Rabat"
    assert data["country"] == "Morocco"


def test_parse_coordinates():
    from app import parse_coordinates
    assert parse_coordinates(33.58, -7.60) == (33.58, -7.60)
    assert parse_coordinates("33.58123", "-7.60123") == (33.5812, -7.6012)
    assert parse_coordinates(None, 10) == (None, None)
    assert parse_coordinates("abc", "def") == (None, None)
    assert parse_coordinates("inf", "0") == (None, None)
    assert parse_coordinates("-inf", "0") == (None, None)
    assert parse_coordinates("nan", "0") == (None, None)
    assert parse_coordinates(91, 0) == (None, None)
    assert parse_coordinates(-91, 0) == (None, None)
    assert parse_coordinates(0, 181) == (None, None)
    assert parse_coordinates(0, -181) == (None, None)


def test_weather_rejects_out_of_bounds_coords(client):
    assert client.get("/api/weather?lat=999&lon=0").status_code == 400
    assert client.get("/api/weather?lat=0&lon=999").status_code == 400
    assert client.get("/api/weather?lat=inf&lon=0").status_code == 400
    assert client.get("/api/weather?lat=nan&lon=0").status_code == 400


def test_air_quality_rejects_out_of_bounds_coords(client):
    assert client.get("/api/air-quality?lat=999&lon=0").status_code == 400
    assert client.get("/api/air-quality?lat=inf&lon=0").status_code == 400


def test_reverse_geocode_rejects_out_of_bounds_coords(client):
    assert client.get("/api/reverse-geocode?lat=999&lon=0").status_code == 400
    assert client.get("/api/reverse-geocode?lat=inf&lon=0").status_code == 400


def test_geocoding_query_capped(client, monkeypatch):
    captured_query = None

    def mock_get(url, params=None, **kwargs):
        nonlocal captured_query
        if params and "name" in params:
            captured_query = params["name"]
        class MockResp:
            ok = True
            def json(self):
                return {"results": []}
        return MockResp()

    monkeypatch.setattr("app.requests.get", mock_get)
    long_query = "a" * 250
    res = client.get(f"/api/geocoding?q={long_query}")
    assert res.status_code == 200
    assert captured_query is not None
    assert len(captured_query) == 100


def test_is_local_or_private_ip():
    from app import is_local_or_private_ip
    # Loopback and defaults
    assert is_local_or_private_ip("127.0.0.1") is True
    assert is_local_or_private_ip("::1") is True
    assert is_local_or_private_ip("localhost") is True
    assert is_local_or_private_ip("unknown") is True
    assert is_local_or_private_ip("") is True
    assert is_local_or_private_ip(None) is True
    assert is_local_or_private_ip("invalid-ip-string") is True

    # RFC 1918 Private ranges
    assert is_local_or_private_ip("10.0.0.1") is True
    assert is_local_or_private_ip("10.255.255.255") is True
    assert is_local_or_private_ip("192.168.1.100") is True
    assert is_local_or_private_ip("172.16.0.1") is True
    assert is_local_or_private_ip("172.31.255.254") is True
    assert is_local_or_private_ip("169.254.10.20") is True  # link-local

    # Public IPs (crucially testing 172.x.x.x addresses outside 172.16-31)
    assert is_local_or_private_ip("172.56.21.89") is False
    assert is_local_or_private_ip("172.1.0.1") is False
    assert is_local_or_private_ip("172.32.0.1") is False
    assert is_local_or_private_ip("172.217.16.206") is False
    assert is_local_or_private_ip("8.8.8.8") is False
    assert is_local_or_private_ip("1.1.1.1") is False


def test_get_client_ip(monkeypatch):
    from app import get_client_ip

    # Without BEHIND_PROXY: ignores spoofable X-Forwarded-For, uses remote_addr
    monkeypatch.delenv("BEHIND_PROXY", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("HEROKU", raising=False)
    with app.test_request_context("/", headers={"X-Forwarded-For": "203.0.113.195, 70.41.3.18"}, environ_base={"REMOTE_ADDR": "127.0.0.1"}):
        assert get_client_ip() == "127.0.0.1"

    # With BEHIND_PROXY: trusts remote_addr (populated by ProxyFix)
    monkeypatch.setenv("BEHIND_PROXY", "1")
    with app.test_request_context("/", headers={"X-Forwarded-For": "spoofed.ip.com"}, environ_base={"REMOTE_ADDR": "198.51.100.4"}):
        assert get_client_ip() == "198.51.100.4"


# ===========================================================================
# TEST-GAP-01: Geocoding Mock Tests (Open-Meteo, Photon fallback, Dual 502)
# ===========================================================================

class MockResponse:
    """Helper mock response object mimicking requests.Response."""
    def __init__(self, json_data, status_code=200, ok=True, headers=None):
        self._json_data = json_data
        self.status_code = status_code
        self.ok = ok
        self.headers = headers or {}

    def json(self):
        return self._json_data

    def raise_for_status(self):
        if not self.ok:
            raise requests.exceptions.HTTPError(f"HTTP {self.status_code}")


def test_geocoding_open_meteo_success(client):
    """Test primary Open-Meteo geocoding success, normalized schema, and no fallback call."""
    mock_payload = {
        "results": [
            {
                "id": 2988507,
                "name": "Paris",
                "latitude": 48.8534,
                "longitude": 2.3488,
                "country": "France",
                "country_code": "FR",
                "admin1": "Île-de-France",
                "timezone": "Europe/Paris"
            },
            {
                "id": 2988506,
                "name": "Paris",
                "latitude": 33.6609,
                "longitude": -95.5555,
                "country": "United States",
                "country_code": "US",
                "admin1": "Texas",
                "timezone": "America/Chicago"
            }
        ]
    }

    with patch("app.http_get") as mock_get:
        mock_get.return_value = MockResponse(mock_payload, status_code=200, ok=True)
        res = client.get("/api/geocoding?q=Paris")

    assert res.status_code == 200
    data = res.get_json()
    assert "results" in data
    assert len(data["results"]) == 2

    first = data["results"][0]
    assert first["id"] == 2988507
    assert first["name"] == "Paris"
    assert first["latitude"] == 48.8534
    assert first["longitude"] == 2.3488
    assert first["country"] == "France"
    assert first["country_code"] == "FR"
    assert first["admin1"] == "Île-de-France"
    assert first["timezone"] == "Europe/Paris"

    # Open-Meteo was called once; Photon was NOT called because len(results) >= 2
    assert mock_get.call_count == 1
    called_url = mock_get.call_args[0][0]
    assert "geocoding-api.open-meteo.com/v1/search" in called_url
    assert mock_get.call_args[1]["params"]["name"] == "Paris"

    # Verify results cached in LRU cache
    assert get_from_cache("geo:paris") is not None


def test_geocoding_photon_fallback_on_open_meteo_500(client):
    """Test that Open-Meteo 500 error falls back to Photon and returns normalized results."""
    photon_payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [2.3488, 48.8534]
                },
                "properties": {
                    "osm_id": 7444,
                    "name": "Paris",
                    "country": "France",
                    "countrycode": "fr",
                    "state": "Île-de-France",
                    "osm_key": "place",
                    "osm_value": "city"
                }
            },
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [-95.5555, 33.6609]
                },
                "properties": {
                    "osm_id": 169871,
                    "name": "Paris",
                    "country": "United States",
                    "countrycode": "us",
                    "state": "Texas",
                    "osm_key": "place",
                    "osm_value": "city"
                }
            }
        ]
    }

    def mock_dispatcher(url, *args, **kwargs):
        if "open-meteo.com" in url:
            return MockResponse({"error": "Internal Server Error"}, status_code=500, ok=False)
        elif "photon.komoot.io" in url:
            return MockResponse(photon_payload, status_code=200, ok=True)
        raise ValueError(f"Unexpected URL called: {url}")

    with patch("app.http_get", side_effect=mock_dispatcher) as mock_get:
        res = client.get("/api/geocoding?q=Paris")

    assert res.status_code == 200
    data = res.get_json()
    assert len(data["results"]) == 2

    first = data["results"][0]
    assert first["id"] == 7444
    assert first["name"] == "Paris"
    assert first["latitude"] == 48.8534
    assert first["longitude"] == 2.3488
    assert first["country"] == "France"
    assert first["country_code"] == "FR"
    assert first["admin1"] == "Île-de-France"
    assert first["timezone"] == "auto"

    # Both providers were called in sequence
    assert mock_get.call_count == 2
    urls = [call[0][0] for call in mock_get.call_args_list]
    assert any("open-meteo.com" in u for u in urls)
    assert any("photon.komoot.io" in u for u in urls)

    # Verify custom user-agent header sent to Photon
    photon_call = [c for c in mock_get.call_args_list if "photon.komoot.io" in c[0][0]][0]
    assert photon_call[1].get("headers", {}).get("User-Agent") == "ZephyrWeatherApp/1.0"


def test_geocoding_photon_fallback_on_empty_open_meteo(client):
    """Test that Open-Meteo empty results (< 2 results) trigger Photon fallback."""
    photon_payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [-8.0089, 31.6295]
                },
                "properties": {
                    "osm_id": 2591574,
                    "name": "Marrakech",
                    "country": "Morocco",
                    "countrycode": "ma",
                    "state": "Marrakech-Safi",
                    "osm_key": "place",
                    "osm_value": "city"
                }
            }
        ]
    }

    def mock_dispatcher(url, *args, **kwargs):
        if "open-meteo.com" in url:
            return MockResponse({"results": []}, status_code=200, ok=True)
        elif "photon.komoot.io" in url:
            return MockResponse(photon_payload, status_code=200, ok=True)
        raise ValueError(f"Unexpected URL called: {url}")

    with patch("app.http_get", side_effect=mock_dispatcher) as mock_get:
        res = client.get("/api/geocoding?q=Marrakesh")

    assert res.status_code == 200
    data = res.get_json()
    assert len(data["results"]) == 1
    assert data["results"][0]["name"] == "Marrakech"
    assert data["results"][0]["country"] == "Morocco"
    assert data["results"][0]["country_code"] == "MA"
    assert mock_get.call_count == 2


def test_geocoding_dual_failure_returns_502(client):
    """Test that upstream failure of both Open-Meteo and Photon returns 502 Bad Gateway."""
    def mock_dispatcher(url, *args, **kwargs):
        if "open-meteo.com" in url:
            return MockResponse({"error": "Service Unavailable"}, status_code=503, ok=False)
        elif "photon.komoot.io" in url:
            return MockResponse({"error": "Bad Gateway"}, status_code=502, ok=False)
        raise ValueError(f"Unexpected URL called: {url}")

    with patch("app.http_get", side_effect=mock_dispatcher) as mock_get:
        res = client.get("/api/geocoding?q=London")

    assert res.status_code == 502
    data = res.get_json()
    assert data["error"] == "Upstream geocoding providers unavailable"
    assert data["results"] == []
    assert mock_get.call_count == 2

    # Verify failure is not stored in cache
    assert get_from_cache("geo:london") is None


def test_geocoding_dual_failure_network_exceptions(client):
    """Test that network exceptions (timeouts / connection errors) from both return 502."""
    def mock_dispatcher(url, *args, **kwargs):
        if "open-meteo.com" in url:
            raise requests.exceptions.ConnectTimeout("Open-Meteo timed out")
        elif "photon.komoot.io" in url:
            raise requests.exceptions.ConnectionError("Photon unreachable")
        raise ValueError(f"Unexpected URL called: {url}")

    with patch("app.http_get", side_effect=mock_dispatcher) as mock_get:
        res = client.get("/api/geocoding?q=Tokyo")

    assert res.status_code == 502
    data = res.get_json()
    assert data["error"] == "Upstream geocoding providers unavailable"
    assert data["results"] == []
    assert mock_get.call_count == 2


def test_geocoding_photon_commercial_venue_filtering(client):
    """Test that commercial venues (amenity=pub, craft=brewery, tourism=hotel) are filtered out."""
    photon_payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [11.582, 48.1351]},
                "properties": {
                    "osm_id": 1001,
                    "name": "Munich",
                    "country": "Germany",
                    "countrycode": "de",
                    "state": "Bavaria",
                    "osm_key": "place",
                    "osm_value": "city"
                }
            },
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [11.583, 48.136]},
                "properties": {
                    "osm_id": 1002,
                    "name": "Munich Craft Brewery",
                    "country": "Germany",
                    "countrycode": "de",
                    "osm_key": "craft",
                    "osm_value": "brewery"
                }
            },
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [11.584, 48.137]},
                "properties": {
                    "osm_id": 1003,
                    "name": "Munich Pub",
                    "country": "Germany",
                    "countrycode": "de",
                    "osm_key": "amenity",
                    "osm_value": "pub"
                }
            },
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [11.585, 48.138]},
                "properties": {
                    "osm_id": 1004,
                    "name": "Hotel Munich",
                    "country": "Germany",
                    "countrycode": "de",
                    "osm_key": "tourism",
                    "osm_value": "hotel"
                }
            }
        ]
    }

    def mock_dispatcher(url, *args, **kwargs):
        if "open-meteo.com" in url:
            return MockResponse({"results": []}, status_code=200, ok=True)
        elif "photon.komoot.io" in url:
            return MockResponse(photon_payload, status_code=200, ok=True)
        raise ValueError(f"Unexpected URL called: {url}")

    with patch("app.http_get", side_effect=mock_dispatcher):
        res = client.get("/api/geocoding?q=Munich")

    assert res.status_code == 200
    data = res.get_json()
    assert len(data["results"]) == 1
    assert data["results"][0]["name"] == "Munich"
    assert data["results"][0]["id"] == 1001


def test_geocoding_coordinate_deduplication(client):
    """Test that identical coordinate matches across Open-Meteo and Photon are deduplicated."""
    open_meteo_payload = {
        "results": [
            {
                "id": 2553604,
                "name": "Casablanca",
                "latitude": 33.5898,
                "longitude": -7.6038,
                "country": "Morocco",
                "country_code": "MA",
                "admin1": "Casablanca-Settat",
                "timezone": "Africa/Casablanca"
            }
        ]
    }
    photon_payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-7.6038, 33.5898]},
                "properties": {
                    "osm_id": 99999,
                    "name": "Casablanca City",
                    "country": "Morocco",
                    "countrycode": "ma",
                    "osm_key": "place",
                    "osm_value": "city"
                }
            },
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-6.8498, 34.0208]},
                "properties": {
                    "osm_id": 88888,
                    "name": "Rabat",
                    "country": "Morocco",
                    "countrycode": "ma",
                    "osm_key": "place",
                    "osm_value": "city"
                }
            }
        ]
    }

    def mock_dispatcher(url, *args, **kwargs):
        if "open-meteo.com" in url:
            return MockResponse(open_meteo_payload, status_code=200, ok=True)
        elif "photon.komoot.io" in url:
            return MockResponse(photon_payload, status_code=200, ok=True)
        raise ValueError(f"Unexpected URL called: {url}")

    with patch("app.http_get", side_effect=mock_dispatcher):
        res = client.get("/api/geocoding?q=Casablanca")

    assert res.status_code == 200
    data = res.get_json()
    assert len(data["results"]) == 2
    assert data["results"][0]["name"] == "Casablanca"
    assert data["results"][0]["id"] == 2553604
    assert data["results"][1]["name"] == "Rabat"
    assert data["results"][1]["id"] == 88888


# ===========================================================================
# TEST-GAP-02: Upstream HTTP Status Codes, Timeouts, & Resilience Mock Tests
# ===========================================================================

def test_weather_upstream_400_bad_request(client):
    """Verifies that an upstream 400 Bad Request from Open-Meteo returns 502 Bad Gateway with error details."""
    WEATHER_BREAKER.record_success()

    mock_resp = MagicMock()
    mock_resp.status_code = 400
    mock_resp.ok = False
    mock_resp.raise_for_status.side_effect = requests.exceptions.HTTPError(
        "400 Client Error: Bad Request for url", response=mock_resp
    )

    with patch("app.http_get", return_value=mock_resp):
        res = client.get("/api/weather?lat=33.58&lon=-7.60")

    assert res.status_code == 502
    data = res.get_json()
    assert data["error"] == "Failed to fetch weather forecast data"


def test_weather_upstream_429_rate_limited(client):
    """Verifies that an upstream 429 Too Many Requests returns 502 when no stale cache is present."""
    WEATHER_BREAKER.record_success()

    mock_resp = MagicMock()
    mock_resp.status_code = 429
    mock_resp.ok = False
    mock_resp.raise_for_status.side_effect = requests.exceptions.HTTPError(
        "429 Client Error: Too Many Requests", response=mock_resp
    )

    with patch("app.http_get", return_value=mock_resp):
        res = client.get("/api/weather?lat=33.58&lon=-7.60")

    assert res.status_code == 502
    assert "Failed to fetch weather forecast data" in res.get_json()["error"]


def test_weather_upstream_429_serves_stale_cache(client):
    """Verifies that an upstream 429 error triggers stale-while-revalidate fallback if cached weather exists."""
    WEATHER_BREAKER.record_success()

    # Pre-populate cache with data that is past fresh_ttl but within stale_ttl
    lat_f, lon_f = parse_coordinates(33.58, -7.60)
    cache_key = f"weather:{lat_f}:{lon_f}:auto"
    cached_data = {"latitude": lat_f, "longitude": lon_f, "stale_test": True}
    set_to_cache(cache_key, cached_data, ttl=-10, stale_ttl=3600)

    mock_resp = MagicMock()
    mock_resp.status_code = 429
    mock_resp.ok = False
    mock_resp.raise_for_status.side_effect = requests.exceptions.HTTPError(
        "429 Client Error: Too Many Requests", response=mock_resp
    )

    with patch("app.http_get", return_value=mock_resp):
        res = client.get("/api/weather?lat=33.58&lon=-7.60")

    assert res.status_code == 200
    assert res.headers.get("X-Zephyr-Stale") == "1"
    assert res.get_json() == cached_data


def test_weather_upstream_500_internal_error(client):
    """Verifies that upstream 500 Internal Server Error returns 502 Bad Gateway without leaking tracebacks."""
    WEATHER_BREAKER.record_success()

    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.ok = False
    mock_resp.raise_for_status.side_effect = requests.exceptions.HTTPError(
        "500 Server Error: Internal Server Error", response=mock_resp
    )

    with patch("app.http_get", return_value=mock_resp):
        res = client.get("/api/weather?lat=33.58&lon=-7.60")

    assert res.status_code == 502
    assert res.get_json() == {"error": "Failed to fetch weather forecast data"}


def test_weather_upstream_500_serves_stale_cache(client):
    """Verifies that upstream 500 serves stale cached weather when available."""
    WEATHER_BREAKER.record_success()

    lat_f, lon_f = parse_coordinates(33.58, -7.60)
    cache_key = f"weather:{lat_f}:{lon_f}:auto"
    cached_data = {"latitude": lat_f, "longitude": lon_f, "source": "historical_cache"}
    set_to_cache(cache_key, cached_data, ttl=-10, stale_ttl=3600)

    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.ok = False
    mock_resp.raise_for_status.side_effect = requests.exceptions.HTTPError(
        "500 Server Error", response=mock_resp
    )

    with patch("app.http_get", return_value=mock_resp):
        res = client.get("/api/weather?lat=33.58&lon=-7.60")

    assert res.status_code == 200
    assert res.headers.get("X-Zephyr-Stale") == "1"
    assert res.get_json()["source"] == "historical_cache"


def test_weather_upstream_503_and_circuit_breaker(client):
    """Verifies that upstream 503 triggers error handling and trips the CircuitBreaker after threshold failures."""
    WEATHER_BREAKER.record_success()

    mock_resp = MagicMock()
    mock_resp.status_code = 503
    mock_resp.ok = False
    mock_resp.raise_for_status.side_effect = requests.exceptions.HTTPError(
        "503 Service Unavailable", response=mock_resp
    )

    with patch("app.http_get", return_value=mock_resp):
        # 1-3 failures: breaker stays CLOSED, returns 502
        for _ in range(3):
            res = client.get("/api/weather?lat=33.58&lon=-7.60")
            assert res.status_code == 502
            assert WEATHER_BREAKER.state == "CLOSED"

        # 4th failure: threshold reached (4), breaker trips to OPEN
        res = client.get("/api/weather?lat=33.58&lon=-7.60")
        assert res.status_code == 502
        assert WEATHER_BREAKER.state == "OPEN"

        # 5th request: short-circuits with 503 without calling http_get
        res = client.get("/api/weather?lat=33.58&lon=-7.60")
        assert res.status_code == 503
        data = res.get_json()
        assert "circuit open" in data["error"]

    # Clean up breaker state
    WEATHER_BREAKER.record_success()


def test_weather_circuit_breaker_open_serves_stale_cache(client):
    """Verifies that when the circuit breaker is OPEN, stale cached weather is served with X-Zephyr-Stale."""
    WEATHER_BREAKER.record_success()

    lat_f, lon_f = parse_coordinates(33.58, -7.60)
    cache_key = f"weather:{lat_f}:{lon_f}:auto"
    cached_data = {"latitude": lat_f, "longitude": lon_f, "stale": True}
    set_to_cache(cache_key, cached_data, ttl=-10, stale_ttl=3600)

    # Force breaker into OPEN state
    with WEATHER_BREAKER.lock:
        WEATHER_BREAKER.state = "OPEN"
        WEATHER_BREAKER.failures = 4
        WEATHER_BREAKER.last_change = time.time()

    with patch("app.http_get") as mock_get:
        res = client.get("/api/weather?lat=33.58&lon=-7.60")
        # http_get should not even be called when circuit is open
        mock_get.assert_not_called()

    assert res.status_code == 200
    assert res.headers.get("X-Zephyr-Stale") == "1"
    assert res.get_json() == cached_data

    # Clean up breaker state
    WEATHER_BREAKER.record_success()


def test_circuit_breaker_state_transitions():
    """
    Unit test verifying the full state machine of CircuitBreaker:
    - CLOSED -> records failures -> trips to OPEN at threshold (4).
    - OPEN -> allow_request() returns False while recovery_timeout has not elapsed.
    - OPEN -> recovery_timeout elapses -> transitions to HALF_OPEN, allows single canary probe.
    - HALF_OPEN -> concurrent allow_request() returns False (stampede prevention).
    - HALF_OPEN -> record_success() -> transitions to CLOSED, resets failures.
    - HALF_OPEN -> record_failure() -> trips immediately back to OPEN.
    """
    from app import CircuitBreaker
    cb = CircuitBreaker(failure_threshold=4, recovery_timeout=30.0)
    assert cb.state == "CLOSED"
    assert cb.allow_request() is True

    # Record 3 failures (threshold is 4)
    for _ in range(3):
        cb.record_failure()
        assert cb.state == "CLOSED"
        assert cb.allow_request() is True

    # 4th failure: trips to OPEN
    cb.record_failure()
    assert cb.state == "OPEN"
    assert cb.allow_request() is False

    # Simulate recovery timeout has not yet elapsed (e.g. 10s elapsed)
    now = time.time()
    cb.last_change = now - 10.0
    assert cb.allow_request() is False
    assert cb.state == "OPEN"

    # Simulate recovery timeout has elapsed (e.g. 31s elapsed)
    cb.last_change = now - 31.0
    # First request becomes the canary probe
    assert cb.allow_request() is True
    assert cb.state == "HALF_OPEN"
    assert cb.half_open_in_flight is True

    # Second concurrent request while canary is in-flight must be rejected
    assert cb.allow_request() is False

    # Case A: Canary succeeds -> resets to CLOSED
    cb.record_success()
    assert cb.state == "CLOSED"
    assert cb.failures == 0
    assert cb.half_open_in_flight is False
    assert cb.allow_request() is True

    # Case B: Test HALF_OPEN failure immediately trips back to OPEN
    cb.state = "OPEN"
    cb.last_change = now - 35.0
    assert cb.allow_request() is True
    assert cb.state == "HALF_OPEN"
    cb.record_failure()
    assert cb.state == "OPEN"
    assert cb.allow_request() is False


def test_weather_upstream_timeout(client):
    """Verifies that requests.exceptions.Timeout is caught cleanly and returns 502 without crashing."""
    WEATHER_BREAKER.record_success()

    with patch("app.http_get", side_effect=requests.exceptions.Timeout("Connection timed out after 8s")):
        res = client.get("/api/weather?lat=33.58&lon=-7.60")

    assert res.status_code == 502
    assert res.get_json() == {"error": "Failed to fetch weather forecast data"}


def test_weather_upstream_timeout_serves_stale_cache(client):
    """Verifies that an upstream timeout serves stale cache if available."""
    WEATHER_BREAKER.record_success()

    lat_f, lon_f = parse_coordinates(33.58, -7.60)
    cache_key = f"weather:{lat_f}:{lon_f}:auto"
    cached_data = {"latitude": lat_f, "longitude": lon_f, "data": "stale_from_timeout"}
    set_to_cache(cache_key, cached_data, ttl=-10, stale_ttl=3600)

    with patch("app.http_get", side_effect=requests.exceptions.Timeout("Read timeout")):
        res = client.get("/api/weather?lat=33.58&lon=-7.60")

    assert res.status_code == 200
    assert res.headers.get("X-Zephyr-Stale") == "1"
    assert res.get_json()["data"] == "stale_from_timeout"


def test_weather_upstream_connection_error(client):
    """Verifies that requests.exceptions.ConnectionError is caught cleanly and returns 502."""
    WEATHER_BREAKER.record_success()

    with patch("app.http_get", side_effect=requests.exceptions.ConnectionError("Failed to establish a new connection")):
        res = client.get("/api/weather?lat=33.58&lon=-7.60")

    assert res.status_code == 502
    assert res.get_json() == {"error": "Failed to fetch weather forecast data"}


def test_geocoding_upstream_timeout_both_providers(client):
    """Verifies that timeouts on both Open-Meteo and Photon return 502."""
    with patch("app.http_get", side_effect=requests.exceptions.Timeout("DNS lookup timed out")):
        res = client.get("/api/geocoding?q=Rabat")

    assert res.status_code == 502
    data = res.get_json()
    assert data["error"] == "Upstream geocoding providers unavailable"
    assert data["results"] == []


def test_geocoding_primary_500_secondary_fallback_success(client):
    """Verifies that if Open-Meteo returns 500, the system falls back to Photon and succeeds."""
    om_resp = MagicMock()
    om_resp.ok = False
    om_resp.status_code = 500

    photon_resp = MagicMock()
    photon_resp.ok = True
    photon_resp.status_code = 200
    photon_resp.json.return_value = {
        "features": [
            {
                "geometry": {"coordinates": [-6.8498, 34.0209]},
                "properties": {
                    "osm_id": 12345,
                    "name": "Rabat",
                    "country": "Morocco",
                    "countrycode": "MA",
                    "state": "Rabat-Salé-Kénitra"
                }
            }
        ]
    }

    def mock_http_get(url, *args, **kwargs):
        if "open-meteo.com" in url:
            return om_resp
        return photon_resp

    with patch("app.http_get", side_effect=mock_http_get):
        res = client.get("/api/geocoding?q=Rabat")

    assert res.status_code == 200
    results = res.get_json()["results"]
    assert len(results) == 1
    assert results[0]["name"] == "Rabat"
    assert results[0]["country"] == "Morocco"


def test_air_quality_upstream_timeout_degrades_gracefully(client):
    """Verifies that an upstream timeout on Air Quality API returns 200 with null values."""
    with patch("app.http_get", side_effect=requests.exceptions.Timeout("Air quality timeout")):
        res = client.get("/api/air-quality?lat=33.58&lon=-7.60")

    assert res.status_code == 200
    data = res.get_json()
    assert "current" in data
    assert data["current"]["us_aqi"] is None
    assert data["current"]["pm2_5"] is None


def test_reverse_geocode_upstream_500_degrades_gracefully(client):
    """Verifies that upstream error on BigDataCloud reverse geocode returns 200 with coordinate fallback."""
    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.raise_for_status.side_effect = requests.exceptions.HTTPError("500 Server Error", response=mock_resp)

    with patch("app.http_get", return_value=mock_resp):
        res = client.get("/api/reverse-geocode?lat=33.58&lon=-7.60")

    assert res.status_code == 200
    data = res.get_json()
    assert "33.58°, -7.6°" in data["name"]
    assert data["latitude"] == 33.58
    assert data["longitude"] == -7.60


# ==============================================================================
# TEST-GAP-03: Cache Hit Deduplication, Parameter Isolation & TTL Tests
# ==============================================================================

def test_weather_cache_hit_deduplication(client, monkeypatch):
    """
    Verify that identical consecutive /api/weather requests hit the in-memory cache:
    - First request invokes http_get exactly once (mock_http_get.call_count == 1).
    - Second request is served from CACHE; http_get is not called again (mock_http_get.call_count == 1).
    - Both responses return status 200 with identical JSON payloads.
    """
    with RATE_LOCK:
        RATE_BUCKETS.clear()

    weather_payload = {
        "latitude": 48.8566,
        "longitude": 2.3522,
        "timezone": "Europe/Paris",
        "current": {"temperature_2m": 18.5, "weather_code": 1, "is_day": 1},
        "daily": {"temperature_2m_max": [22.0], "temperature_2m_min": [12.0]}
    }

    mock_resp = MagicMock()
    mock_resp.ok = True
    mock_resp.status_code = 200
    mock_resp.raise_for_status.return_value = None
    mock_resp.json.return_value = weather_payload

    mock_http_get = MagicMock(return_value=mock_resp)
    monkeypatch.setattr("app.http_get", mock_http_get)

    # First request: Cache miss -> calls upstream http_get
    res1 = client.get("/api/weather?lat=48.8566&lon=2.3522")
    assert res1.status_code == 200
    assert mock_http_get.call_count == 1
    data1 = res1.get_json()
    assert data1["current"]["temperature_2m"] == 18.5

    # Second request: Cache hit -> served from CACHE
    res2 = client.get("/api/weather?lat=48.8566&lon=2.3522")
    assert res2.status_code == 200
    assert mock_http_get.call_count == 1  # Network call count must remain 1
    data2 = res2.get_json()
    assert data2 == data1
    assert "X-Zephyr-Stale" not in res2.headers


def test_geocoding_cache_hit_deduplication(client, monkeypatch):
    """
    Verify that repeated /api/geocoding requests for identical or case-variant queries
    hit the cache and deduplicate network requests:
    - Request 1 ('Tokyo') calls http_get once.
    - Request 2 ('Tokyo') hits cache (call_count == 1).
    - Request 3 ('TOKYO') hits cache due to case-folding geo:{query.lower()} (call_count == 1).
    """
    with RATE_LOCK:
        RATE_BUCKETS.clear()

    geocoding_payload = {
        "results": [
            {
                "id": 1850147,
                "name": "Tokyo",
                "latitude": 35.6895,
                "longitude": 139.6917,
                "country": "Japan",
                "country_code": "JP",
                "admin1": "Tokyo",
                "timezone": "Asia/Tokyo"
            },
            {
                "id": 1850148,
                "name": "Tokyo",
                "latitude": 35.65,
                "longitude": 139.75,
                "country": "Japan",
                "country_code": "JP",
                "admin1": "Tokyo",
                "timezone": "Asia/Tokyo"
            }
        ]
    }

    mock_resp = MagicMock()
    mock_resp.ok = True
    mock_resp.status_code = 200
    mock_resp.raise_for_status.return_value = None
    mock_resp.json.return_value = geocoding_payload

    mock_http_get = MagicMock(return_value=mock_resp)
    monkeypatch.setattr("app.http_get", mock_http_get)

    # First request: Cache miss
    res1 = client.get("/api/geocoding?q=Tokyo")
    assert res1.status_code == 200
    assert mock_http_get.call_count == 1
    data1 = res1.get_json()
    assert len(data1["results"]) == 2

    # Second request (identical): Cache hit
    res2 = client.get("/api/geocoding?q=Tokyo")
    assert res2.status_code == 200
    assert mock_http_get.call_count == 1
    assert res2.get_json() == data1

    # Third request (case variant): Cache hit via geo:{query.lower()}
    res3 = client.get("/api/geocoding?q=TOKYO")
    assert res3.status_code == 200
    assert mock_http_get.call_count == 1
    assert res3.get_json() == data1


def test_cache_isolation_by_parameters(client, monkeypatch):
    """
    Verify cache isolation across distinct query parameters:
    - Distinct coordinates produce distinct cache keys and separate upstream requests.
    - Distinct timezones produce distinct cache keys (weather:{lat}:{lon}:{timezone}).
    - Distinct geocoding queries produce distinct cache keys.
    """
    with RATE_LOCK:
        RATE_BUCKETS.clear()

    def dynamic_http_get(url, params=None, **kwargs):
        mock_resp = MagicMock()
        mock_resp.ok = True
        mock_resp.status_code = 200
        mock_resp.raise_for_status.return_value = None
        if "forecast" in url:
            lat = params.get("latitude")
            lon = params.get("longitude")
            tz = params.get("timezone", "auto")
            mock_resp.json.return_value = {
                "latitude": lat,
                "longitude": lon,
                "timezone": tz,
                "current": {"temperature_2m": 25.0 if lat > 50 else 10.0}
            }
        elif "search" in url:
            name = params.get("name")
            mock_resp.json.return_value = {
                "results": [
                    {"id": 101, "name": name, "latitude": 12.34, "longitude": 56.78, "country": "TestCountry", "country_code": "TC", "admin1": "Admin", "timezone": "UTC"},
                    {"id": 102, "name": f"{name} Metro", "latitude": 12.35, "longitude": 56.79, "country": "TestCountry", "country_code": "TC", "admin1": "Admin", "timezone": "UTC"}
                ]
            }
        return mock_resp

    mock_http_get = MagicMock(side_effect=dynamic_http_get)
    monkeypatch.setattr("app.http_get", mock_http_get)

    # 1. Weather Coordinate Isolation
    res_paris = client.get("/api/weather?lat=48.8566&lon=2.3522")
    assert res_paris.status_code == 200
    assert mock_http_get.call_count == 1
    assert res_paris.get_json()["latitude"] == 48.8566

    res_berlin = client.get("/api/weather?lat=52.5200&lon=13.4050")
    assert res_berlin.status_code == 200
    assert mock_http_get.call_count == 2
    assert res_berlin.get_json()["latitude"] == 52.52

    # Re-request Paris and Berlin to verify independent caching
    assert client.get("/api/weather?lat=48.8566&lon=2.3522").status_code == 200
    assert client.get("/api/weather?lat=52.5200&lon=13.4050").status_code == 200
    assert mock_http_get.call_count == 2  # Zero additional calls

    # 2. Weather Timezone Isolation
    res_berlin_tz = client.get("/api/weather?lat=52.5200&lon=13.4050&timezone=Europe/Berlin")
    assert res_berlin_tz.status_code == 200
    assert mock_http_get.call_count == 3
    assert res_berlin_tz.get_json()["timezone"] == "Europe/Berlin"

    # 3. Geocoding Query Isolation
    res_geo_paris = client.get("/api/geocoding?q=Paris")
    assert res_geo_paris.status_code == 200
    assert mock_http_get.call_count == 4
    assert res_geo_paris.get_json()["results"][0]["name"] == "Paris"

    res_geo_london = client.get("/api/geocoding?q=London")
    assert res_geo_london.status_code == 200
    assert mock_http_get.call_count == 5
    assert res_geo_london.get_json()["results"][0]["name"] == "London"


def test_cache_ttl_expiration_forces_upstream_refetch(client, monkeypatch):
    """
    Verify that when cache TTL expires, subsequent requests bypass the stale cache
    and execute a new upstream network call.
    """
    with RATE_LOCK:
        RATE_BUCKETS.clear()

    current_time = 1000000.0
    monkeypatch.setattr("app.time.time", lambda: current_time)

    mock_resp = MagicMock()
    mock_resp.ok = True
    mock_resp.status_code = 200
    mock_resp.raise_for_status.return_value = None
    mock_resp.json.return_value = {
        "latitude": 48.8566,
        "longitude": 2.3522,
        "current": {"temperature_2m": 15.0}
    }

    mock_http_get = MagicMock(return_value=mock_resp)
    monkeypatch.setattr("app.http_get", mock_http_get)

    # Initial request at t = 1,000,000.0 (fresh until t = 1,000,600.0)
    res1 = client.get("/api/weather?lat=48.8566&lon=2.3522")
    assert res1.status_code == 200
    assert mock_http_get.call_count == 1

    # Request at t = 1,000,300.0 (within TTL) -> Cache hit
    current_time = 1000300.0
    res2 = client.get("/api/weather?lat=48.8566&lon=2.3522")
    assert res2.status_code == 200
    assert mock_http_get.call_count == 1

    # Advance time past TTL (CACHE_TTL_WEATHER = 600s) -> t = 1,000,650.0
    current_time = 1000650.0
    mock_resp.json.return_value = {
        "latitude": 48.8566,
        "longitude": 2.3522,
        "current": {"temperature_2m": 19.0}
    }
    res3 = client.get("/api/weather?lat=48.8566&lon=2.3522")
    assert res3.status_code == 200
    assert mock_http_get.call_count == 2
    assert res3.get_json()["current"]["temperature_2m"] == 19.0


def test_weather_stale_while_revalidate_on_upstream_failure(client, monkeypatch):
    """
    Verify Stale-While-Revalidate resiliency (AUDIT_REPORT §8.11 / RESL-ARCH-02):
    - When cache entry is stale (fresh_until < now < stale_until), and upstream fails,
    - app.py serves candidate data from CACHE with header X-Zephyr-Stale: 1 and status 200.
    - When expired past stale_until, candidate is evicted and returns 502.
    """
    import requests

    with RATE_LOCK:
        RATE_BUCKETS.clear()
    WEATHER_BREAKER.state = "CLOSED"
    WEATHER_BREAKER.failures = 0

    current_time = 1000000.0
    monkeypatch.setattr("app.time.time", lambda: current_time)

    # 1. Populate cache at t=1,000,000 (fresh_until=1,000,600; stale_until=1,007,200)
    mock_resp = MagicMock()
    mock_resp.ok = True
    mock_resp.status_code = 200
    mock_resp.raise_for_status.return_value = None
    mock_resp.json.return_value = {
        "latitude": 48.8566,
        "longitude": 2.3522,
        "current": {"temperature_2m": 14.0}
    }
    mock_http_get = MagicMock(return_value=mock_resp)
    monkeypatch.setattr("app.http_get", mock_http_get)

    res1 = client.get("/api/weather?lat=48.8566&lon=2.3522")
    assert res1.status_code == 200
    assert mock_http_get.call_count == 1

    # 2. Advance time into stale window (t = 1,001,000; fresh_until has passed, stale_until hasn't)
    current_time = 1001000.0
    mock_http_get.side_effect = requests.exceptions.ConnectionError("Open-Meteo gateway timeout")

    res_stale = client.get("/api/weather?lat=48.8566&lon=2.3522")
    assert res_stale.status_code == 200
    assert res_stale.headers.get("X-Zephyr-Stale") == "1"
    assert res_stale.get_json()["current"]["temperature_2m"] == 14.0

    # 3. Advance time past stale_until (t = 1,010,000 > 1,007,200)
    current_time = 1010000.0
    res_dead = client.get("/api/weather?lat=48.8566&lon=2.3522")
    assert res_dead.status_code == 502
    assert "Failed to fetch weather forecast data" in res_dead.get_json()["error"]


def test_cache_lru_capacity_eviction(monkeypatch):
    """
    Verify bounded OrderedDict LRU cache evicts oldest item under CACHE_LOCK (AUDIT_REPORT §8.1 / ISSUE-BE-01):
    - Sets MAX_CACHE_SIZE to 3.
    - Inserts items 'a', 'b', 'c'.
    - Accesses 'a' to promote to MRU.
    - Inserts 'd'.
    - Confirms 'b' (oldest LRU item) is evicted, while 'a', 'c', and 'd' remain.
    """
    with CACHE_LOCK:
        CACHE.clear()

    monkeypatch.setattr("app.MAX_CACHE_SIZE", 3)

    set_to_cache("a", "val_a", ttl=100)
    set_to_cache("b", "val_b", ttl=100)
    set_to_cache("c", "val_c", ttl=100)
    assert len(CACHE) == 3

    # Access 'a' to make it most recently used
    assert get_from_cache("a") == "val_a"

    # Insert 'd'; 'b' is least recently used, so 'b' must be evicted
    set_to_cache("d", "val_d", ttl=100)
    assert len(CACHE) == 3
    assert get_from_cache("b") is None
    assert get_from_cache("a") == "val_a"
    assert get_from_cache("c") == "val_c"
    assert get_from_cache("d") == "val_d"

    with CACHE_LOCK:
        CACHE.clear()


def test_air_quality_cache_hit_deduplication(client, monkeypatch):
    """
    Verify cache hit deduplication for /api/air-quality:
    - First call queries upstream via http_get.
    - Second call hits CACHE (call_count remains 1).
    """
    with RATE_LOCK:
        RATE_BUCKETS.clear()

    aqi_payload = {
        "latitude": 33.58,
        "longitude": -7.60,
        "current": {"us_aqi": 42, "pm2_5": 10.5, "pm10": 22.0}
    }

    mock_resp = MagicMock()
    mock_resp.ok = True
    mock_resp.status_code = 200
    mock_resp.raise_for_status.return_value = None
    mock_resp.json.return_value = aqi_payload

    mock_http_get = MagicMock(return_value=mock_resp)
    monkeypatch.setattr("app.http_get", mock_http_get)

    res1 = client.get("/api/air-quality?lat=33.58&lon=-7.60")
    assert res1.status_code == 200
    assert mock_http_get.call_count == 1

    res2 = client.get("/api/air-quality?lat=33.58&lon=-7.60")
    assert res2.status_code == 200
    assert mock_http_get.call_count == 1
    assert res2.get_json() == res1.get_json()


