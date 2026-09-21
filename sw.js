/**
 * Zephyr Weather App - Progressive Web App Service Worker
 * Implements:
 * - Stale-While-Revalidate for unversioned static assets
 * - Cache partitioning (STATIC_CACHE vs DATA_CACHE)
 * - Bounded LRU cache trimming for dynamic API responses
 * - Complete offline precache manifest for all weather condition SVGs
 * - Clean lifecycle upgrades (skipWaiting, clients.claim, cache pruning)
 */

const STATIC_CACHE = 'zephyr-static-v2.6';
const DATA_CACHE = 'zephyr-data-v2.6';
const MAX_DATA_CACHE_ITEMS = 50;

const PRECACHE_URLS = [
  // Application Shell & Manifest
  '/',
  '/index.html',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/js/utils.js',
  '/static/js/weather-api.js',
  '/static/js/weather-params.json',
  '/static/manifest.json',

  // PWA Application Icons
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',

  // All Application & Weather Condition Vector Icons (122 SVGs)
  '/static/icons/barometer.svg',
  '/static/icons/celsius.svg',
  '/static/icons/clear-day.svg',
  '/static/icons/clear-night.svg',
  '/static/icons/cloudy.svg',
  '/static/icons/compass.svg',
  '/static/icons/drizzle.svg',
  '/static/icons/dust.svg',
  '/static/icons/dust-day.svg',
  '/static/icons/dust-night.svg',
  '/static/icons/dust-wind.svg',
  '/static/icons/fahrenheit.svg',
  '/static/icons/falling-stars.svg',
  '/static/icons/fog.svg',
  '/static/icons/fog-day.svg',
  '/static/icons/fog-night.svg',
  '/static/icons/hail.svg',
  '/static/icons/haze.svg',
  '/static/icons/haze-day.svg',
  '/static/icons/haze-night.svg',
  '/static/icons/horizon.svg',
  '/static/icons/humidity.svg',
  '/static/icons/hurricane.svg',
  '/static/icons/lightning-bolt.svg',
  '/static/icons/mist.svg',
  '/static/icons/moon-first-quarter.svg',
  '/static/icons/moon-full.svg',
  '/static/icons/moon-last-quarter.svg',
  '/static/icons/moon-new.svg',
  '/static/icons/moon-waning-crescent.svg',
  '/static/icons/moon-waning-gibbous.svg',
  '/static/icons/moon-waxing-crescent.svg',
  '/static/icons/moon-waxing-gibbous.svg',
  '/static/icons/moonrise.svg',
  '/static/icons/moonset.svg',
  '/static/icons/not-available.svg',
  '/static/icons/overcast.svg',
  '/static/icons/overcast-day.svg',
  '/static/icons/overcast-night.svg',
  '/static/icons/partly-cloudy-day.svg',
  '/static/icons/partly-cloudy-day-drizzle.svg',
  '/static/icons/partly-cloudy-day-fog.svg',
  '/static/icons/partly-cloudy-day-hail.svg',
  '/static/icons/partly-cloudy-day-haze.svg',
  '/static/icons/partly-cloudy-day-rain.svg',
  '/static/icons/partly-cloudy-day-sleet.svg',
  '/static/icons/partly-cloudy-day-smoke.svg',
  '/static/icons/partly-cloudy-day-snow.svg',
  '/static/icons/partly-cloudy-night.svg',
  '/static/icons/partly-cloudy-night-drizzle.svg',
  '/static/icons/partly-cloudy-night-fog.svg',
  '/static/icons/partly-cloudy-night-hail.svg',
  '/static/icons/partly-cloudy-night-haze.svg',
  '/static/icons/partly-cloudy-night-rain.svg',
  '/static/icons/partly-cloudy-night-sleet.svg',
  '/static/icons/partly-cloudy-night-smoke.svg',
  '/static/icons/partly-cloudy-night-snow.svg',
  '/static/icons/pressure-high.svg',
  '/static/icons/pressure-high-alt.svg',
  '/static/icons/pressure-low.svg',
  '/static/icons/pressure-low-alt.svg',
  '/static/icons/rain.svg',
  '/static/icons/raindrop.svg',
  '/static/icons/raindrops.svg',
  '/static/icons/sleet.svg',
  '/static/icons/smoke.svg',
  '/static/icons/smoke-particles.svg',
  '/static/icons/snow.svg',
  '/static/icons/snowflake.svg',
  '/static/icons/solar-eclipse.svg',
  '/static/icons/star.svg',
  '/static/icons/starry-night.svg',
  '/static/icons/sunrise.svg',
  '/static/icons/sunset.svg',
  '/static/icons/thermometer.svg',
  '/static/icons/thermometer-celsius.svg',
  '/static/icons/thermometer-colder.svg',
  '/static/icons/thermometer-fahrenheit.svg',
  '/static/icons/thermometer-glass.svg',
  '/static/icons/thermometer-glass-celsius.svg',
  '/static/icons/thermometer-glass-fahrenheit.svg',
  '/static/icons/thermometer-mercury.svg',
  '/static/icons/thermometer-mercury-cold.svg',
  '/static/icons/thermometer-warmer.svg',
  '/static/icons/thunderstorms.svg',
  '/static/icons/thunderstorms-day.svg',
  '/static/icons/thunderstorms-day-rain.svg',
  '/static/icons/thunderstorms-day-snow.svg',
  '/static/icons/thunderstorms-night.svg',
  '/static/icons/thunderstorms-night-rain.svg',
  '/static/icons/thunderstorms-night-snow.svg',
  '/static/icons/thunderstorms-rain.svg',
  '/static/icons/thunderstorms-snow.svg',
  '/static/icons/tornado.svg',
  '/static/icons/umbrella.svg',
  '/static/icons/uv-index.svg',
  '/static/icons/uv-index-1.svg',
  '/static/icons/uv-index-2.svg',
  '/static/icons/uv-index-3.svg',
  '/static/icons/uv-index-4.svg',
  '/static/icons/uv-index-5.svg',
  '/static/icons/uv-index-6.svg',
  '/static/icons/uv-index-7.svg',
  '/static/icons/uv-index-8.svg',
  '/static/icons/uv-index-9.svg',
  '/static/icons/uv-index-10.svg',
  '/static/icons/uv-index-11.svg',
  '/static/icons/wind.svg',
  '/static/icons/wind-beaufort-0.svg',
  '/static/icons/wind-beaufort-1.svg',
  '/static/icons/wind-beaufort-2.svg',
  '/static/icons/wind-beaufort-3.svg',
  '/static/icons/wind-beaufort-4.svg',
  '/static/icons/wind-beaufort-5.svg',
  '/static/icons/wind-beaufort-6.svg',
  '/static/icons/wind-beaufort-7.svg',
  '/static/icons/wind-beaufort-8.svg',
  '/static/icons/wind-beaufort-9.svg',
  '/static/icons/wind-beaufort-10.svg',
  '/static/icons/wind-beaufort-11.svg',
  '/static/icons/wind-beaufort-12.svg',
  '/static/icons/windsock.svg'
];

