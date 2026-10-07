import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { bucketsFor, createRateLimiter, DEFAULT_LIMITS } from "../src/middleware/rateLimit";
import { createRequestHandler } from "../src/server";

/** Rate limits and security headers, in front of the API as the server applies them. */

const request = (method: string, url: string, authorization?: string) => ({ method, url, headers: authorization ? { authorization } : {} });
const keys = (method: string, url: string, authorization?: string) => bucketsFor(request(method, url, authorization), "1.2.3.4", DEFAULT_LIMITS).map(([key, limit]) => [key.replace(/:[A-Za-z0-9_-]{22}$/, ":<token>"), limit]);

describe("which limit a request spends from", () => {
  it("signing in and linking keys: 20 a minute per address, the OIDC endpoints included", () => {
    for (const url of ["/interaction/abc/passkey/verify", "/link/passkey/t1/verify", "/v1/me/links/wallet/challenge", "/v1/me/merge", "/v1/cardano/link/verify", "/token", "/authorize?client_id=aldea-world", "/session/end"]) {
      expect(keys("POST", url, "Bearer t"), url).toEqual([["auth:1.2.3.4", 20]]);
    }
  });

  it("the rest of the API: per session, with a ceiling per address", () => {
    expect(keys("GET", "/v1/souls/me", "Bearer abc")).toEqual([["session:<token>", 120], ["address:1.2.3.4", 600]]);
    expect(keys("GET", "/v1/souls/alma:main:human:1")).toEqual([["guest:1.2.3.4", 120], ["address:1.2.3.4", 600]]);
    expect(keys("POST", "/v1/aa/rpc", "Bearer abc")).toEqual([["bundler:session:<token>", 600], ["address:1.2.3.4", 600]]);
    // Two tokens are two sessions; the same token is the same one
    const [a] = bucketsFor(request("GET", "/v1/souls/me", "Bearer one"), "1.2.3.4", DEFAULT_LIMITS)[0]!;
    const [b] = bucketsFor(request("GET", "/v1/souls/me", "Bearer two"), "1.2.3.4", DEFAULT_LIMITS)[0]!;
    expect(a).not.toBe(b);
    expect(a).not.toContain("one");
  });

  it("health checks, public keys, discovery and preflights are never limited", () => {
    for (const [method, url] of [["GET", "/health"], ["GET", "/jwks"], ["GET", "/.well-known/openid-configuration"], ["OPTIONS", "/v1/souls/me"]] as const) expect(keys(method, url), url).toEqual([]);
  });
});

describe("the server", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function start(options: { auth?: number; clientIpHeader?: string; https?: boolean } = {}) {
    let clock = 60_000 * 1000;
    const app = new Hono();
    app.get("/health", (c) => c.json({ status: "ok" }));
    app.get("/v1/souls/:id", (c) => c.json({ id: c.req.param("id") }));
    app.post("/interaction/:uid/email/start", (c) => c.body(null, 202));
    const limiter = createRateLimiter({ limits: { ...DEFAULT_LIMITS, auth: options.auth ?? 20 }, clientIpHeader: options.clientIpHeader, now: () => clock });
    server = createServer(createRequestHandler(app, undefined, { limiter, https: options.https }));
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, advance: (ms: number) => void (clock += ms) };
  }

  it("answers the request over the limit with a problem and when to come back, and forgets with the minute", async () => {
    const { base, advance } = await start({ auth: 3 });
    const login = () => fetch(`${base}/interaction/u1/email/start`, { method: "POST" });
    for (let i = 0; i < 3; i++) expect((await login()).status).toBe(202);
    advance(20_000);
    const refused = await login();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("content-type")).toBe("application/problem+json");
    expect(refused.headers.get("retry-after")).toBe("40");
    expect(await refused.json()).toMatchObject({ code: "rate_limited", status: 429 });
    // The API has its own, larger allowance, and health checks none
    expect((await fetch(`${base}/v1/souls/x`)).status).toBe(200);
    expect((await fetch(`${base}/health`)).status).toBe(200);
    advance(40_000);
    expect((await login()).status).toBe(202);
  });

  it("counts per client behind a trusted proxy", async () => {
    const { base } = await start({ auth: 1, clientIpHeader: "fly-client-ip" });
    const login = (ip: string) => fetch(`${base}/interaction/u1/email/start`, { method: "POST", headers: { "fly-client-ip": ip } });
    expect((await login("10.0.0.1")).status).toBe(202);
    expect((await login("10.0.0.2")).status).toBe(202);
    expect((await login("10.0.0.1")).status).toBe(429);
  });

  it("sends the security headers, on refusals too", async () => {
    const { base } = await start({ auth: 0, https: true });
    for (const res of [await fetch(`${base}/v1/souls/x`), await fetch(`${base}/interaction/u1/email/start`, { method: "POST" })]) {
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    }
    const api = await fetch(`${base}/v1/souls/x`);
    expect(api.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(api.headers.get("cache-control")).toBe("no-store");
  });
});
