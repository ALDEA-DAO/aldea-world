import { Hono } from "hono";
import { bearerToken, type AlmaAccess } from "../auth/accessToken";
import { ProblemError } from "../lib/problem";

/**
 * `/v1/presence`: who has ALDEA World open right now, as its own client reports it. A signed-in tab sends a
 * heartbeat every 30 s while it is visible, and "online" is the tabs heard from in the last 90 s. It lives in memory:
 * it is a live figure, not a record, and the Portal always labels it as self-reported.
 */

export const PRESENCE_TTL_MS = 90_000;
/** Tabs counted per soul, so one account cannot inflate the figure. */
const MAX_SESSIONS_PER_SOUL = 5;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface PresenceStore {
  heartbeat: (almaId: string, sessionId: string) => void;
  online: () => number;
}

export function createPresenceStore(now: () => number = Date.now, ttlMs = PRESENCE_TTL_MS): PresenceStore {
  /** Last heartbeat of each of a soul's tabs, oldest first. */
  const souls = new Map<string, Map<string, number>>();
  const prune = () => {
    const oldest = now() - ttlMs;
    for (const [almaId, sessions] of souls) {
      for (const [sessionId, seen] of sessions) if (seen < oldest) sessions.delete(sessionId);
      if (sessions.size === 0) souls.delete(almaId);
    }
  };
  return {
    heartbeat(almaId, sessionId) {
      prune();
      const sessions = souls.get(almaId) ?? new Map<string, number>();
      // Re-inserting keeps the map ordered by last heartbeat
      sessions.delete(sessionId);
      sessions.set(sessionId, now());
      while (sessions.size > MAX_SESSIONS_PER_SOUL) sessions.delete(sessions.keys().next().value!);
      souls.set(almaId, sessions);
    },
    online() {
      prune();
      let total = 0;
      for (const sessions of souls.values()) total += sessions.size;
      return total;
    },
  };
}

export interface PresenceRoutesDeps {
  verifyAccessToken: (token: string) => Promise<AlmaAccess | undefined>;
  store: PresenceStore;
  /** ALDEA World's id in the Atlas, once it is registered. */
  aldeaWorldId: () => string | undefined;
}

export function createPresenceRoutes(deps: PresenceRoutesDeps) {
  const app = new Hono();

  /** One tab of a signed-in soul is looking at the world. */
  app.post("/heartbeat", async (c) => {
    const token = bearerToken(c);
    const access = token ? await deps.verifyAccessToken(token) : undefined;
    if (!access) throw new ProblemError(401, "unauthorized", "Sign in first");
    const { worldId, sessionId } = (await c.req.json().catch(() => ({}))) as { worldId?: unknown; sessionId?: unknown };
    const aldea = deps.aldeaWorldId()?.toLowerCase();
    if (typeof worldId !== "string" || !aldea || worldId.toLowerCase() !== aldea) throw new ProblemError(400, "unknown_world", "This Resolver only counts presence in ALDEA World");
    if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) throw new ProblemError(400, "invalid_session", "sessionId must be 1 to 64 characters of A-Z, a-z, 0-9, _ and -");
    deps.store.heartbeat(access.almaId, sessionId);
    return c.body(null, 204);
  });

  /** Public, and readable from any origin: other worlds' Portals show it next to ALDEA World. */
  app.get("/aldea", (c) => {
    c.header("access-control-allow-origin", "*");
    c.header("access-control-allow-credentials", undefined);
    c.header("cache-control", "no-store");
    return c.json({ online: deps.store.online(), updatedAt: new Date().toISOString() });
  });

  return app;
}
