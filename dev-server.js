const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const projectRoot = __dirname;

try {
  process.loadEnvFile(path.join(projectRoot, ".env.development.local"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const apiHandlers = new Map([
  ["/api/payments/create", require("./api/payments/create")],
  ["/api/payments/status", require("./api/payments/status")],
  ["/api/payments/callback", require("./api/payments/callback")],
  ["/api/payments/stripe-create", require("./api/payments/stripe-create")],
  ["/api/payments/stripe-webhook", require("./api/payments/stripe-webhook")],
  ["/api/auth/config", require("./api/auth/config")],
  ["/api/products", require("./api/storefront")],
  ["/api/admin/customers", require("./api/admin/customers")],
  ["/api/admin/products", require("./api/admin/products")],
  ["/api/admin/users", require("./api/admin/users")],
  ["/api/admin/uploads", require("./api/admin/uploads")],
  ["/api/admin/branding", require("./api/admin/branding")],
  ["/api/store-branding", require("./api/storefront")],
]);

const pageAliases = new Map([
  ["/login", "/login.html"],
  ["/signup", "/signup.html"],
  ["/forgot-password", "/forgot-password.html"],
  ["/reset-password", "/reset-password.html"],
  ["/account", "/account.html"],
  ["/admin", "/admin.html"],
  ["/product", "/product.html"],
  ["/cart", "/cart_Version2.html"],
  ["/auth/callback", "/auth/callback.html"],
]);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readRawBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("Images must be 5 MB or smaller.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const rawBody = await readRawBody(req);
  if (rawBody.length === 0) return {};
  return JSON.parse(rawBody.toString("utf8"));
}

async function handleApi(req, res, url, handler) {
  req.query = Object.fromEntries(url.searchParams.entries());

  try {
    const route = url.pathname.replace(/\/$/, "");
    if (route === "/api/payments/stripe-webhook") req.body = await readRawBody(req);
    else if (route === "/api/admin/uploads") req.body = await readRawBody(req, 4 * 1024 * 1024);
    else req.body = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.statusCode ? error.message : "Invalid request body." });
  }

  const responseAdapter = {
    setHeader: (name, value) => res.setHeader(name, value),
    status(statusCode) {
      res.statusCode = statusCode;
      return this;
    },
    json(payload) {
      res.end(JSON.stringify(payload));
      return this;
    },
  };

  try {
    await handler(req, responseAdapter);
    if (!res.writableEnded) sendJson(res, 204, {});
  } catch {
    if (!res.writableEnded) sendJson(res, 500, { error: "The request could not be completed." });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const apiHandler = apiHandlers.get(url.pathname.replace(/\/$/, ""));

  if (apiHandler) return handleApi(req, res, url, apiHandler);
  if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "API route not found." });
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed." });

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.statusCode = 400;
    return res.end("Invalid URL");
  }

  if (pathname === "/") pathname = "/index.html";
  else pathname = pageAliases.get(pathname) || pathname;
  if (pathname.startsWith("/products/")) pathname = `/public${pathname}`;
  if (["/app-icon.png", "/app-icon-192.png", "/app-icon-512.png"].includes(pathname)) pathname = `/public${pathname}`;
  const filePath = path.resolve(projectRoot, `.${pathname}`);
  const hasHiddenSegment = pathname.split(path.sep).some((segment) => segment.startsWith("."));
  if (!filePath.startsWith(`${projectRoot}${path.sep}`) || hasHiddenSegment) {
    res.statusCode = 404;
    return res.end("Not found");
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.statusCode = 404;
      return res.end("Not found");
    }

    res.setHeader("Content-Type", mimeTypes[path.extname(filePath)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

const port = Number(process.env.PORT || 4173);
server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Supermarket checkout server listening on ${port}.\\n`);
});
