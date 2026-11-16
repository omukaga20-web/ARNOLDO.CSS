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
]);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }

  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleApi(req, res, url, handler) {
  req.query = Object.fromEntries(url.searchParams.entries());

  try {
    req.body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: "Invalid request body." });
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
  if (pathname.startsWith("/products/")) pathname = `/public${pathname}`;
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
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

const port = Number(process.env.PORT || 4173);
server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Supermarket checkout server listening on ${port}.\\n`);
});
