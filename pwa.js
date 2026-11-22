(() => {
  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
  }

  let installPrompt;
  const installButton = document.getElementById("app-install-button");
  const helpDialog = document.getElementById("app-install-dialog");
  const helpTitle = document.getElementById("app-install-title");
  const helpCopy = document.getElementById("app-install-copy");
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(navigator.userAgent);
  const isInstalled = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

  if (window.location.origin && document.getElementById("app-qr-code")) {
    const installUrl = `${window.location.origin}/#download-app`;
    document.getElementById("app-qr-code").src = "/api/app-qr-code";
    document.getElementById("app-qr-code").alt = `QR code linking to ${installUrl}`;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
  });

  if (installButton) {
    installButton.addEventListener("click", async () => {
      if (isInstalled) {
        helpTitle.textContent = "You’re already using the app";
        helpCopy.textContent = "MySupermarket is installed on this device. Open it from your home screen for the full-screen app experience.";
        helpDialog?.showModal();
      } else if (installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
      } else {
        helpTitle.textContent = isIOS ? "Add MySupermarket on iPhone or iPad" : isAndroid ? "Install MySupermarket on Android" : "Install MySupermarket";
        helpCopy.innerHTML = isIOS
          ? 'In Safari, tap the <strong>Share</strong> button, choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.'
          : isAndroid
            ? 'In Chrome, open the browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.'
            : 'Open this page on your phone and use your browser’s install option, or scan the QR code with your phone camera.';
        helpDialog?.showModal();
      }
    });
  }

  document.getElementById("app-install-close")?.addEventListener("click", () => helpDialog?.close());
  window.addEventListener("appinstalled", () => { installPrompt = null; });
})();
