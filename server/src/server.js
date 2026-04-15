const fs = require('fs');
const path = require('path');
const https = require('https');

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { Server } = require('socket.io');
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

app.get('/api/vapidPublicKey', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
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