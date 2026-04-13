/**
 * Учебный TODO-менеджер для практик 13–14.
 *
 * Что уже реализовано в шаблоне:
 * 1. Добавление, удаление и переключение статуса задач.
 * 2. Хранение задач в localStorage.
 * 3. Вывод статистики по задачам.
 * 4. Регистрация Service Worker.
 * 5. Поддержка установки PWA в Chromium-браузерах.
 * 6. Отдельная подсказка по установке в Safari.
 * 7. Случайные мотивационные цитаты в футере.
 *
 * Что оставлено студентам:
 * - редактирование задачи;
 * - фильтрация списка;
 * - подтверждение удаления;
 * - улучшение кэширования в Service Worker;
 * - более продуманная обработка обновлений PWA.
 */

// =========================================================
// DOM-элементы интерфейса
// =========================================================

const taskForm = document.getElementById('taskForm');
const taskInput = document.getElementById('taskInput');
const taskList = document.getElementById('taskList');
const taskStats = document.getElementById('taskStats');
const clearCompletedBtn = document.getElementById('clearCompletedBtn');
const networkStatus = document.getElementById('networkStatus');
const installBtn = document.getElementById('installBtn');
const installHint = document.getElementById('installHint');
const quoteText = document.getElementById('quoteText');
const newQuoteBtn = document.getElementById('newQuoteBtn');
const updateBtn = document.getElementById('updateBtn');

// =========================================================
// Константы приложения
// =========================================================

/**
 * Ключ, под которым массив задач лежит в localStorage.
 * Если поменять ключ, приложение начнёт читать и сохранять данные
 * уже в другую запись хранилища.
 */
const STORAGE_KEY = 'practice_13_14_todos_v2';

/**
 * Массив цитат для нижнего блока.
 * Это небольшой пример клиентской динамики без обращения к серверу.
 */
const planningQuotes = [
  'Хороший план сегодня лучше идеального плана завтра.',
  'Планирование экономит время, которое иначе уходит на исправление хаоса.',
  'Большая цель достигается через маленькие запланированные шаги.',
  'Порядок в делах начинается с ясности следующего шага.',
  'Последовательность важнее разового вдохновения.',
  'План — это не ограничение, а инструмент управления неопределённостью.',
  'Когда задача записана, она перестаёт шуметь в голове.',
  'Хорошая система побеждает временный порыв.'
];

/**
 * В этой переменной будет временно храниться событие beforeinstallprompt.
 * Оно нужно для ручного показа системного диалога установки PWA.
 *
 * Значение будет равно:
 * - null, если установка сейчас недоступна;
 * - объекту события, если браузер разрешил показать install-prompt.
 */
let deferredInstallPrompt = null;

// =========================================================
// Работа с localStorage
// =========================================================

/**
 * Безопасно читает массив задач из localStorage.
 *
 * Почему здесь try/catch:
 * - строка в localStorage может оказаться повреждённой;
 * - JSON.parse выбросит ошибку при некорректном содержимом;
 * - интерфейс не должен полностью падать из-за одной ошибки хранения.
 */
function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Не удалось прочитать задачи из localStorage:', error);
    return [];
  }
}

/**
 * Сохраняет массив задач в localStorage.
 *
 * @param {Array} tasks - массив объектов задач.
 */
