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
    with app.test_client() as c:
        yield c


# --- clean_location_name -------------------------------------------------

def test_clean_name_plain():
    assert clean_location_name("Paris") == "Paris"


def test_clean_name_strips_suffixes():
    assert clean_location_name("London/City of London;Greater London") == "London"


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
