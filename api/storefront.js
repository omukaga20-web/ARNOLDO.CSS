const QRCode = require("qrcode");
const { adminRequest } = require("../lib/customer-account");
const { sendJson } = require("../lib/payhero");

module.exports = async function storefront(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const resource = req.query?.resource || requestUrl.searchParams.get("resource") ||
    (requestUrl.pathname === "/api/products" ? "products" :
      requestUrl.pathname === "/api/store-branding" ? "branding" :
        requestUrl.pathname === "/api/app-qr-code" ? "qr-code" : null);

  if (resource === "qr-code") {
    const host = String(req.headers.host || "");
    if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) {
      res.status(400).end("Invalid host.");
      return;
    }

    const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const isLocalHost = /^(localhost|127(?:\.\d{1,3}){3})(?::\d+)?$/i.test(host);
    const protocol = forwardedProtocol === "http" || (!forwardedProtocol && isLocalHost) ? "http" : "https";
    const installUrl = `${protocol}://${host}/#download-app`;
    const svg = await QRCode.toString(installUrl, {
      type: "svg",
      width: 180,
      margin: 1,
      color: { dark: "#123b70", light: "#ffffff" },
    });

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).end(svg);
    return;
  }

  if (resource !== "products" && resource !== "branding") {
    return sendJson(res, 404, { error: "Storefront resource not found." });
  }

  res.setHeader("Cache-Control", resource === "products" ? "public, max-age=30, stale-while-revalidate=60" : "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    if (resource === "products") {
      const products = await adminRequest("store_products?select=id,name,category,price,image_url,description,stock_quantity&is_active=eq.true&order=created_at.asc");
      return sendJson(res, 200, { products });
    }

    const settings = await adminRequest("store_settings?id=eq.primary&select=logo_url&limit=1");
    return sendJson(res, 200, { logo_url: settings[0]?.logo_url || null });
  } catch {
    return sendJson(res, 503, {
      error: resource === "products" ? "The product catalog is temporarily unavailable." : "Store branding is temporarily unavailable.",
    });
  }
};
