const http = require("http");
const fs = require("fs");
const path = require("path");
const sgnHandler = require("../api/sgn");

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = parsedUrl.pathname;

  // Manejo de llamadas API
  if (pathname.startsWith("/api/")) {
    let bodyData = "";
    req.on("data", chunk => { bodyData += chunk; });
    req.on("end", async () => {
      req.query = Object.fromEntries(parsedUrl.searchParams.entries());
      req.body = bodyData;

      if (!res.status) {
        res.status = function(code) {
          res.statusCode = code;
          return res;
        };
      }
      if (!res.json) {
        res.json = function(data) {
          if (typeof res.setHeader === "function") {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
          }
          res.end(JSON.stringify(data));
          return res;
        };
      }

      try {
        await sgnHandler(req, res);
      } catch (err) {
        console.error("Local Server API Exception:", err);
        if (!res.writableEnded) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ success: false, message: err.message }));
        }
      }
    });
    return;
  }

  // Redirección de /sgn a /
  if (pathname === "/sgn" || pathname === "/sgn/") {
    res.writeHead(301, { "Location": "/" });
    return res.end();
  }
  if (pathname.startsWith("/sgn/")) {
    res.writeHead(301, { "Location": pathname.replace(/^\/sgn/, "") });
    return res.end();
  }

  // Archivos estáticos
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.join(__dirname, "..", pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 Not Found");
  }
});

server.listen(PORT, () => {
  console.log(`Servidor local SGN corriendo en http://localhost:${PORT}`);
});
