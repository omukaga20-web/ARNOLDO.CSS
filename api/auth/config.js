const QRCode = require("qrcode");

module.exports = async function authConfig(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const isQrCode = req.query?.resource === "qr-code"
    || requestUrl.searchParams.get("resource") === "qr-code"
    || requestUrl.pathname === "/api/app-qr-code";

  if (isQrCode) {
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

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return res.status(503).json({ error: "Customer accounts are not configured." });
  }

  return res.status(200).json({
    url,
    anonKey,
    devRedirectUrl: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL || null,
  });
};
