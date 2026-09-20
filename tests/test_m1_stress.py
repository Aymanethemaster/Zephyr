"""
Milestone 1 Concurrency, Memory Bounds & Security Stress Test Suite.
Empirical verification for LRU cache bounds, rate limiter flood protection,
multi-threaded concurrency safety, and SSRF prevention.
"""
import sys
import os
import time
import threading
from collections import deque
import pytest

# Ensure repository root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app import (
    app,
    CACHE,
    CACHE_LOCK,
    MAX_CACHE_SIZE,
    get_from_cache,
    set_to_cache,
    RATE_BUCKETS,
    RATE_LOCK,
    MAX_RATE_BUCKETS,
    check_rate_limit,
    http_get,
    HTTP_SESSION,
)


def test_cache_bound_and_lru_eviction():
    """Verify cache bounds to 2,000 entries, evicts oldest, and get_from_cache updates LRU."""
    with CACHE_LOCK:
        CACHE.clear()

    # Insert 2,500 distinct items
    for i in range(2500):
        set_to_cache(f"item_{i}", f"val_{i}", ttl=300)
        assert len(CACHE) <= MAX_CACHE_SIZE

    assert len(CACHE) == MAX_CACHE_SIZE

    # Oldest 500 items (0..499) must be evicted
    for i in range(500):
        assert get_from_cache(f"item_{i}") is None

    # Items 500..2499 must be present
    for i in range(500, 2500):
        assert get_from_cache(f"item_{i}") == f"val_{i}"

    # Access item_500 to update its LRU position to most-recently-used
    assert get_from_cache("item_500") == "val_500"

    # Insert one new item (item_2500); item_501 should be evicted instead of item_500
    set_to_cache("item_2500", "val_2500", ttl=300)
    assert len(CACHE) == MAX_CACHE_SIZE
    assert get_from_cache("item_501") is None
    assert get_from_cache("item_500") == "val_500"

    with CACHE_LOCK:
        CACHE.clear()


def test_rate_limit_flood_eviction_prevention():
    """Verify saturating RATE_BUCKETS to 5,000 active entries rejects new IP and preserves active buckets."""
    with RATE_LOCK:
        RATE_BUCKETS.clear()

    now = time.time()
    with RATE_LOCK:
        for i in range(MAX_RATE_BUCKETS):
            RATE_BUCKETS[f"active_ip_{i}"] = deque([now - 5])

    assert len(RATE_BUCKETS) == MAX_RATE_BUCKETS

    # Attempt to register a new IP when table is fully saturated with active clients
    with app.test_request_context("/", environ_base={"REMOTE_ADDR": "198.51.100.99"}):
        allowed = check_rate_limit()

    assert allowed is False
    assert len(RATE_BUCKETS) == MAX_RATE_BUCKETS
    assert "198.51.100.99" not in RATE_BUCKETS
    assert "active_ip_0" in RATE_BUCKETS

    # Existing active IP within quota can still make requests
    with app.test_request_context("/", environ_base={"REMOTE_ADDR": "active_ip_10"}):
        allowed_existing = check_rate_limit()

    assert allowed_existing is True

    with RATE_LOCK:
        RATE_BUCKETS.clear()


def test_multithreaded_concurrency_stress():
    """Execute 50 concurrent threads accessing cache and rate limiters simultaneously."""
    errors = []
    num_threads = 50
    ops_per_thread = 100

    def worker(tid):
        try:
            for op in range(ops_per_thread):
                key = f"thread_key_{tid}_{op % 10}"
                ip = f"10.{(tid % 10)}.{(op % 20)}.1"

                if op % 2 == 0:
                    set_to_cache(key, f"val_{tid}_{op}", ttl=60)
                    _ = get_from_cache(key)
                else:
                    with app.test_request_context("/", environ_base={"REMOTE_ADDR": ip}):
                        _ = check_rate_limit()
        except Exception as e:
            errors.append((tid, str(e)))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(num_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
        assert not t.is_alive(), f"Thread {t.name} timed out"

    assert len(errors) == 0, f"Encountered concurrency errors: {errors}"
    assert len(CACHE) <= MAX_CACHE_SIZE
    assert len(RATE_BUCKETS) <= MAX_RATE_BUCKETS


def test_ssrf_allow_redirects_disabled():
    """Verify http_get unconditionally sets allow_redirects=False by default."""
    captured_kwargs = []

    class DummyResponse:
        status_code = 200
        def raise_for_status(self):
            pass
        def json(self):
            return {}

    saved_method = HTTP_SESSION.get
    def fake_get(url, **kwargs):
        captured_kwargs.append(kwargs)
        return DummyResponse()

    HTTP_SESSION.get = fake_get
    try:
        http_get("https://api.example.com/test")
        assert len(captured_kwargs) == 1
        assert captured_kwargs[0].get("allow_redirects") is False

        http_get("https://api.example.com/test2", timeout=5)
        assert len(captured_kwargs) == 2
        assert captured_kwargs[1].get("allow_redirects") is False
    finally:
        HTTP_SESSION.get = saved_method
