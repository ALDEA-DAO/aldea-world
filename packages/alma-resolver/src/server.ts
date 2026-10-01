import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import type { Hono } from "hono";
import type { AlmaAuth } from "./auth/provider";

/**
 * One HTTP server for the Resolver's API (Hono) and ALMA Auth (oidc-provider, a Koa app): the API owns `/health`,
 * `/v1/*`, the login pages under `/interaction/*` and the "add a passkey" page under `/link/*`; every other path
 * (`/authorize`, `/token`, `/jwks`, `/.well-known/openid-configuration`, …) belongs to the OIDC provider.
 */
const API_PREFIXES = ["/health", "/v1/", "/interaction/", "/link/"];

export function createRequestHandler(app: Hono, auth?: AlmaAuth) {
  const api = getRequestListener(app.fetch);
  const oidc = auth?.provider.callback();
  return (req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? "/";
    if (!oidc || API_PREFIXES.some((prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix))) return api(req, res);
    return oidc(req, res);
  };
}

export function createResolverServer(app: Hono, auth?: AlmaAuth) {
  return createServer(createRequestHandler(app, auth));
}
