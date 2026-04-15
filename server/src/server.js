const fs = require('fs');
const path = require('path');
const https = require('https');

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const { configureWebPush, sendNotification } = require('./push');

/**
 * Практика 15–16: HTTPS сервер
 *
 * Зачем HTTPS в PWA:
 * - Service Worker требует secure context (https) для большинства фич.
 * - Push API также требует secure context.
 *
 * Этот сервер:
 * 1) отдаёт статические файлы фронтенда (PWA)
 * 2) поднимает Socket.IO (WebSocket) канал
 * 3) даёт endpoints для Push подписки и отправки уведомлений
 */

const app = express();
const PORT = Number(process.env.PORT || 3443);

app.use(cors());
app.use(express.json());

// --- Статика (фронтенд PWA) ---
const FRONTEND_DIR = path.join(__dirname, '..', '..');
// '..', '..' - поднимаемся на два уровня вверх
app.use(express.static(FRONTEND_DIR));
// Если приходит запрос за файлом — ищи этот файл в FRONTEND_DIR и отдай его как есть
// Сервер показывает ваш index.html, потому что express.static(FRONTEND_DIR) раздаёт корень проекта как “папку сайта”, а вы открываете этот сайт по https://localhost:3443.

//API-шка 

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// --- Push: учебное хранилище подписок (в памяти процесса) ---
// TODO (студентам): заменить на БД/Redis, если усложняем проект.
const subscriptions = new Set();
// В учебном примере храним подписки в памяти процесса 
// Подписка (PushSubscription) — это “адрес”, куда можно отправлять push именно этому браузеру на этом устройстве.

// Настройка web-push (если ключи есть)
// Подпись сервера, чтобы push-сервис (Chrome/Firefox push service) доверял запросам сервера.


let pushReady = false;
try {
  configureWebPush({
    subject: process.env.VAPID_SUBJECT,
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
  });
  pushReady = true;
} catch (e) {
  console.warn('[PUSH] Not configured:', e.message);
}

// Если ключей нет → pushReady=false → /api/push/test вернёт ошибку push_not_configured.



/**
 * Практика 16: сохранить push‑подписку
 * Клиент отправляет объект subscription (PushSubscription.toJSON())
 */

// Как подписка попадает на сервер (endpoint /api/push/subscribe)
// 1.	Клиент делает POST /api/push/subscribe и отправляет JSON подписки.
// 2.	Сервер кладёт подписку в Set.
// 3.	Сервер отвечает “ок, я запомнил”.

app.post('/api/push/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription) {
    return res.status(400).json({ error: 'subscription_required' });
  }
  subscriptions.add(JSON.stringify(subscription));
  res.json({ ok: true, count: subscriptions.size, pushReady });
});

/**
 * Практика 16: отправить тестовый push всем подписчикам
 *
 * TODO (студентам):
 * - сделать payload содержательным (title/body/url)
 * - обработать отвалившиеся подписки (410/404)
 */

// Тест Push 
// Как сервер отправляет push (endpoint /api/push/test)
// 1.	Вы жмёте кнопку / делаете запрос POST /api/push/test.
// 2.	Сервер берёт все сохранённые подписки. 
// 3.	Для каждой подписки вызывает sendNotification(...) — это реальная отправка пуша через библиотеку web-push.
// 4.	Браузер получает push (даже если вкладка закрыта, но браузер запущен).


app.post('/api/push/test', async (req, res) => {
  if (!pushReady) {
    return res.status(400).json({ error: 'push_not_configured', message: 'Set VAPID keys in server/.env' });
  }

  const payload = JSON.stringify({
    title: 'PWA уведомление',
    body: 'Тестовое уведомление (Практика 16)',
    url: '/',
    ts: Date.now(),
  });

  let sent = 0;
  // for (const raw of Array.from(subscriptions)) {
  //   const subscription = JSON.parse(raw);
  //   try {
  //     await sendNotification(subscription, payload);
  //     sent++;
  //   } catch (e) {
  //     const code = e.statusCode;

  //     console.warn('[PUSH] send failed:', code || '', e.body || e.message);

  //     // ❗ ВАЖНО: удалить отвалившиеся подписки
  //     if (code === 410 || code === 404) {
  //       subscriptions.delete(raw);
  //       console.log('[PUSH] cleaned subscription, left:', subscriptions.size);
  //     }
  //   }
  // }



  for (const raw of Array.from(subscriptions)) {
    const subscription = JSON.parse(raw);

    try {
      await sendNotification(subscription, payload);
      sent++;
    } catch (e) {
      const code = e.statusCode;

      console.warn('[PUSH] send failed:', code || '', e.body || e.message);

      if (code === 410 || code === 404) {
        console.log('[PUSH] removing expired subscription');

        // ✔ УДАЛЕНИЕ ЧЕРЕЗ СРАВНЕНИЕ JSON (безопасно для Set)
        subscriptions.forEach((item) => {
          const parsed = JSON.parse(item);
          if (parsed.endpoint === subscription.endpoint) {
            subscriptions.delete(item);
          }
        });
      }
    }
  }
  res.json({ ok: true, sent, total: subscriptions.size });
});

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// app.get('/api/vapidPublicKey', (req, res) => {
//   res.json({ key: process.env.VAPID_PUBLIC_KEY });
// });


