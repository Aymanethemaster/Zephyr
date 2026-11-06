"""M1 adversarial stress tests: concurrency, rate-limit floods, circuit-breaker
stampedes, and proxy / header edge cases."""
import threading
import time
from unittest.mock import patch, MagicMock

import pytest
import requests

import app as zephyr_app
from app import (
    app,
    _CACHE,
    _RATE_BUCKETS,
    _WEATHER_BREAKER,
    CircuitBreaker,
    _set_to_cache,
    _get_from_cache,
    _check_rate_limit,
    MAX_CACHE_SIZE,
    MAX_RATE_BUCKETS,
)


@pytest.fixture(autouse=True)
def reset_state():
    _CACHE.clear()
    _RATE_BUCKETS.clear()
    _WEATHER_BREAKER.failures = 0
    _WEATHER_BREAKER.state = 'CLOSED'
    _WEATHER_BREAKER._half_open_in_flight = False
    yield
    _CACHE.clear()
    _RATE_BUCKETS.clear()


def test_concurrent_cache_read_write_race():
    """Hammer _CACHE from 16 threads doing interleaved reads, writes, and evictions."""
    errors = []

    def worker(tid):
        try:
            for i in range(250):
                key = f"k:{(tid * 100 + i) % (MAX_CACHE_SIZE + 200)}"
                _set_to_cache(key, {'v': i}, ttl=10)
                _get_from_cache(key)
        except Exception as e:  # pragma: no cover
            errors.append(e)

    threads = [threading.Thread(target=worker, args=(t,)) for t in range(16)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    assert len(_CACHE) <= MAX_CACHE_SIZE


def test_rate_limit_sybil_flood_preserves_attacker_tracking(monkeypatch):
    """During a Sybil IP flood with MAX_RATE_BUCKETS active IPs, a tracked IP that has
    exhausted its quota must NOT be evicted and granted a fresh quota."""
    monkeypatch.setattr(zephyr_app, 'MAX_RATE_BUCKETS', 50)
    monkeypatch.setattr(zephyr_app, 'RATE_LIMIT_REQUESTS', 3)

    # Exhaust quota for victim/attacker IP "1.1.1.1"
    assert _check_rate_limit('1.1.1.1') is True
    assert _check_rate_limit('1.1.1.1') is True
    assert _check_rate_limit('1.1.1.1') is True
    assert _check_rate_limit('1.1.1.1') is False  # Now blocked

    # Flood with 49 other active IPs to fill MAX_RATE_BUCKETS (total = 50)
    for i in range(2, 51):
        assert _check_rate_limit(f'10.0.0.{i}') is True

    assert len(_RATE_BUCKETS) == 50

    # 51st unseen IP arrives while all 50 buckets are active: must be rejected (fail-closed)
    assert _check_rate_limit('99.99.99.99') is False

    # And crucially, 1.1.1.1 must STILL be rate-limited (not evicted!)
    assert _check_rate_limit('1.1.1.1') is False


def test_rate_limit_reclaims_expired_buckets_under_flood(monkeypatch):
    """Once old buckets expire outside RATE_LIMIT_WINDOW, new IPs are accepted again."""
    monkeypatch.setattr(zephyr_app, 'MAX_RATE_BUCKETS', 10)
    now = time.time()
    for i in range(10):
        _RATE_BUCKETS[f'old.{i}'] = [now - 120]  # Expired (>60s ago)

    assert _check_rate_limit('203.0.113.5') is True
    assert '203.0.113.5' in _RATE_BUCKETS


def test_circuit_breaker_half_open_single_flight():
    """When breaker recovery timeout elapses, only ONE concurrent thread may probe HALF_OPEN."""
    cb = CircuitBreaker(failure_threshold=2, recovery_timeout=0.05)
    cb.record_failure()
    cb.record_failure()
    assert cb.state == 'OPEN'

    time.sleep(0.06)

    results = []
    barrier = threading.Barrier(10)

    def probe():
        barrier.wait()
        results.append(cb.allow_request())

    threads = [threading.Thread(target=probe) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Exactly 1 canary probe should be allowed through while HALF_OPEN
    assert results.count(True) == 1
    assert results.count(False) == 9

    # Once canary fails, breaker re-opens immediately
    cb.record_failure()
    assert cb.state == 'OPEN'
    assert cb.allow_request() is False


def test_outbound_http_disables_redirects():
    """Verify _http_get passes allow_redirects=False to prevent open-redirect / SSRF hops."""
    with patch.object(zephyr_app._HTTP_SESSION, 'get') as mock_get:
        mock_get.return_value = MagicMock(status_code=200)
        zephyr_app._http_get('https://api.open-meteo.com/v1/forecast', params={'latitude': 0})
        _, kwargs = mock_get.call_args
        assert kwargs.get('allow_redirects') is False


def test_weather_params_single_source_of_truth():
    """Ensure app.py and static/js/weather-params.json stay in exact lockstep."""
    import json
    with open('static/js/weather-params.json', 'r', encoding='utf-8') as f:
        shared = json.load(f)
    assert zephyr_app.OPEN_METEO_PARAMS['current'] == shared['current']
    assert zephyr_app.OPEN_METEO_PARAMS['hourly'] == shared['hourly']
    assert zephyr_app.OPEN_METEO_PARAMS['daily'] == shared['daily']
    assert zephyr_app.OPEN_METEO_PARAMS['forecast_days'] == shared['forecast_days']
