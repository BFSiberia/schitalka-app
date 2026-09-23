/* Кэширует оболочку приложения, чтобы оно работало офлайн. */
var CACHE = 'schitalka-57acebce0dbb';   /* в dist/ заменяется на хэш содержимого */
/* Список пересобирается scripts/build.py: в dist/ сюда попадают каталог и все картинки. */
var ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './catalog.enc',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
  './img/0006.png',
  './img/001K.png',
  './img/0020.png',
  './img/0022.png',
  './img/002K.png',
  './img/0036.png',
  './img/0043.png',
  './img/0050.png',
  './img/005K.png',
  './img/0102.png',
  './img/0111.png',
  './img/012K.png',
  './img/0143.png',
  './img/020N.png',
  './img/0242.png',
  './img/0260.png',
  './img/0265.png',
  './img/0266.png',
  './img/0757.png',
  './img/076K.png',
  './img/0930.png',
  './img/100M.png',
  './img/101M.png',
  './img/102K.png',
  './img/110K.png',
  './img/1189.png',
  './img/141K.png',
  './img/142K.png',
  './img/1437.png',
  './img/1466.png',
  './img/149K.png',
  './img/150K.png',
  './img/1636.png',
  './img/173K.png',
  './img/1745.png',
  './img/178K.png',
  './img/179K.png',
  './img/180A.png',
  './img/180K.png',
  './img/182K.png',
  './img/1B42.png',
  './img/2038.png',
  './img/2273.png',
  './img/236K.png',
  './img/2793.png',
  './img/282K.png',
  './img/2864.png',
  './img/2865.png',
  './img/297A.png',
  './img/2B08.png',
  './img/302A.png',
  './img/3123.png',
  './img/3151.png',
  './img/326K.png',
  './img/335K.png',
  './img/371A.png',
  './img/395K.png',
  './img/4467.png',
  './img/4468.png',
  './img/4472.png',
  './img/4473.png',
  './img/500K.png',
  './img/528K.png',
  './img/530K.png',
  './img/719A.png',
  './img/8697.png',
  './img/8711.png',
  './img/noimg.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request).then(function (resp) {
        var copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return resp;
      }).catch(function () { return cached; });
    })
  );
});
