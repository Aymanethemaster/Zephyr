/**
 * Zephyr Weather App - Service Worker
 * Provides offline caching for application shell, static assets, and Meteocon vector SVGs.
 */

const CACHE_NAME = 'zephyr-v1.1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/js/utils.js',
  '/static/js/weather-api.js',
  '/static/js/weather-params.json',
  '/static/manifest.json',
  '/static/icons/overcast-day.svg',
  '/static/icons/clear-day.svg',
  '/static/icons/clear-night.svg',
  '/static/icons/compass.svg',
  '/static/icons/not-available.svg',
  '/static/icons/thermometer.svg',
  '/static/icons/horizon.svg',
  '/static/icons/uv-index.svg',
  '/static/icons/wind.svg',
  '/static/icons/humidity.svg',
  '/static/icons/barometer.svg',
  '/static/icons/sunrise.svg',
  '/static/icons/sunset.svg',
  '/static/icons/dust.svg',
  '/static/icons/raindrop.svg'
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('Service worker precache failed:', err))
  );
});

// Activate: clean up older cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: Cache-first for static assets, network-first for API requests
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Live weather & Geocoding APIs: Network-first, fallback to cache
  const isApiRequest = url.pathname.startsWith('/api/') ||
    url.hostname.includes('open-meteo.com') ||
    url.hostname.includes('komoot.io') ||
    url.hostname.includes('bigdatacloud.net') ||
    url.hostname.includes('geojs.io');

  if (isApiRequest) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // App Navigation: Network first, fallback to cached index
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match('/').then((res) => res || caches.match('/index.html')))
    );
    return;
  }

  // Static Assets (CSS, JS, SVG, Fonts): Cache-first, fallback to network and update cache
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200 && (url.origin === self.location.origin || url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com'))) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return networkResponse;
          });
      })
  );
});
