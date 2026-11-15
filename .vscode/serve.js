const http = require("http");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const contentTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
};

http.createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end();
    return;
  }

  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const file = path.resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end();
    return;
  }

  const target = file === root ? path.join(root, "index.html") : file;
  fs.readFile(target, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  });
}).listen(8000, "127.0.0.1", () => {
  console.log("CodeTrack running at http://localhost:8000");
});
