import {createState, localDateKey, ensureDay, setPlan, increment, undo, getView, parseStoredState, serializeState} from './logic.mjs';

const STORAGE_KEY = 'dhikr.olive.mini.v1';
const DHIKRS = {
  astaghfirullah: {arabic:'أَسْتَغْفِرُ اللَّهَ',name:'Астагфируллах',meaning:'Прошу прощения у Аллаха'},
  subhanallah: {arabic:'سُبْحَانَ اللَّهِ',name:'Субханаллах',meaning:'Пречист Аллах'},
  alhamdulillah: {arabic:'الْحَمْدُ لِلَّهِ',name:'Альхамдулиллях',meaning:'Хвала Аллаху'},
  allahuakbar: {arabic:'اللَّهُ أَكْبَرُ',name:'Аллаху акбар',meaning:'Аллах велик'}
};
const $ = id => document.getElementById(id);
let state = createState();
let lastDate = localDateKey(new Date());
let storageAvailable = true;
let toastTimer;
let lastView;
let initialMessage = '';
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const restored = parseStoredState(raw);
    if (restored) state = restored;
    else {
      initialMessage = 'Сохранённые данные не удалось прочитать. Настройте план заново.';
      try { localStorage.setItem(STORAGE_KEY + '.recovery', raw); } catch {}
    }
  }
} catch {
  storageAvailable = false;
  initialMessage = 'Браузер не разрешил сохранение. Прогресс останется только до закрытия страницы.';
}

function notify(message, timeout = 3100) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.add('show');
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), timeout);
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeState(state));
    storageAvailable = true;
  } catch {
    if (storageAvailable) notify('Не удалось сохранить прогресс на устройстве.', 5500);
    storageAvailable = false;
  }
}
function readLatest() {
  if (!storageAvailable) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const restored = parseStoredState(raw);
      if (restored) state = restored;
    }
  } catch {}
}
function currentDay() {
  const day = localDateKey(new Date());
  if (day !== lastDate) {
    lastDate = day;
    if (state.plan) { ensureDay(state, day); persist(); }
  }
  return day;
}
function render() {
  const day = currentDay();
  const view = getView(state, day);
  const dhikr = DHIKRS[view.dhikrId || 'astaghfirullah'];
  $('arabic').textContent = dhikr.arabic;
  $('dhikrName').textContent = dhikr.name;
  $('meaning').textContent = dhikr.meaning;
  $('count').textContent = String(view.count);
  $('goal').textContent = view.goal ? String(view.goal) : '—';
  document.querySelector('.count-line').classList.toggle('long', String(view.count).length > 4 || String(view.goal || '').length > 4);
  $('progressFill').style.width = (view.visualProgress * 100) + '%';
  $('progress').setAttribute('aria-valuenow', String(Math.round(view.visualProgress * 100)));
  $('progress').setAttribute('aria-valuetext', view.goal ? view.count + ' из ' + view.goal : 'Цель не установлена');
  $('lushScene').style.opacity = String(view.gardenProgress);
  $('undoButton').disabled = !state.plan || view.count === 0;
  $('countButton').setAttribute('aria-label', state.plan ? 'Добавить один зикр. Сегодня ' + view.count : 'Выбрать дневную цель');
  let caption = 'Установите свою цель';
  let status = '';
  if (state.plan) {
    if (view.completed) {
      caption = 'Цель выполнена';
      status = 'Сегодня ваша олива расцвела';
    } else {
      caption = 'Осталось ' + (view.goal - view.count);
      if (view.yesterdayCompleted) status = 'Сад цветёт благодаря вчерашнему дню';
    }
  }
  $('progressCaption').textContent = caption;
  $('gardenStatus').textContent = status;
  $('gardenStatus').classList.toggle('visible', Boolean(status));
  $('tapHint').textContent = state.plan ? 'Нажимайте на круг — один раз за каждый зикр' : 'Задайте свой план и оживите оливу';
  lastView = view;
}
function openPlan() {
  $('dhikrSelect').value = state.plan?.dhikrId || 'astaghfirullah';
  $('goalInput').value = state.plan ? String(state.plan.goal) : '';
  $('savePlan').textContent = state.plan ? 'Сохранить' : 'Начать';
  $('planHelp').textContent = state.plan ? 'При изменении цели прогресс за сегодня пересчитается. Выполненные зикры сохранятся.' : 'Количество выбираете вы.';
  $('planError').textContent = '';
  if (!$('planDialog').open) $('planDialog').showModal();
}
function drop() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || $('drops').childElementCount >= 10) return;
  const node = document.createElement('span');
  node.className = 'falling-drop';
  node.style.left = (77 + Math.random() * 3) + '%';
  $('drops').append(node);
  node.addEventListener('animationend', () => node.remove(), {once:true});
  setTimeout(() => node.remove(), 1200);
}
$('countButton').addEventListener('click', () => {
  readLatest();
  if (!state.plan) { openPlan(); return; }
  const day = currentDay();
  const wasComplete = getView(state, day).completed;
  try { increment(state, day); } catch { notify('Не удалось добавить зикр. Проверьте дневную цель.'); return; }
  persist();
  render();
  drop();
  $('countButton').classList.remove('pulse');
  requestAnimationFrame(() => $('countButton').classList.add('pulse'));
  if (!wasComplete && lastView.completed) notify('Дневная цель выполнена. Ваша олива расцвела.');
});
$('undoButton').addEventListener('click', () => {
  readLatest();
  if (!state.plan) return;
  undo(state, currentDay());
  persist();
  render();
});
$('editPlan').addEventListener('click', openPlan);
$('closePlan').addEventListener('click', () => $('planDialog').close());
$('planDialog').addEventListener('click', event => {
  if (event.target !== $('planDialog')) return;
  const rect = $('planDialog').getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('planDialog').close();
});
$('planForm').addEventListener('submit', event => {
  event.preventDefault();
  const value = $('goalInput').value.trim();
  const goal = Number(value);
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(goal) || goal < 1) {
    $('planError').textContent = 'Введите целое количество от 1.';
    $('goalInput').setAttribute('aria-invalid', 'true');
    $('goalInput').focus();
    return;
  }
  $('goalInput').removeAttribute('aria-invalid');
  readLatest();
  setPlan(state, {dhikrId:$('dhikrSelect').value, goal}, currentDay());
  ensureDay(state, lastDate);
  persist();
  render();
  $('planDialog').close();
  $('countButton').focus({preventScroll:true});
});
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  const restored = parseStoredState(event.newValue);
  if (restored) { state = restored; render(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { readLatest(); render(); }
});
window.addEventListener('pageshow', () => { readLatest(); render(); });
setInterval(() => {
  if (document.visibilityState === 'visible' && localDateKey(new Date()) !== lastDate) render();
}, 15000);
if (state.plan) { ensureDay(state, lastDate); persist(); }
render();
if (!state.plan) openPlan();
if (initialMessage) setTimeout(() => notify(initialMessage, 7000), 300);
