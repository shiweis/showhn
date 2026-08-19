/**
 * Lightweight static file server for screenshots.
 * Serves /screenshots/* from app/public/screenshots/
 * Runs behind Traefik — not exposed externally.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.STATIC_PORT || "3334", 10);
const SCREENSHOTS_DIR = path.resolve(__dirname, "../app/public/screenshots");

const MIME_TYPES = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }

  const pathname = new URL(req.url, "http://localhost").pathname;
  // Only serve /screenshots/*
  if (!pathname.startsWith("/screenshots/")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const filename = path.basename(pathname);
  // Generated screenshots have numeric HN IDs and an optional thumbnail suffix.
  if (!/^\d+(?:_thumb)?\.(?:webp|png|jpe?g)$/i.test(filename)) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  const filePath = path.join(SCREENSHOTS_DIR, filename);
  const ext = path.extname(filename).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stats.size,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[static] Screenshot server listening on 127.0.0.1:${PORT}`);
});
