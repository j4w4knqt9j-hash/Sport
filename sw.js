// Cache de l'appli pour un démarrage rapide et un usage hors ligne.
// Les appels à l'API Strava ne sont jamais mis en cache.

const CACHE = 'trisuivi-v12';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/stats.js',
  'js/strava.js',
  'js/demo.js',
  'js/coach.js',
  'js/detail.js',
  'js/intervals.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Réseau d'abord (pour avoir la dernière version), cache en secours
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.endsWith('strava.com')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