// ============================
// ПР17: ОТЛОЖЕННЫЕ PUSH УВЕДОМЛЕНИЯ
// ============================
//
// В ПР15–16 у нас была база для push:
// - подписка клиента (subscription)
// - хранение подписок на сервере (subscriptions)
// - функция sendNotification(subscription, payload)
//
// В ПР17 добавляем НОВОЕ:
// - планирование уведомления “через N секунд”
// - endpoint /api/reminders/schedule
// - endpoint /api/reminders/snooze (отложить на 5 минут по клику в уведомлении)
//
// Важно: здесь учебная реализация “в памяти”.
// После перезапуска сервера всё исчезнет (и подписки, и запланированные напоминания).

// reminders = "хранилище напоминаний" (как мини-БД в памяти процесса).
// Ключ: reminder.id, Значение: объект reminder.
const reminders = new Map();

// reminderTimers = хранилище активных таймеров setTimeout(...) по reminder.id.
// Зачем отдельно?
// - чтобы уметь перепланировать (snooze) и отменять/перезаписывать старый таймер.
const reminderTimers = new Map();
/**
 * scheduleReminderTimer(reminder)
 *
 * Делает ровно одну вещь:
 * - ставит setTimeout, который через delayMs отправит PUSH всем подписчикам.
 *
 * Почему это отдельной функцией:
 * - потому что она используется и в /schedule (первичное планирование),
 *   и в /snooze (перепланирование).
 */
function scheduleReminderTimer(reminder) {
  // 0) Если для этого reminder.id уже был таймер — удаляем его,
  // иначе получим ДВА уведомления: старое и новое.
  const prev = reminderTimers.get(reminder.id);
  if (prev) clearTimeout(prev);

  // 1) Считаем задержку до момента отправки
  // reminder.fireAt — это "время в миллисекундах" (timestamp), когда надо отправить
  const delayMs = Math.max(0, reminder.fireAt - Date.now());

  // 2) Ставим таймер. Когда он сработает — отправим push.
  const t = setTimeout(async () => {
    // 2.1) Если push не настроен (нет VAPID ключей) — НЕ падаем, просто логируем.
    if (!pushReady) {
      console.warn('[REMINDER] push not configured, skip send');
      return;
    }
    // 2.2) Формируем payload — то, что уйдёт в Service Worker через event.data.json()
    // Важно: это НЕ "чистый текст", а JSON строка.
    const payload = JSON.stringify({
      title: reminder.title,
      body: reminder.body,
      url: '/',            // куда вести пользователя по клику
      reminderId: reminder.id, // важно для "snooze" (отложить именно это уведомление)

      // actions — подсказка Service Worker'у: какие кнопки показать в уведомлении
      // В ПР17 добавляем action "snooze_5m" (Отложить на 5 минут)
      actions: ['snooze_5m'],

      ts: Date.now(),
    });
    // 2.3) Отправляем уведомление ВСЕМ подписчикам
    // subscriptions — Set с JSON строками подписок (из ПР15–16)
    let sent = 0;
    for (const raw of Array.from(subscriptions)) {
      const subscription = JSON.parse(raw);
      try {
        await sendNotification(subscription, payload);
        sent++;
      } catch (e) {
        // Здесь часто бывает "subscription умерла" (410/404).
        // В учебной версии мы просто логируем.
        // TODO (студентам): при 410 удалять подписку из subscriptions.
        if (e.statusCode === 410 || e.statusCode === 404) {
          subscriptions.forEach((item) => {
            const parsed = JSON.parse(item);
            if (parsed.endpoint === subscription.endpoint) {
              subscriptions.delete(item);
            }
          });
        }
      }
    }

    console.log(`[REMINDER] sent=${sent} id=${reminder.id}`);
  }, delayMs);

  // 3) Сохраняем таймер по id (чтобы можно было отменять/перепланировать)
  reminderTimers.set(reminder.id, t);
}
/**
 * POST /api/reminders/schedule
 *
 * ПР17: планирование отложенного уведомления.
 *
 * Вход:
 * {
 *   "title": "Сдать практику",
 *   "body": "ПР17: через 30 сек",
 *   "delaySeconds": 30
 * }
 *
 * Выход:
 * - { ok: true, reminder: {...} }
 * - reminder.fireAt — конкретное время в будущем (timestamp)
 */
