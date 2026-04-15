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
  './assets/icons/apple-touch-icon.png',
  './content/home.html',
  './content/push.html',
  './content/theory.html'

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
    fetch(event.request)
      .then((networkResponse) => {
        return caches.open(RUNTIME_CACHE).then((cache) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// self.addEventListener('push', (event) => {
//   let data = {};

//   try {
//     data = event.data.json();
//   } catch {
//     data = { title: 'Push', body: 'Нет данных' };
//   }

//   event.waitUntil(
//     self.registration.showNotification(data.title, {
//       body: data.body,
//       icon: '/assets/icons/favicon-192x192.png',
//       data: { url: data.url || '/' }
//     })
//   );
// });

// self.addEventListener('notificationclick', (event) => {
//   event.notification.close();

//   event.waitUntil(
//     clients.openWindow(event.notification.data.url)
//   );
// });

self.addEventListener('push', (event) => {
  // event.data — полезная нагрузка, которую сервер отправил через web-push.
  // Обычно это JSON строка → event.data.json()
  // Иногда event.data может быть пустым, поэтому защищаемся.
  const data = event.data ? event.data.json() : {};

  // То, что увидит пользователь в уведомлении
  const title = data.title || 'Напоминание';
  const body = data.body || 'У вас новое уведомление';

  // reminderId нужен для snooze — чтобы "отложить" именно конкретное напоминание
  const reminderId = data.reminderId || null;

  // actions: массив кнопок в уведомлении.
  // Сервер может передать data.actions = ['snooze_5m'].
  const actions = [];
  if (Array.isArray(data.actions) && data.actions.includes('snooze_5m')) {
    actions.push({ action: 'snooze_5m', title: 'Отложить на 5 минут' });
  }

  // options — настройки уведомления
  const options = {
  body,
  icon: '/assets/icons/favicon-128x128.png',
  badge: '/assets/icons/favicon-48x48.png',
  data: {
    url: data.url || '/',
    reminderId,
  },
  actions,
};

  // event.waitUntil(...) — говорит браузеру:
  // "не завершай обработку события, пока showNotification не выполнится".
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  // Закрываем уведомление сразу, чтобы оно не висело
  event.notification.close();

  const { url, reminderId } = event.notification.data || {};

  // 1) НОВОЕ (ПР17): нажали action "Отложить на 5 минут"
  if (event.action === 'snooze_5m' && reminderId) {
    // Service Worker может делать fetch на тот же origin.
    // Мы открыты на https://localhost:3443 → значит fetch('/api/...') пойдёт туда же.
    event.waitUntil(
      fetch('/api/reminders/snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reminderId, minutes: 5 }),
      }).catch(() => {
        // TODO (студентам): логировать или показывать пользователю ошибку (если нужно)
      })
    );
    return; // важно: не продолжаем открывать вкладку
  }

  // 2) База (ПР16): обычный клик по уведомлению → открыть/фокусировать вкладку
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Если вкладка уже открыта — фокусируем
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      // Иначе — открываем новую
      if (clients.openWindow) return clients.openWindow(url || '/');
    })
  );
});