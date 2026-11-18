const status = document.getElementById('offlineStatus');
const installButton = document.getElementById('installButton');
const displayMode = window.matchMedia('(display-mode: standalone)');
let registration;
let installPrompt;
let preparationFailed = false;

function installed() {
  return displayMode.matches || window.navigator.standalone === true;
}

function renderInstallButton() {
  if (installButton) installButton.hidden = installed() || !installPrompt;
}

function renderStatus() {
  if (!status) return;
  if (registration?.waiting) {
    status.textContent = 'Есть обновление. Закройте все окна Dhikr и откройте снова.';
  } else if (registration?.active?.state === 'activated') {
    status.textContent = navigator.onLine
      ? 'Готово к работе без интернета.'
      : 'Без интернета. Зикр и сохранение работают.';
  } else if (preparationFailed) {
    status.textContent = 'Офлайн-режим пока не готов. Откройте страницу с интернетом ещё раз.';
  } else {
    status.textContent = 'Подготавливаем работу без интернета…';
  }
}

window.addEventListener('beforeinstallprompt', event => {
  if (!installButton || installed()) return;
  event.preventDefault();
  installPrompt = event;
  renderInstallButton();
});

installButton?.addEventListener('click', async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = undefined;
  renderInstallButton();
  try {
    await prompt.prompt();
    await prompt.userChoice;
  } catch {
    // Installation is optional. The counter remains usable in the browser.
  }
});

window.addEventListener('appinstalled', () => {
  installPrompt = undefined;
  renderInstallButton();
});
displayMode.addEventListener?.('change', renderInstallButton);
renderInstallButton();

function watchWorker(worker) {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    if (worker.state === 'redundant' && !registration?.active) preparationFailed = true;
    // Registration.waiting/active is updated alongside the state transition.
    setTimeout(renderStatus, 0);
  });
}

async function prepareOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    if (status) status.textContent = 'Офлайн-режим требует современного браузера и защищённого адреса HTTPS.';
    return;
  }
  try {
    registration = await navigator.serviceWorker.register(new URL('./sw.js', import.meta.url).href, {
      scope:new URL('./', import.meta.url).href,
      updateViaCache:'none'
    });
    watchWorker(registration.installing);
    watchWorker(registration.active);
    registration.addEventListener('updatefound', () => {
      preparationFailed = false;
      watchWorker(registration.installing);
      renderStatus();
    });
    navigator.serviceWorker.addEventListener('controllerchange', renderStatus);
    renderStatus();
  } catch {
    preparationFailed = true;
    renderStatus();
  }
}

window.addEventListener('online', () => {
  renderStatus();
  registration?.update().catch(() => {});
});
window.addEventListener('offline', renderStatus);

if (document.readyState === 'complete') prepareOffline();
else window.addEventListener('load', prepareOffline, {once:true});