function saveTasks(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// =========================================================
// Вспомогательные функции
// =========================================================

/**
 * Генерирует простой уникальный идентификатор задачи.
 * Для учебного приложения этого достаточно.
 */
function generateId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Обновляет статус сети в интерфейсе.
 * navigator.onLine даёт базовую информацию, которой хватает для учебной демонстрации.
 */
async function isReallyOnline() {
  if (!navigator.onLine){
    // console.log("offline")
    return false;
  } 
  try {
    const response = await fetch('./manifest.json', {
      cache: 'no-store'
    });
    // console.log(response.ok);
    return response.ok;
  } catch {
    // console.log("offline");
    return false;
  }
}
async function updateNetworkStatus() {
  // const isOnline = navigator.onLine;
  const isOnline = await isReallyOnline();

  networkStatus.textContent = isOnline ? 'Онлайн' : 'Офлайн';
  networkStatus.classList.toggle('badge--success', isOnline);
  networkStatus.classList.toggle('badge--offline', !isOnline);
}
updateNetworkStatus();
setInterval(updateNetworkStatus, 5000);

/**
 * Возвращает случайную цитату и выводит её в футер.
 */
function showRandomQuote() {
  const randomIndex = Math.floor(Math.random() * planningQuotes.length);
  quoteText.textContent = planningQuotes[randomIndex];
}

function updateTaskText(taskId, newText) {
  const tasks = loadTasks();

  const updated = tasks.map(task => {
    if (task.id === taskId) {
      return { ...task, text: newText };
    }
    return task;
  });

  saveTasks(updated);
}

/**
 * Формирует DOM-элемент для одной задачи.
 * Здесь выбран вариант именно с созданием DOM-узлов,
 * чтобы код был нагляднее и безопаснее для разбора.
 */
function createTaskElement(task) {
  const li = document.createElement('li');
  li.className = 'task-item';
  li.dataset.id = task.id;

  const leftPart = document.createElement('div');
  leftPart.className = 'task-item__left';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.dataset.action = 'toggle';
  checkbox.setAttribute('aria-label', 'Отметить задачу выполненной');

  const text = document.createElement('span');
  text.className = 'task-item__text';
  text.textContent = task.text;

  if (task.completed) {
    text.classList.add('task-item__text--completed');
  }

  leftPart.appendChild(checkbox);
  leftPart.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'task-item__actions';

  /**
   * TODO для студентов:
   * Добавить рядом кнопку редактирования и реализовать изменение текста задачи.
   */

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'button button--primary button--small';
  editBtn.textContent = 'Редактировать';
  editBtn.dataset.action = 'edit';

  editBtn.addEventListener('click', () => {
    const currentText = text.textContent;

    // Создаем input для редактирования
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentText;
    input.className = 'task-item__edit-input';

    // Заменяем span на input
    const parent = text.parentNode;
    parent.replaceChild(input, text);
    input.focus();

    // Функция сохранения изменений
    const saveEdit = () => {
      const newText = input.value.trim();
      if (newText && newText !== currentText) {
        text.textContent = newText;
        // Здесь можно добавить вызов API для сохранения изменений
        if (typeof updateTaskText === 'function') {
          updateTaskText(task.id, newText);
        }
      } else if (!newText) {
        text.textContent = currentText; // Восстанавливаем старый текст, если пусто
      } else {
        text.textContent = currentText; // Восстанавливаем, если текст не изменился
      }

      // Возвращаем span обратно
      parent.replaceChild(text, input);

      // Убираем класс completed если он был (опционально)
      if (task.completed) {
        text.classList.add('task-item__text--completed');
      }
    };
    // Сохраняем при потере фокуса
    input.addEventListener('blur', saveEdit);

    // Сохраняем при нажатии Enter
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        saveEdit();
      }
    });

    // Отменяем при нажатии Escape
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        parent.replaceChild(text, input);
        input.remove();
      }
    });
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'button button--danger button--small';
  deleteBtn.textContent = 'Просто удали это!';
  deleteBtn.dataset.action = 'delete';

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  li.appendChild(leftPart);
  li.appendChild(actions);

  return li;
}

/**
 * Перерисовывает блок статистики.
 */
function updateStats(tasks) {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.completed).length;
  const active = total - completed;

  taskStats.textContent = `Всего: ${total} | Активных: ${active} | Выполненных: ${completed}`;
}

/**
 * Полная перерисовка списка задач.
 * Для учебного проекта это допустимый и понятный подход.
 */
let currentFilter = 'all';
function renderTasks() {
  let tasks = loadTasks();

  if (currentFilter === 'active') {
    tasks = tasks.filter(task => !task.completed);
  }

  if (currentFilter === 'completed') {
    tasks = tasks.filter(task => task.completed);
  }

  taskList.innerHTML = '';

  if (tasks.length === 0) {
    const emptyState = document.createElement('li');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'Нет задач для отображения.';
    taskList.appendChild(emptyState);
    updateStats(loadTasks()); // важно!
    return;
  }

  tasks.forEach(task => {
    taskList.appendChild(createTaskElement(task));
  });

  updateStats(loadTasks());
}

