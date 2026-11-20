const DEFAULT_LOGO = "/app-icon-192.png";

function applyLogo(logoUrl) {
  const source = logoUrl || DEFAULT_LOGO;
  document.querySelectorAll(".brand-mark, .auth-logo img, .app-install-dialog-content > img").forEach((image) => {
    image.src = source;
  });
  document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((icon) => {
    icon.href = source;
  });
}

window.addEventListener("store-branding:updated", (event) => {
  applyLogo(event.detail?.logoUrl);
});

const refreshLogo = async () => {
  try {
    const response = await fetch("/api/store-branding", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return;
    const branding = await response.json();
    applyLogo(branding.logo_url);
  } catch {
    applyLogo(null);
  }
};

void refreshLogo();
