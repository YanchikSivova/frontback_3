const fs = require('fs');
const path = require('path');
const https = require('https');

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const { configureWebPush, sendNotification } = require('./push');

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

const subscriptions = new Set();

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

app.post('/api/push/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription) {
    return res.status(400).json({ error: 'subscription_required' });
  }
  subscriptions.add(JSON.stringify(subscription));
  res.json({ ok: true, count: subscriptions.size, pushReady });
});

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

const reminders = new Map();

const reminderTimers = new Map();

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

  socket.on('todo:event', (payload) => {
    
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