document.querySelector('.filters').addEventListener('click', (e) => {
  if (!e.target.dataset.filter) return;

  currentFilter = e.target.dataset.filter;
  renderTasks();
});


// =========================================================
// Бизнес-логика TODO-списка
// =========================================================

/**
 * Добавляет новую задачу.
 *
 * @param {string} text - текст задачи.
 */
function addTask(text) {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return;
  }

  const tasks = loadTasks();

  const newTask = {
    id: generateId(),
    text: normalizedText,
    completed: false,
    createdAt: new Date().toISOString()
  };

  tasks.unshift(newTask);
  saveTasks(tasks);
  renderTasks();
}

/**
 * Переключает статус задачи по id.
 */
function toggleTask(taskId) {
  const updated = loadTasks().map((task) => {
    if (task.id === taskId) {
      return {
        ...task,
        completed: !task.completed
      };
    }

    return task;
  });

  saveTasks(updated);
  renderTasks();
}

/**
 * Удаляет задачу по id.
 * Подтверждение специально не добавлено: это TODO для студентов.
 */
function deleteTask(taskId) {
  if (!confirm('Удалить задачу?')) return;

  const updated = loadTasks().filter(task => task.id !== taskId);
  saveTasks(updated);
  renderTasks();
}

/**
 * Удаляет все выполненные задачи.
 */
function clearCompletedTasks() {
  if (!confirm('Удалить ВСЕ выполненные задачи?')) return;

  const updated = loadTasks().filter(task => !task.completed);
  saveTasks(updated);
  renderTasks();
}
// =========================================================
// Установка PWA
// =========================================================

/**
 * Определяет, запущено ли приложение уже в standalone-режиме.
 * Это полезно, чтобы не показывать кнопку установки там,
 * где приложение уже установлено и открыто как отдельное окно.
 */
function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

/**
 * Обновляет текст подсказки по установке.
 * В Chromium мы можем показать собственную кнопку установки,
 * а в Safari остаётся сценарий через меню браузера.
 */
function updateInstallHint() {
  if (isStandaloneMode()) {
    installHint.textContent = 'Приложение уже запущено в standalone-режиме.';
    if (installBtn) {
      installBtn.hidden = true;
    }
    return;
  }

  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  if (isSafari) {
    installHint.textContent = 'Safari: для установки используйте File → Add to Dock.';
  } else {
    installHint.textContent = 'Chrome / Edge: установите приложение через кнопку браузера или кнопку «Установить PWA». ';
  }
}

/**
 * Событие beforeinstallprompt поддерживается в Chromium.
 * Здесь мы перехватываем стандартный prompt, сохраняем событие
 * и показываем свою кнопку установки в интерфейсе.
 */
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  alert('Приложение можно установить!');
  if (installBtn && !isStandaloneMode()) {
    installBtn.hidden = false;
  }
});

/**
 * Нажатие на кнопку установки.
 */
if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      return;
    }

    deferredInstallPrompt.prompt();
    const choiceResult = await deferredInstallPrompt.userChoice;
    console.log('Результат установки PWA:', choiceResult.outcome);

    deferredInstallPrompt = null;
    installBtn.hidden = true;
  });
}

/**
 * Если приложение установлено, скрываем кнопку.
 */
window.addEventListener('appinstalled', () => {
  console.log('PWA успешно установлено.');
  deferredInstallPrompt = null;

  if (installBtn) {
    installBtn.hidden = true;
  }

  updateInstallHint();
});

// =========================================================
// Регистрация Service Worker
// =========================================================

/**
 * Регистрируем Service Worker только там, где технология поддерживается.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service Worker не поддерживается в данном браузере.');
    return;
  }

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      console.log('Service Worker зарегистрирован:', registration.scope);
      /**
       * TODO для студентов:
       * 1. Добавить интерфейсное уведомление о том, что офлайн-режим готов.
       * 2. Обработать сценарий появления новой версии Service Worker.
       * 3. Показать пользователю кнопку "Обновить приложение".
      */
      // alert('Офлайн-режим готов! Приложение может работать без интернета.');
      registration.onupdatefound = () => {
        const newWorker = registration.installing;

        newWorker.onstatechange = () => {
          if (newWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              showUpdateButton();
            }
            if (!navigator.serviceWorker.controller) {
              // первый запуск
              alert('Офлайн-режим готов!');
            }
          }
        };
      };
    } catch (error) {
      console.error('Ошибка регистрации Service Worker:', error);
    }
  });
}

