import os
import sys
import time
import pytest

# Ensure repository root is on sys.path regardless of execution environment
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app import app, clean_location_name, get_from_cache, set_to_cache, CACHE


@pytest.fixture()
def client():
    app.config["TESTING"] = True
    CACHE.clear()
    with app.test_client() as c:
        yield c
    CACHE.clear()


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


