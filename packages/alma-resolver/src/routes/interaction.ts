import { randomBytes } from "node:crypto";
import type { HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import type { Hex } from "viem";
import { createChallengeStore, currentLogin, type NodeContext } from "../auth/interaction";
import { emailStart, emailVerify, type EmailConfig } from "../auth/methods/email";
import { passkeyOptions, passkeyVerify, type PasskeyConfig, type PasskeyMode } from "../auth/methods/passkey";
import { walletChallenge, walletVerify, type WalletConfig } from "../auth/methods/wallet";
import type { AlmaAuth, AuthMethod } from "../auth/provider";
import type { SoulDeps } from "../auth/souls";
import { ProblemError } from "../lib/problem";
import { renderLoginPage, type Locale } from "./loginPage";

/**
 * ALMA Auth's login pages (`/interaction/:uid`): the hosted page and the calls it makes. Each method proves control of
 * a key, finds or creates the soul, and finishes the interaction; the browser then goes back to the world.
 */

export interface InteractionRoutesDeps {
  auth: AlmaAuth;
  soul: SoulDeps;
  passkey: PasskeyConfig;
  wallet: WalletConfig;
  email: EmailConfig;
}

function localeOf(c: NodeContext, uiLocales?: unknown): Locale {
  const wanted = `${typeof uiLocales === "string" ? uiLocales : ""} ${c.req.header("accept-language") ?? ""}`.toLowerCase();
  const es = wanted.indexOf("es");
  const en = wanted.indexOf("en");
  return en !== -1 && (es === -1 || en < es) ? "en" : "es";
}

export function createInteractionRoutes(deps: InteractionRoutesDeps) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const challenges = createChallengeStore(deps.soul.db);

  async function finish(c: NodeContext, uid: string, almaId: string, amr: AuthMethod[]) {
    const redirectTo = await deps.auth.completeLogin(uid, { almaId, amr });
    return c.json({ redirectTo });
  }

  app.get("/:uid", async (c) => {
    const interaction = await currentLogin(deps.auth, c);
    const client = await deps.auth.provider.Client.find(String(interaction.params.client_id));
    const nonce = randomBytes(16).toString("base64");
    c.header("content-security-policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
    c.header("cache-control", "no-store");
    c.header("x-frame-options", "DENY");
    return c.html(renderLoginPage({ uid: interaction.uid, clientName: client?.clientName ?? String(interaction.params.client_id), locale: localeOf(c, interaction.params.ui_locales), nonce }));
  });

  app.post("/:uid/passkey/options", async (c) => {
    const { uid } = await currentLogin(deps.auth, c);
    const { mode } = (await c.req.json().catch(() => ({}))) as { mode?: PasskeyMode };
    return c.json(await passkeyOptions(deps.passkey, challenges, uid, mode === "register" ? "register" : "login"));
  });

  app.post("/:uid/passkey/verify", async (c) => {
    const { uid } = await currentLogin(deps.auth, c);
    const { credential } = (await c.req.json().catch(() => ({}))) as { credential?: Parameters<typeof passkeyVerify>[4] };
    if (!credential) throw new ProblemError(400, "invalid_request", "Missing credential");
    const { almaId } = await passkeyVerify(deps.passkey, challenges, deps.soul, uid, credential);
    return finish(c, uid, almaId, ["hwk"]);
  });

  app.post("/:uid/wallet/challenge", async (c) => {
    const { uid } = await currentLogin(deps.auth, c);
    const { address } = (await c.req.json().catch(() => ({}))) as { address?: string };
    return c.json(await walletChallenge(deps.wallet, challenges, uid, String(address ?? "")));
  });

  app.post("/:uid/wallet/verify", async (c) => {
    const { uid } = await currentLogin(deps.auth, c);
    const { message, signature } = (await c.req.json().catch(() => ({}))) as { message?: string; signature?: Hex };
    if (!message || !signature) throw new ProblemError(400, "invalid_request", "Missing message or signature");
    const { almaId } = await walletVerify(deps.wallet, challenges, deps.soul, uid, message, signature);
    return finish(c, uid, almaId, ["pop"]);
  });

  app.post("/:uid/email/start", async (c) => {
    const interaction = await currentLogin(deps.auth, c);
    const { email } = (await c.req.json().catch(() => ({}))) as { email?: string };
    await emailStart(deps.email, deps.soul, String(email ?? ""), localeOf(c, interaction.params.ui_locales));
    return c.body(null, 202);
  });

  app.post("/:uid/email/verify", async (c) => {
    const { uid } = await currentLogin(deps.auth, c);
    const { email, code } = (await c.req.json().catch(() => ({}))) as { email?: string; code?: string };
    const { almaId } = await emailVerify(deps.email, deps.soul, String(email ?? ""), String(code ?? ""));
    return finish(c, uid, almaId, ["otp"]);
  });

  app.post("/:uid/abort", async (c) => {
    const { uid } = await currentLogin(deps.auth, c);
    const interaction = await deps.auth.provider.Interaction.find(uid);
    if (!interaction) throw new ProblemError(400, "interaction_expired", "This sign-in expired");
    interaction.result = { error: "access_denied", error_description: "The person cancelled the sign-in" };
    await interaction.save(interaction.exp - Math.floor(Date.now() / 1000));
    return c.json({ redirectTo: interaction.returnTo });
  });

  return app;
}
