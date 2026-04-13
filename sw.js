/**
 * Service Worker для учебного PWA-проекта.
 *
 * В текущей версии реализована базовая стратегия Cache First:
 * 1. На install кэшируются основные статические ресурсы.
 * 2. На activate удаляются старые версии кэша.
 * 3. На fetch сначала ищем ответ в кэше, затем в сети.
 *
 * Такой вариант подходит для учебного шаблона.
 * Более продвинутые стратегии специально оставлены студентам как TODO.
 */

const CACHE_NAME = 'practice-13-14-cache-v3';
const RUNTIME_CACHE = 'runtime-cache-v4';

/**
 * Набор ресурсов, которые кладём в кэш сразу при установке Service Worker.
 * Пути должны совпадать с фактической структурой проекта.
 */
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './assets/hero.png',
  './assets/icons/favicon.ico',
  './assets/icons/favicon-16x16.png',
  './assets/icons/favicon-32x32.png',
  './assets/icons/favicon-48x48.png',
  './assets/icons/favicon-64x64.png',
  './assets/icons/favicon-128x128.png',
  './assets/icons/favicon-256x256.png',
  './assets/icons/favicon-512x512.png',
  './assets/icons/apple-touch-icon-57x57.png',
  './assets/icons/apple-touch-icon-114x114.png',
  './assets/icons/apple-touch-icon-120x120.png',
  './assets/icons/apple-touch-icon.png'
];

/**
 * install:
 * предварительное кэширование основных ресурсов.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );

  self.skipWaiting();
});

/**
 * activate:
 * удаляем устаревшие версии кэша.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheKeys) => {
      return Promise.all(
        cacheKeys
          .filter((key) => key !== CACHE_NAME)
          .map((oldKey) => caches.delete(oldKey))
      );
    })
  );

  self.clients.claim();
});

/**
 * fetch:
 * базовая стратегия Cache First.
 *
 * Логика:
 * 1. Если ресурс есть в кэше — сразу возвращаем его.
 * 2. Если ресурса в кэше нет — пробуем получить из сети.
 * 3. Если сеть недоступна и кэша нет — возвращаем простой текстовый fallback-ответ.
 */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then((networkResponse) => {
        return caches.open(RUNTIME_CACHE).then(cache => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      });
    }).catch(() => {
      return caches.match('./offline.html');
    })
  );
});