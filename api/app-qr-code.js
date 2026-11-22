const QRCode = require("qrcode");

module.exports = async function appQrCode(req, res) {
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
};