/**
 * Enforces a bounded size limit on the specified cache bucket using FIFO/LRU eviction.
 * Cache.keys() returns Request objects in chronological insertion order.
 */
async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const itemsToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(itemsToDelete.map((key) => cache.delete(key)));
    }
  } catch (err) {
    console.warn('trimCache warning for', cacheName, err);
  }
}

// Install: pre-cache static application shell and vector assets resiliently
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(new Request(url, { cache: 'reload' }));
            if (res.ok) {
              await cache.put(url, res);
            }
          } catch (err) {
            console.warn('Precache failed for', url, err);
          }
        })
      );
    })
  );
});

// Activate: purge any caches that are not the current version, then claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== STATIC_CACHE && name !== DATA_CACHE)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: Stale-While-Revalidate for static assets, Network-First for APIs & navigation
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and non-HTTP schemes (e.g. chrome-extension://)
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // Live weather, Geocoding & IP APIs: Network-first, fallback to bounded data cache
  const isApiRequest = url.pathname.startsWith('/api/') ||
    url.hostname.includes('open-meteo.com') ||
    url.hostname.includes('komoot.io') ||
    url.hostname.includes('bigdatacloud.net') ||
    url.hostname.includes('geojs.io');

  if (isApiRequest) {
    event.respondWith(
      fetch(request)
        .then(async (networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            const dataCache = await caches.open(DATA_CACHE);
            await dataCache.put(request, responseClone);
            await trimCache(DATA_CACHE, MAX_DATA_CACHE_ITEMS);
            return networkResponse;
          }
          // On 5xx server errors or 429 rate limit, serve stale data if present
          if (networkResponse && (networkResponse.status >= 500 || networkResponse.status === 429)) {
            const cached = await caches.open(DATA_CACHE).then((cache) => cache.match(request));
            return cached || networkResponse;
          }
          return networkResponse;
        })
        .catch(async () => {
          const cache = await caches.open(DATA_CACHE);
          return cache.match(request);
        })
    );
    return;
  }

  // App Navigation: Network first, fallback to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put('/index.html', responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match('/index.html').then((res) => res || caches.match('/')))
    );
    return;
  }

  // Static Assets (CSS, JS, SVG, Fonts): Stale-While-Revalidate
  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cachedResponse = await cache.match(request, { ignoreSearch: true });

      const fetchPromise = fetch(request)
        .then(async (networkResponse) => {
          if (networkResponse && networkResponse.status === 304) {
            if (cachedResponse) {
              return cachedResponse;
            }
            try {
              const fresh = await fetch(request.url, { cache: 'reload' });
              if (fresh && fresh.status === 200) {
                cache.put(request, fresh.clone());
                return fresh;
              }
            } catch (e) {
              // Ignore reload error and fall through
            }
          }

          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (url.origin === self.location.origin ||
             url.hostname.includes('googleapis.com') ||
             url.hostname.includes('gstatic.com'))
          ) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(async () => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (url.pathname.endsWith('.svg') || url.pathname.includes('/static/icons/')) {
            const fallback = await cache.match('/static/icons/not-available.svg');
            if (fallback) return fallback;
          }
          return fetch(request);
        });

      return cachedResponse || fetchPromise;
    })
  );
});
