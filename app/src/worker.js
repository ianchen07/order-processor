const http = require("http");

const port = Number(process.env.HEALTH_PORT || "8080");

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(port, () => {
  console.log(`Dummy worker running, health endpoint on ${port}`);
});

// 保证进程永远不退出
setInterval(() => {
  console.log("Dummy worker alive");
}, 60_000);