function showUpdateButton() {
  if (updateBtn) {
    updateBtn.hidden = false;
  }
}
if (updateBtn) {
  updateBtn.addEventListener('click', () => {
    window.location.reload();
  });
}
// =========================================================
// Обработчики событий
// =========================================================

/**
 * Отправка формы добавления задачи.
 */
taskForm.addEventListener('submit', (event) => {
  event.preventDefault();
  addTask(taskInput.value);
  taskForm.reset();
  taskInput.focus();
});

/**
 * Делегирование кликов по списку задач.
 * Это удобнее, чем навешивать обработчики на каждую кнопку отдельно.
 */
taskList.addEventListener('click', (event) => {
  const target = event.target;
  const taskItem = target.closest('.task-item');

  if (!taskItem) {
    return;
  }

  const taskId = taskItem.dataset.id;
  const action = target.dataset.action;

  if (action === 'delete') {
    deleteTask(taskId);
  }
});

/**
 * Отдельно обрабатываем изменение чекбокса.
 */
taskList.addEventListener('change', (event) => {
  const target = event.target;

  if (target.dataset.action !== 'toggle') {
    return;
  }

  const taskItem = target.closest('.task-item');
  if (!taskItem) {
    return;
  }

  toggleTask(taskItem.dataset.id);
});

clearCompletedBtn.addEventListener('click', clearCompletedTasks);
newQuoteBtn.addEventListener('click', showRandomQuote);
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

// =========================================================
// Инициализация
// =========================================================

function init() {
  updateNetworkStatus();
  updateInstallHint();
  showRandomQuote();
  renderTasks();
  registerServiceWorker();
}

init();

const contentViewEl = document.getElementById('contentView');

async function loadPage(page) {
  // page: 'home' | 'theory' | 'push'
  const url = `/content/${page}.html`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    contentViewEl.innerHTML = html;
  } catch (e) {
    // Если сеть недоступна, fetch может упасть.
    // В ПР15 вы должны сделать так, чтобы Service Worker отдавал закешированный контент.
    contentViewEl.innerHTML = `
      <section class="card" style="padding:16px; border:1px solid #e5e7eb; border-radius:14px; background:#fff;">
        <h2 style="margin:0 0 8px;">Нет доступа к контенту</h2>
        <p style="margin:0; color:#374151;">Не удалось загрузить <code>${url}</code>. Проверьте сеть/HTTPS и кеширование в Service Worker.</p>
      </section>
    `;
  }
}
// Кнопки навигации (App Shell)
document.querySelectorAll('button[data-page]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const page = btn.getAttribute('data-page');
    loadPage(page);
  });
});

// По умолчанию показываем стартовую страницу
loadPage('home');

// =========================
// Практика 16: WebSocket + Push (заготовки)
// =========================

/**
 * TODO (Практика 16): WebSocket
 *
 * Сервер уже принимает Socket.IO соединения (server/src/server.js).
 * В учебной заготовке мы НЕ подключаем socket.io-client автоматически,
 * чтобы студенты сделали это сами.
 *
 * Вариант:
 * 1) Подключить socket.io-client (через npm или через CDN)
 * 2) При добавлении/изменении/удалении задач отправлять событие:
 *    socket.emit('todo:event', {...})
 * 3) На socket.on('todo:event', ...) обновлять UI.
 */

/**
 * TODO (Практика 16): Push API
 *
 * 1) Запросить разрешение Notification.requestPermission()
 * 2) Получить registration Service Worker
 * 3) registration.pushManager.subscribe(...)
 * 4) Отправить subscription на сервер: POST /api/push/subscribe
 * 5) Протестировать отправку: POST /api/push/test
 *
 * При получении push события логика в sw.js (см. push event).
 */