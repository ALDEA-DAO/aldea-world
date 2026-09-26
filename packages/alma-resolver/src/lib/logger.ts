import pino from "pino";

/** JSON logs in production; pretty logs locally when LOG_PRETTY=1. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "alma-resolver" },
  redact: ["req.headers.authorization", "req.headers.cookie"],
  ...(process.env.LOG_PRETTY === "1" ? { transport: { target: "pino-pretty" } } : {}),
});
