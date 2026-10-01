import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import type { Hex } from "viem";
import { bearerToken, hasRecentAuth, hasRecentPasskey, type AlmaAccess } from "../auth/accessToken";
import type { ChallengeStore } from "../auth/interaction";
import { addLink, listLinks, mergeSouls, removeLink, type LinkRole } from "../auth/links";
import { consumeEmailCode, emailStart, type EmailConfig } from "../auth/methods/email";
import { siweMessage, verifySiwe, type WalletConfig } from "../auth/methods/wallet";
import type { AnyDb } from "../auth/adapter";
import { ProblemError } from "../lib/problem";

/**
 * `/v1/me/*`: the signed-in soul's linked keys (scope `alma:links`). Wallets and a recovery email are linked from the
 * world; passkeys are created on ALMA Auth's domain (their RP), through a one-time link issued here.
 */

export interface MeRoutesDeps {
  db: AnyDb;
  challenges: ChallengeStore;
  verifyAccessToken: (token: string) => Promise<AlmaAccess | undefined>;
  wallet: Pick<WalletConfig, "chainId" | "client">;
  email: EmailConfig;
  /** Origins of the worlds allowed to call (the CORS list): SIWE messages are bound to the caller's origin. */
  worldOrigins: string[];
  /** ALMA Auth's issuer: passkeys are added on its pages. */
  issuer: string;
}

const ROLES: readonly LinkRole[] = ["login", "controller", "holdings"];

export function createMeRoutes(deps: MeRoutesDeps) {
  const app = new Hono<{ Variables: { access: AlmaAccess } }>();

  app.use("*", async (c, next) => {
    const token = bearerToken(c);
    const access = token ? await deps.verifyAccessToken(token) : undefined;
    if (!access) throw new ProblemError(401, "unauthorized", "Sign in first");
    if (!access.scopes.has("alma:links")) throw new ProblemError(403, "insufficient_scope", "This session cannot manage keys");
    c.set("access", access);
    await next();
  });

  const worldOrigin = (c: Context) => {
    const origin = c.req.header("origin");
    if (!origin || !deps.worldOrigins.includes(origin)) throw new ProblemError(403, "unknown_origin", "Keys can only be linked from a registered world");
    return new URL(origin);
  };
  // A stolen access token must not be enough to add a way in: every new key needs a recent sign-in, and a wallet
  // owner of the smart wallet a recent passkey
  const requireStepUp = (access: AlmaAccess, roles: LinkRole[]) => {
    if (!hasRecentAuth(access)) throw new ProblemError(403, "step_up_required", "Confirm it's you", "Sign in again to add a key to your soul.");
    if (roles.includes("controller") && !hasRecentPasskey(access)) {
      throw new ProblemError(403, "step_up_required", "Confirm with your passkey", "Sign in again with your passkey to add an owner to your wallet.");
    }
  };

  app.get("/links", async (c) => c.json({ items: await listLinks(deps.db, c.var.access.almaId) }));

  app.post("/links/wallet/challenge", async (c) => {
    const { address, roles = ["login"] } = (await c.req.json().catch(() => ({}))) as { address?: string; roles?: LinkRole[] };
    if (!Array.isArray(roles) || roles.length === 0 || roles.some((r) => !ROLES.includes(r))) throw new ProblemError(400, "invalid_roles", "Unknown roles");
    requireStepUp(c.var.access, roles);
    const origin = worldOrigin(c);
    const challenge = siweMessage({ domain: origin.host, origin: origin.origin, chainId: deps.wallet.chainId }, String(address ?? ""), "Link this wallet to my soul in ALMA.");
    await deps.challenges.put(c.var.access.almaId, "link-wallet", { message: challenge.message, roles });
    return c.json(challenge);
  });

  app.post("/links/wallet/verify", async (c) => {
    const { access } = c.var;
    const { message, signature } = (await c.req.json().catch(() => ({}))) as { message?: string; signature?: Hex };
    if (!message || !signature) throw new ProblemError(400, "invalid_request", "Missing message or signature");
    const pending = await deps.challenges.take<{ message: string; roles: LinkRole[] }>(access.almaId, "link-wallet");
    const { value } = await verifySiwe(deps.wallet, pending?.message, message, signature);
    requireStepUp(access, pending!.roles);
    const { link, created } = await addLink(deps.db, deps.challenges, access.almaId, {
      kind: "evm",
      value,
      roles: pending!.roles,
      label: "Wallet",
      proof: { type: "caip122", message, signature, chainId: `eip155:${deps.wallet.chainId}`, amr: access.amr, verifiedAt: new Date().toISOString() },
    });
    return c.json({ id: link.id, roles: link.roles }, created ? 201 : 200);
  });

  app.post("/links/email/start", async (c) => {
    requireStepUp(c.var.access, ["login"]);
    const { email } = (await c.req.json().catch(() => ({}))) as { email?: string };
    await emailStart(deps.email, { db: deps.db, chainId: deps.wallet.chainId }, String(email ?? ""), c.req.header("accept-language")?.startsWith("en") ? "en" : "es");
    return c.body(null, 202);
  });

  app.post("/links/email/verify", async (c) => {
    const { email, code } = (await c.req.json().catch(() => ({}))) as { email?: string; code?: string };
    const value = await consumeEmailCode(deps.email, deps.db, String(email ?? ""), String(code ?? ""));
    const { link, created } = await addLink(deps.db, deps.challenges, c.var.access.almaId, {
      kind: "email",
      value,
      roles: ["login"],
      label: "Email",
      proof: { type: "email_otp", verifiedAt: new Date().toISOString() },
    });
    return c.json({ id: link.id, roles: link.roles }, created ? 201 : 200);
  });

  /** A one-time link (5 minutes) to ALMA Auth's "add a passkey" page, which comes back to `returnTo`. */
  app.post("/links/passkey", async (c) => {
    requireStepUp(c.var.access, ["login"]);
    const { returnTo } = (await c.req.json().catch(() => ({}))) as { returnTo?: string };
    const back = returnTo ? URL.parse(returnTo) : null;
    if (!back || !deps.worldOrigins.includes(back.origin)) throw new ProblemError(400, "invalid_return", "Unknown return address");
    const ticket = randomBytes(24).toString("base64url");
    await deps.challenges.put(ticket, "link-passkey", { almaId: c.var.access.almaId, returnTo: back.href });
    return c.json({ url: `${deps.issuer}/link/passkey/${ticket}` });
  });

  app.delete("/links/:id", async (c) => {
    if (!/^[0-9a-f-]{36}$/.test(c.req.param("id"))) throw new ProblemError(404, "not_found", "That key is not linked to your soul");
    await removeLink(deps.db, c.var.access.almaId, c.req.param("id"));
    return c.body(null, 204);
  });

  app.post("/merge", async (c) => c.json(await mergeSouls(deps.db, deps.challenges, c.var.access.almaId)));

  return app;
}
