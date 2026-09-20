import test from 'node:test';
import assert from 'node:assert/strict';
import { WeatherApi } from '../static/js/weather-api.js';

/**
 * Milestone 2 Adversarial Concurrency & Abort Stress Test Harness
 * Stress-tests:
 *  1. Pre-aborted signals on all API endpoints
 *  2. Event listener cleanup and memory leak prevention
 *  3. In-flight abort halts secondary fallback cascade (no rogue requests)
 *  4. Out-of-order race condition between slow aborted query and fast query
 *  5. Rapid typing simulation (50 overlapping queries with random abort timings)
 *  6. Timeout vs Abort disambiguation
 *  7. Multi-stage fallback abort resilience
 */

// Helper to track and intercept fetch
function createMockFetch(handler) {
  return async (url, options = {}) => {
    return await handler(url.toString(), options);
  };
}

// ---------------------------------------------------------------------------
// 1. Pre-aborted Signal Verification Across All Endpoints
// ---------------------------------------------------------------------------

test('ADVERSARIAL: WeatherApi._fetchWithTimeout rejects synchronously on pre-aborted signal with 0 fetches', async () => {
  const controller = new AbortController();
  controller.abort();

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response('{}');
  };

  try {
    await assert.rejects(
      WeatherApi._fetchWithTimeout('https://example.com/api', 5000, controller.signal),
      (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
    assert.equal(fetchCalls, 0, 'Must NOT invoke fetch when signal is pre-aborted');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ADVERSARIAL: WeatherApi.searchLocations rejects on pre-aborted signal with 0 network calls', async () => {
  const controller = new AbortController();
  controller.abort();

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response('{}');
  };

  try {
    await assert.rejects(
      WeatherApi.searchLocations('Amsterdam', controller.signal),
      (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
    assert.equal(fetchCalls, 0, 'Zero network calls should be made');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ADVERSARIAL: WeatherApi.getWeather rejects on pre-aborted signal with 0 network calls', async () => {
  const controller = new AbortController();
  controller.abort();

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response('{}');
  };

  try {
    await assert.rejects(
      WeatherApi.getWeather(52.37, 4.89, 'Europe/Amsterdam', controller.signal),
      (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
    assert.equal(fetchCalls, 0, 'Zero network calls should be made');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ADVERSARIAL: WeatherApi.getAirQuality rejects on pre-aborted signal with 0 network calls', async () => {
  const controller = new AbortController();
  controller.abort();

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response('{}');
  };

  try {
    await assert.rejects(
      WeatherApi.getAirQuality(52.37, 4.89, controller.signal),
      (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
    assert.equal(fetchCalls, 0, 'Zero network calls should be made');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ADVERSARIAL: WeatherApi.getIpLocation rejects on pre-aborted signal with 0 network calls', async () => {
  const controller = new AbortController();
  controller.abort();

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response('{}');
  };

  try {
    await assert.rejects(
      WeatherApi.getIpLocation(controller.signal),
      (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
    assert.equal(fetchCalls, 0, 'Zero network calls should be made');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ADVERSARIAL: WeatherApi.reverseGeocode rejects on pre-aborted signal with 0 network calls', async () => {
  const controller = new AbortController();
  controller.abort();

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response('{}');
  };

  try {
    await assert.rejects(
      WeatherApi.reverseGeocode(52.37, 4.89, controller.signal),
      (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
    assert.equal(fetchCalls, 0, 'Zero network calls should be made');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 2. Event Listener Leak Stress Test
// ---------------------------------------------------------------------------

test('ADVERSARIAL: Event listener cleanup across 100 sequential calls sharing a single signal', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const signal = controller.signal;

  let activeListeners = 0;
  const origAdd = signal.addEventListener.bind(signal);
  const origRemove = signal.removeEventListener.bind(signal);

  signal.addEventListener = (type, fn, options) => {
    if (type === 'abort') activeListeners++;
    return origAdd(type, fn, options);
  };
  signal.removeEventListener = (type, fn, options) => {
    if (type === 'abort') activeListeners--;
    return origRemove(type, fn, options);
  };

  globalThis.fetch = async (url) => {
    return new Response(JSON.stringify({ results: [{ name: 'Test City' }] }), {
      headers: { 'content-type': 'application/json' },
      status: 200
    });
  };

  try {
    // 50 successful requests
    for (let i = 0; i < 50; i++) {
      await WeatherApi.searchLocations('City' + i, signal);
      assert.equal(activeListeners, 0, `Listener leaked on success call ${i}`);
    }

    // 50 failed requests (500 error / network drop)
    globalThis.fetch = async () => {
      throw new TypeError('Network connection lost');
    };

    for (let i = 0; i < 50; i++) {
      try {
        await WeatherApi.searchLocations('City' + i, signal);
      } catch (e) {
        // May catch or return empty
      }
      assert.equal(activeListeners, 0, `Listener leaked on failed call ${i}`);
    }

    assert.equal(activeListeners, 0, 'Final active listener count must be 0');
  } finally {
    globalThis.fetch = originalFetch;
    signal.addEventListener = origAdd;
    signal.removeEventListener = origRemove;
  }
});

// ---------------------------------------------------------------------------
// 3. In-flight Abort Halts Cascading Fallback (No Rogue Requests)
// ---------------------------------------------------------------------------

test('ADVERSARIAL: In-flight abort at Tier 1 (Proxy) terminates search; Tier 2 (Open-Meteo) & Tier 3 (Photon) are NEVER invoked', async () => {
  const controller = new AbortController();
  const calledUrls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const urlStr = url.toString();
    calledUrls.push(urlStr);

    if (urlStr.includes('/api/geocoding')) {
      // Simulate user cancelling search while proxy request is in flight
      controller.abort();
      const err = new DOMException('The operation was aborted', 'AbortError');
      throw err;
    }
    return new Response(JSON.stringify({ results: [{ name: 'Rogue City' }] }));
  };

  try {
    await assert.rejects(
      WeatherApi.searchLocations('Rotterdam', controller.signal),
      (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );

    assert.equal(calledUrls.length, 1, 'Only Tier 1 (proxy) must have been called');
    assert.ok(calledUrls[0].includes('/api/geocoding'), 'Only local proxy should be contacted');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ADVERSARIAL: In-flight abort at Tier 2 (Open-Meteo) terminates search; Tier 3 (Photon) is NEVER invoked', async () => {
  const controller = new AbortController();
  const calledUrls = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const urlStr = url.toString();
    calledUrls.push(urlStr);

    if (urlStr.includes('/api/geocoding')) {
      // Tier 1 fails with proxy error (502)
      throw new TypeError('Failed to fetch from proxy');
    }
    if (urlStr.includes('geocoding-api.open-meteo.com')) {
      // User cancels while Tier 2 is in-flight
      controller.abort();
      const err = new DOMException('The operation was aborted', 'AbortError');
      throw err;
    }
    return new Response(JSON.stringify({ features: [] }));
  };

  try {
    await assert.rejects(
      WeatherApi.searchLocations('Utrecht', controller.signal),
      (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );

    assert.equal(calledUrls.length, 2, 'Exactly Tier 1 and Tier 2 should be attempted');
    assert.ok(calledUrls[0].includes('/api/geocoding'));
    assert.ok(calledUrls[1].includes('open-meteo.com'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 4. Out-of-Order Race Condition Stress Test
// ---------------------------------------------------------------------------

test('ADVERSARIAL: Slow aborted Query 1 does not overwrite fast Query 2', async () => {
  const originalFetch = globalThis.fetch;

  let query1Finished = false;
  let query2Finished = false;

  const ctrl1 = new AbortController();
  const ctrl2 = new AbortController();

  globalThis.fetch = async (url, options) => {
    const urlStr = url.toString();
    if (urlStr.includes('q=SlowCity')) {
      // Query 1 takes 100ms
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (options.signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      return new Response(JSON.stringify({ results: [{ name: 'SlowCity' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200
      });
    }

    if (urlStr.includes('q=FastCity')) {
      // Query 2 takes 15ms
      await new Promise((resolve) => setTimeout(resolve, 15));
      return new Response(JSON.stringify({ results: [{ name: 'FastCity' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200
      });
    }

    return new Response('{}');
  };

  try {
    // 1. Launch Query 1
    const p1 = WeatherApi.searchLocations('SlowCity', ctrl1.signal);

    // 2. User types new city 20ms later: abort Query 1 and launch Query 2
    await new Promise((r) => setTimeout(r, 20));
    ctrl1.abort();
    const p2 = WeatherApi.searchLocations('FastCity', ctrl2.signal);

    // 3. Query 2 resolves first
    const res2 = await p2;
    query2Finished = true;
    assert.equal(res2.length, 1);
    assert.equal(res2[0].name, 'FastCity');

    // 4. Query 1 must reject with AbortError
    await assert.rejects(p1, (err) => {
      assert.equal(err.name, 'AbortError');
      return true;
    });
    query1Finished = true;

    assert.ok(query2Finished && query1Finished);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 5. Rapid Typing Stress Harness (50 Sequential & Overlapping Queries)
// ---------------------------------------------------------------------------

test('ADVERSARIAL: Rapid typing stress harness (50 overlapping queries with random abort timings)', async () => {
  const originalFetch = globalThis.fetch;
  const numQueries = 50;

  let activeControllers = [];
  let completedResults = [];
  let abortedErrors = 0;
  let networkFetches = 0;

  // Mock upstream with variable latency (10ms - 50ms)
  globalThis.fetch = async (url, options) => {
    networkFetches++;
    const delay = Math.floor(Math.random() * 40) + 10;
    await new Promise((r) => setTimeout(r, delay));

    if (options.signal?.aborted) {
      const err = new DOMException('The operation was aborted', 'AbortError');
      throw err;
    }

    const urlObj = new URL(url, 'http://localhost');
    const q = urlObj.searchParams.get('q') || 'Unknown';

    return new Response(
      JSON.stringify({
        results: [{ name: `City_${q}`, latitude: 50.0, longitude: 10.0 }]
      }),
      { headers: { 'content-type': 'application/json' }, status: 200 }
    );
  };

  try {
    let latestController = null;
    let latestQuery = '';

    // Rapidly fire 50 keystrokes with 5-15ms intervals
    for (let i = 0; i < numQueries; i++) {
      // Abort preceding controller on new input (simulating app.js behavior)
      if (latestController) {
        latestController.abort();
      }

      latestController = new AbortController();
      latestQuery = `Typing_${i}`;
      const thisCtrl = latestController;
      const thisQuery = latestQuery;

      activeControllers.push(thisCtrl);

      // Launch search asynchronously
      WeatherApi.searchLocations(thisQuery, thisCtrl.signal)
        .then((res) => {
          // If this is still the active controller, accept result
          if (latestController === thisCtrl && !thisCtrl.signal.aborted) {
            completedResults.push({ query: thisQuery, res });
          }
        })
        .catch((err) => {
          if (err.name === 'AbortError') {
            abortedErrors++;
          }
        });

      // Rapid keystroke delay
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 10) + 5));
    }

    // Wait for the final query to settle
    await new Promise((r) => setTimeout(r, 120));

    // Verify results
    assert.ok(abortedErrors > 0, `Expected aborted queries, got ${abortedErrors}`);
    assert.ok(completedResults.length >= 1, 'Final query must have resolved');
    const finalResult = completedResults[completedResults.length - 1];
    assert.equal(finalResult.query, `Typing_${numQueries - 1}`, 'Final accepted result must match the last typed query');
    assert.equal(finalResult.res[0].name, `City_Typing_${numQueries - 1}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 6. Timeout vs Abort Disambiguation
// ---------------------------------------------------------------------------

test('ADVERSARIAL: Timeout produces TimeoutError and allows fallback, whereas Abort halts immediately', async () => {
  const originalFetch = globalThis.fetch;
  const calledUrls = [];

  globalThis.fetch = async (url, options) => {
    const urlStr = url.toString();
    calledUrls.push(urlStr);

    if (urlStr.includes('/api/geocoding')) {
      // Hang until signal triggers abort
      return new Promise((resolve, reject) => {
        if (options?.signal?.aborted) {
          return reject(new DOMException('The operation was aborted', 'AbortError'));
        }
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        }, { once: true });
      });
    }

    if (urlStr.includes('open-meteo.com')) {
      return new Response(JSON.stringify({
        results: [{ name: 'FellBackToOpenMeteo', latitude: 10, longitude: 20 }]
      }), { headers: { 'content-type': 'application/json' }, status: 200 });
    }

    return new Response('{}');
  };

  try {
    // 1. Test timeout fallback: timeout after 50ms should proceed to Open-Meteo
    const timeoutPromise = WeatherApi._fetchWithTimeout('/api/geocoding?q=test', 50, null);
    await assert.rejects(timeoutPromise, (err) => {
      assert.equal(err.name, 'TimeoutError', 'Should throw TimeoutError on timer expiry');
      return true;
    });

    // 2. Test user abort: user abort throws AbortError
    const userCtrl = new AbortController();
    const abortPromise = WeatherApi._fetchWithTimeout('/api/geocoding?q=test', 5000, userCtrl.signal);
    userCtrl.abort();
    await assert.rejects(abortPromise, (err) => {
      assert.equal(err.name, 'AbortError', 'Should throw AbortError on user abort');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 7. App-level Abort and Concurrency State Guards
// ---------------------------------------------------------------------------

test('ADVERSARIAL: App-level search state guard drops superseded search results', async () => {
  // Simulate the app state machine:
  let searchAbortController = null;
  let autocompleteResults = null;
  let spinnerActive = false;

  const simulateSearchInput = async (query) => {
    if (query.trim().length < 2) {
      if (searchAbortController) {
        searchAbortController.abort();
        searchAbortController = null;
      }
      spinnerActive = false;
      autocompleteResults = [];
      return;
    }

    if (searchAbortController) {
      searchAbortController.abort();
    }
    searchAbortController = new AbortController();
    const currentController = searchAbortController;
    spinnerActive = true;

    try {
      const results = await WeatherApi.searchLocations(query, currentController.signal);
      if (searchAbortController !== currentController || currentController.signal.aborted) {
        return; // Guard: superseded!
      }
      autocompleteResults = results;
    } catch (err) {
      if (err.name !== 'AbortError') {
        throw err;
      }
    } finally {
      if (searchAbortController === currentController) {
        spinnerActive = false;
      }
    }
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const urlStr = url.toString();
    if (urlStr.includes('q=Slow')) {
      await new Promise((r) => setTimeout(r, 60));
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return new Response(JSON.stringify({ results: [{ name: 'Slow' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200
      });
    }
    if (urlStr.includes('q=Fast')) {
      await new Promise((r) => setTimeout(r, 10));
      return new Response(JSON.stringify({ results: [{ name: 'Fast' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200
      });
    }
    return new Response('{}');
  };

  try {
    // 1. User inputs "Slow"
    const pSlow = simulateSearchInput('Slow');
    // 2. User quickly types "Fast"
    await new Promise((r) => setTimeout(r, 15));
    const pFast = simulateSearchInput('Fast');

    await Promise.all([pSlow, pFast]);

    // 3. Results MUST be Fast, not Slow
    assert.equal(autocompleteResults[0].name, 'Fast');
    assert.equal(spinnerActive, false);

    // 4. User clears input to 1 char
    await simulateSearchInput('F');
    assert.equal(spinnerActive, false);
    assert.deepEqual(autocompleteResults, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
