(function () {
  'use strict';

  // Don't show install prompt if already running in standalone/installed mode
  if (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  ) {
    return;
  }

  let installPrompt = null;

  function getBtn() {
    return document.getElementById('pwa-install-btn');
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    const btn = getBtn();
    if (btn) btn.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    const btn = getBtn();
    if (btn) btn.hidden = true;
  });

  document.addEventListener('click', async (e) => {
    if (!installPrompt) return;
    if (!e.target.closest('#pwa-install-btn')) return;

    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      installPrompt = null;
      const btn = getBtn();
      if (btn) btn.hidden = true;
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js');
    });
  }
})();
