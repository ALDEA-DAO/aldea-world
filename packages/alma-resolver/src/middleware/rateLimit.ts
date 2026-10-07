import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Rate limits for everything the Resolver serves, ALMA Auth included, applied before a request reaches either:
 *
 * - signing in and linking keys (the login pages, the OIDC endpoints, `/v1/me/links`, `/v1/cardano/link`):
 *   20 requests a minute per address;
 * - the rest of the API: 120 a minute per session (the access token), and 600 a minute per address whatever the
 *   tokens, so that making up tokens buys nothing;
 * - the bundler proxy (`/v1/aa/rpc`): 600 a minute per session. One birth is a burst of calls (estimating, sending,
 *   waiting for the receipt); what it may sponsor is limited by the paymaster's own policy.
 *
 * Counters are per minute and kept in memory: one instance, as deployed. Health checks and the public keys and
 * discovery documents (cacheable, needed to verify tokens) are not limited.
 */

export interface Limits {
  auth: number;
  session: number;
  address: number;
  bundler: number;
}
export const DEFAULT_LIMITS: Limits = { auth: 20, session: 120, address: 600, bundler: 600 };
const WINDOW_MS = 60_000;

const UNLIMITED = /^\/(health|alerts|jwks|\.well-known\/)/;
const AUTH = /^\/(interaction\/|link\/|v1\/me\/links|v1\/me\/merge|v1\/cardano\/link\/)/;

/** Which counters a request spends from, as `[key, limit]` pairs; none for a request that is not limited. */
export function bucketsFor(req: { method?: string; url?: string; headers: IncomingMessage["headers"] }, address: string, limits: Limits): [string, number][] {
  const path = (req.url ?? "/").split("?")[0]!;
  if (req.method === "OPTIONS" || UNLIMITED.test(path)) return [];
  // Everything outside /v1 and the pages is ALMA Auth's own (authorize, token, session end…)
  if (AUTH.test(path) || !path.startsWith("/v1/")) return [[`auth:${address}`, limits.auth]];
  const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];
  const session = token ? `session:${createHash("sha256").update(token).digest("base64url").slice(0, 22)}` : `guest:${address}`;
  const perSession: [string, number] = path === "/v1/aa/rpc" ? [`bundler:${session}`, limits.bundler] : [session, limits.session];
  return [perSession, [`address:${address}`, limits.address]];
}

export function createRateLimiter({ limits = DEFAULT_LIMITS, clientIpHeader, now = Date.now }: { limits?: Limits; clientIpHeader?: string; now?: () => number } = {}) {
  let window = 0;
  let counts = new Map<string, number>();

  /** Who is asking: the header a trusted proxy sets (e.g. `fly-client-ip`), else the connection's own address. */
  const addressOf = (req: IncomingMessage) => {
    const forwarded = clientIpHeader ? req.headers[clientIpHeader.toLowerCase()] : undefined;
    return (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  };

  return {
    /** Seconds to wait when the request is over a limit; undefined when it may go on (and has been counted). */
    over(req: IncomingMessage): number | undefined {
      const current = Math.floor(now() / WINDOW_MS);
      if (current !== window) {
        window = current;
        counts = new Map();
      }
      const buckets = bucketsFor(req, addressOf(req), limits);
      for (const [key] of buckets) counts.set(key, (counts.get(key) ?? 0) + 1);
      return buckets.some(([key, limit]) => counts.get(key)! > limit) ? Math.ceil(((current + 1) * WINDOW_MS - now()) / 1000) : undefined;
    },
  };
}
export type RateLimiter = ReturnType<typeof createRateLimiter>;

/** 429 as a problem document, like every other error of the API. */
export function tooManyRequests(res: ServerResponse, retryAfter: number) {
  res.writeHead(429, { "Content-Type": "application/problem+json", "Retry-After": String(retryAfter) });
  res.end(JSON.stringify({ type: "https://api.aldea.world/problems/rate_limited", title: "Too many requests", status: 429, code: "rate_limited", detail: `Try again in ${retryAfter} s.` }));
}
