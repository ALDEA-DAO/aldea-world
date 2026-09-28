import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { captureError } from "./lib/sentry";
import { logger } from "./lib/logger";
import { problemResponse, toProblem } from "./lib/problem";
import { createAaRoutes, type AaRoutesDeps } from "./routes/aa";
import { createInteractionRoutes, type InteractionRoutesDeps } from "./routes/interaction";

export interface AppDeps {
  /** Resolves when the database answers `SELECT 1`. */
  pingDb: () => Promise<void>;
  /** Latest Base block, or throws when the RPC is unavailable. */
  baseHead: () => Promise<bigint>;
  corsOrigins: string[];
  /** Bundler and paymaster proxy; absent when no CDP endpoint is configured (local development). */
  aa?: AaRoutesDeps;
  /** ALMA Auth's login pages; absent in tests that only exercise the API. */
  interaction?: InteractionRoutesDeps;
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.use("*", requestId());
  app.use("*", cors({ origin: deps.corsOrigins, credentials: true }));
  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    logger.info({ reqId: c.get("requestId"), method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - started) }, "request");
  });

  /** Liveness plus dependencies: ok only when the database answers; baseHead is null when the RPC is down. */
  app.get("/health", async (c) => {
    const [db, head] = await Promise.allSettled([withTimeout(deps.pingDb(), 2000), withTimeout(deps.baseHead(), 2000)]);
    const dbOk = db.status === "fulfilled";
    return c.json(
      { status: dbOk ? "ok" : "error", db: dbOk ? "ok" : "error", baseHead: head.status === "fulfilled" ? head.value.toString() : null },
      dbOk ? 200 : 503,
    );
  });

  if (deps.aa) app.route("/v1/aa", createAaRoutes(deps.aa));
  if (deps.interaction) app.route("/interaction", createInteractionRoutes(deps.interaction));

  app.notFound((c) => problemResponse(c, { status: 404, code: "not_found", title: "Not found" }));
  app.onError((err, c) => {
    const problem = toProblem(err);
    if (problem.status >= 500) {
      logger.error({ err, reqId: c.get("requestId") }, "unhandled error");
      captureError(err);
    }
    return problemResponse(c, problem);
  });

  return app;
}
