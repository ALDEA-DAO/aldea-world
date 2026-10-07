import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { captureError } from "./lib/sentry";
import { logger } from "./lib/logger";
import { problemResponse, toProblem } from "./lib/problem";
import { createAaRoutes, type AaRoutesDeps } from "./routes/aa";
import { createCardanoRoutes, type CardanoRoutesDeps } from "./routes/cardano";
import { createCustodyRoutes, type CustodyRoutesDeps } from "./routes/custody";
import { createFounderRoutes, type FounderRoutesDeps } from "./routes/founders";
import { createLinkPasskeyRoutes, type LinkPasskeyDeps } from "./routes/linkPasskey";
import { createMeRoutes, type MeRoutesDeps } from "./routes/me";
import { createOrgRoutes } from "./routes/orgs";
import { createPresenceRoutes, type PresenceRoutesDeps } from "./routes/presence";
import { createSoulRoutes, type SoulRoutesDeps } from "./routes/souls";
import { createWaitlistRoutes } from "./routes/waitlist";
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
  /** Turnkey sessions for the browser; absent when custody is not configured (local development). */
  custody?: CustodyRoutesDeps;
  /** The soul's linked keys (`/v1/me`) and ALMA Auth's "add a passkey" page (`/link`). */
  links?: { me: MeRoutesDeps; passkey: LinkPasskeyDeps };
  /** Souls: prepare before birth, the signed-in soul and public views. */
  souls?: SoulRoutesDeps;
  /** Linking Cardano wallets (the $ALDEA holders). */
  cardano?: CardanoRoutesDeps;
  /** Founder attestations for souls whose Cardano wallet holds enough $ALDEA. */
  founders?: FounderRoutesDeps;
  /** Self-reported presence in ALDEA World. */
  presence?: PresenceRoutesDeps;
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

  const aa = deps.aa ? createAaRoutes(deps.aa) : undefined;
  if (aa) app.route("/v1/aa", aa);

  /** 200 while nothing is wrong, 503 with what is: an uptime monitor on this address is the alert. */
  app.get("/alerts", (c) => {
    const firing: { alert: string; detail: string }[] = [];
    const rejections = aa?.rejections();
    if (rejections?.alert) firing.push({ alert: "paymaster_rejections", detail: `${rejections.refused} of ${rejections.total} sponsorship requests refused in this hour and the last` });
    return c.json({ ok: firing.length === 0, alerts: firing }, firing.length ? 503 : 200);
  });
  if (deps.custody) app.route("/v1/custody", createCustodyRoutes(deps.custody));
  if (deps.souls) {
    app.route("/v1/souls", createSoulRoutes(deps.souls));
    app.route("/v1/orgs", createOrgRoutes(deps.souls.soul.db));
    app.route("/v1/waitlist", createWaitlistRoutes(deps.souls));
  }
  if (deps.cardano) app.route("/v1/cardano", createCardanoRoutes(deps.cardano));
  if (deps.founders) app.route("/v1/founders", createFounderRoutes(deps.founders));
  if (deps.presence) app.route("/v1/presence", createPresenceRoutes(deps.presence));
  if (deps.links) {
    app.route("/v1/me", createMeRoutes(deps.links.me));
    app.route("/link", createLinkPasskeyRoutes(deps.links.passkey));
  }
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
