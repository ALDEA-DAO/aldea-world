import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Security headers on every response of the Resolver and of ALMA Auth. The login pages set their own stricter
 * Content-Security-Policy (a nonce per page); what the API answers is data, which no browser should ever render,
 * frame or guess the type of.
 */
export function setSecurityHeaders(req: IncomingMessage, res: ServerResponse, { https }: { https: boolean }) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  // The world's client is another origin and reads these responses (CORS decides which origins may)
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (https) res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  const path = req.url ?? "/";
  if (path.startsWith("/v1/") || path === "/health" || path === "/alerts") {
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("Cache-Control", "no-store");
  }
}
