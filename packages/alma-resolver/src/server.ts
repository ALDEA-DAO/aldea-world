import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import type { Hono } from "hono";
import type { AlmaAuth } from "./auth/provider";
import { tooManyRequests, type RateLimiter } from "./middleware/rateLimit";
import { setSecurityHeaders } from "./middleware/security";

/**
 * One HTTP server for the Resolver's API (Hono) and ALMA Auth (oidc-provider, a Koa app): the API owns `/health`,
 * `/v1/*`, the login pages under `/interaction/*` and the "add a passkey" page under `/link/*`; every other path
 * (`/authorize`, `/token`, `/jwks`, `/.well-known/openid-configuration`, …) belongs to the OIDC provider. Rate limits
 * and security headers are applied here, in front of both.
 */
const API_PREFIXES = ["/health", "/alerts", "/v1/", "/interaction/", "/link/"];

export interface ServerOptions {
  /** Absent in tests that are not about limits. */
  limiter?: RateLimiter;
  /** Served over https (everywhere but local development): browsers are told to keep using it. */
  https?: boolean;
}

export function createRequestHandler(app: Hono, auth?: AlmaAuth, { limiter, https = false }: ServerOptions = {}) {
  const api = getRequestListener(app.fetch);
  const oidc = auth?.provider.callback();
  return (req: IncomingMessage, res: ServerResponse) => {
    setSecurityHeaders(req, res, { https });
    const retryAfter = limiter?.over(req);
    if (retryAfter !== undefined) return tooManyRequests(res, retryAfter);
    const path = req.url ?? "/";
    if (!oidc || API_PREFIXES.some((prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix))) return api(req, res);
    return oidc(req, res);
  };
}

export function createResolverServer(app: Hono, auth?: AlmaAuth, options?: ServerOptions) {
  return createServer(createRequestHandler(app, auth, options));
}