app.post('/api/reminders/schedule', (req, res) => {
  const { title, body, delaySeconds } = req.body || {};

  // 1) Минимальная валидация входа
  // delaySeconds должен быть number, иначе расчёт fireAt невозможен.
  if (!title || typeof delaySeconds !== 'number') {
    return res.status(400).json({
      error: 'validation_error',
      message: 'Нужны поля: title (string), delaySeconds (number). body (string) — опционально.',
    });
  }
  // 2) Создаём напоминание
  const id = nanoid(10);
  const now = Date.now();

  // fireAt — момент времени, когда отправить уведомление
  const fireAt = now + Math.max(0, delaySeconds) * 1000;

  const reminder = {
    id,
    title: String(title),
    body: body ? String(body) : 'Напоминание (ПР17)',
    createdAt: now,
    fireAt,
  };

  // 3) Сохраняем в "мини-БД" (Map)
  reminders.set(id, reminder);

  // 4) Ставим таймер (самое главное в ПР17)
  scheduleReminderTimer(reminder);

  // 5) Отдаём клиенту результат
  res.json({ ok: true, reminder });
});
/**
 * POST /api/reminders/snooze
 *
 * ПР17: перепланирование ("Отложить на 5 минут").
 *
 * Этот endpoint вызывается НЕ из app.js, а из Service Worker,
 * когда пользователь нажал кнопку в уведомлении.
 *
 * Вход:
 * {
 *   "reminderId": "abc123",
 *   "minutes": 5
 * }
 */
app.post('/api/reminders/snooze', (req, res) => {
  const { reminderId, minutes } = req.body || {};

  if (!reminderId) {
    return res.status(400).json({ error: 'validation_error', message: 'Нужно поле reminderId' });
  }

  const reminder = reminders.get(reminderId);
  if (!reminder) {
    return res.status(404).json({ error: 'not_found', message: 'Напоминание не найдено' });
  }

  // По умолчанию 5 минут (если minutes не передали)
  const m = typeof minutes === 'number' ? minutes : 5;
  // 1) Меняем время отправки (fireAt) на “сейчас + m минут”
  reminder.fireAt = Date.now() + Math.max(0, m) * 60 * 1000;

  // 2) Обновляем запись в Map (формально можно не делать, объект и так изменён,
  // но так понятнее студентам: "мы записали обновлённый reminder")
  reminders.set(reminder.id, reminder);

  // 3) Перепланируем таймер: старый будет очищен, новый поставлен
  scheduleReminderTimer(reminder);

  res.json({ ok: true, reminder });
});

/**
 * TODO (студентам): добавить эндпоинт списка напоминаний
 * GET /api/reminders
 */

app.get('/api/reminders', (req, res) => {
  res.json({
    ok: true,
    reminders: Array.from(reminders.values()),
  });
});

// --- HTTPS server ---
const CERT_DIR = path.join(__dirname, '..', 'certs');
const keyPath = path.join(CERT_DIR, 'localhost-key.pem');
const certPath = path.join(CERT_DIR, 'localhost-cert.pem');

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('HTTPS certs not found. Create server/certs/localhost-key.pem and server/certs/localhost-cert.pem');
  console.error('See server/README.md');
  process.exit(1);
}

const httpsServer = https.createServer(
  {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  },
  app
);

// --- Socket.IO (Практика 16) ---
const io = new Server(httpsServer, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  console.log('[WS] connected:', socket.id);

  // TODO (студентам): придумать события для TODO‑листа
  // Например: 'todo:created', 'todo:toggled', 'todo:deleted'

  socket.on('todo:event', (payload) => {
    // payload — что угодно (например объект задачи)
    // Рассылаем всем остальным вкладкам/клиентам
    socket.broadcast.emit('todo:event', payload);
  });

  socket.on('disconnect', () => {
    console.log('[WS] disconnected:', socket.id);
  });
});

httpsServer.listen(PORT, () => {
  console.log(`HTTPS server: https://localhost:${PORT}`);
  console.log(`Health: https://localhost:${PORT}/api/health`);
});