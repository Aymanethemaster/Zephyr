/**
 * Zephyr Weather App - Progressive Web App Service Worker
 * Implements:
 * - Stale-While-Revalidate for unversioned static assets
 * - Cache partitioning (STATIC_CACHE vs DATA_CACHE)
 * - Bounded LRU cache trimming for dynamic API responses
 * - Complete offline precache manifest for all weather condition SVGs
 * - Clean lifecycle upgrades (skipWaiting, clients.claim, cache pruning)
 */

const STATIC_CACHE = 'zephyr-static-v1.5';
const DATA_CACHE = 'zephyr-data-v1';
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

  // UI & Atmospheric Base Icons
  '/static/icons/compass.svg',
  '/static/icons/not-available.svg',
  '/static/icons/thermometer.svg',
  '/static/icons/horizon.svg',
  '/static/icons/humidity.svg',
  '/static/icons/barometer.svg',
  '/static/icons/pressure-high.svg',
  '/static/icons/sunrise.svg',
  '/static/icons/sunset.svg',
  '/static/icons/dust.svg',
  '/static/icons/dust-day.svg',
  '/static/icons/dust-wind.svg',
  '/static/icons/raindrop.svg',
  '/static/icons/wind.svg',
  '/static/icons/uv-index.svg',

  // WMO Weather Condition Meteocons (Day & Night)
  '/static/icons/clear-day.svg',
  '/static/icons/clear-night.svg',
  '/static/icons/partly-cloudy-day.svg',
  '/static/icons/partly-cloudy-night.svg',
  '/static/icons/overcast-day.svg',
  '/static/icons/overcast-night.svg',
  '/static/icons/fog-day.svg',
  '/static/icons/fog-night.svg',
  '/static/icons/partly-cloudy-day-drizzle.svg',
  '/static/icons/partly-cloudy-night-drizzle.svg',
  '/static/icons/partly-cloudy-day-rain.svg',
  '/static/icons/partly-cloudy-night-rain.svg',
  '/static/icons/rain.svg',
  '/static/icons/sleet.svg',
  '/static/icons/partly-cloudy-day-snow.svg',
  '/static/icons/partly-cloudy-night-snow.svg',
  '/static/icons/snow.svg',
  '/static/icons/thunderstorms-day-rain.svg',
  '/static/icons/thunderstorms-night-rain.svg',
  '/static/icons/thunderstorms-rain.svg',

  // Astronomical Moon Phase Icons
  '/static/icons/moon-new.svg',
  '/static/icons/moon-waxing-crescent.svg',
  '/static/icons/moon-first-quarter.svg',
  '/static/icons/moon-waxing-gibbous.svg',
  '/static/icons/moon-full.svg',
  '/static/icons/moon-waning-gibbous.svg',
  '/static/icons/moon-last-quarter.svg',
  '/static/icons/moon-waning-crescent.svg',

  // Dynamic UV Index Level Icons (1-11)
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

  // Dynamic Wind Beaufort Scale Icons (0-12)
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
  '/static/icons/wind-beaufort-12.svg'
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

// Install: pre-cache static application shell and vector assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('Service worker precache failed:', err))
  );
});

// Activate: clean up outdated static shell caches and legacy unpartitioned caches, preserving dynamic offline data
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            // Delete outdated static caches
            if (name.startsWith('zephyr-static-') && name !== STATIC_CACHE) {
              return caches.delete(name);
            }
            // Delete legacy unpartitioned caches (e.g., zephyr-v1.4)
            if (name.startsWith('zephyr-v') && name !== STATIC_CACHE && name !== DATA_CACHE) {
              return caches.delete(name);
            }
            // Delete outdated data caches if DATA_CACHE schema/version is updated
            if (name.startsWith('zephyr-data-') && name !== DATA_CACHE) {
              return caches.delete(name);
            }
          })
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
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (
              networkResponse &&
              networkResponse.status === 200 &&
              (url.origin === self.location.origin ||
               url.hostname.includes('googleapis.com') ||
               url.hostname.includes('gstatic.com'))
            ) {
              const responseClone = networkResponse.clone();
              cache.put(request, responseClone);
            }
            return networkResponse;
          })
          .catch((err) => {
            // Offline/network failure: return cached asset if available, otherwise propagate error
            if (cachedResponse) {
              return cachedResponse;
            }
            throw err;
          });

        return cachedResponse || fetchPromise;
      });
    })
  );
});
