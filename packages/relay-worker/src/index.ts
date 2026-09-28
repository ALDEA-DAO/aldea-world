import { createServer } from "node:http";

/**
 * Relay worker (the Midwife). Phase 0 only exposes the health endpoint used by local orchestration and uptime
 * checks; the outbox polling jobs (completeBirth, councilQueue, councilExecute) arrive in Phase 1 and Phase 5.
 */
const port = Number(process.env.PORT ?? 8788);
const startedAt = new Date().toISOString();

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", startedAt, jobs: [] }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/problem+json" });
  res.end(JSON.stringify({ type: "about:blank", title: "Not found", status: 404, code: "not_found" }));
});

server.listen(port, () => console.log(`relay-worker listening on ${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
