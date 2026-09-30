import { randomBytes } from "node:crypto";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { AnyDb } from "../auth/adapter";
import type { ChallengeStore } from "../auth/interaction";
import { addLink } from "../auth/links";
import { registrationOptions, storeCredential, verifyRegistration, type PasskeyConfig } from "../auth/methods/passkey";
import { links } from "../db/schema";
import { ProblemError } from "../lib/problem";

/**
 * ALMA Auth's "add a passkey" page (`/link/passkey/:ticket`). Passkeys belong to ALMA Auth's domain, so a world
 * sends the player here with a one-time ticket from `POST /v1/me/links/passkey`; the new passkey is linked to the
 * soul with the `login` role and the browser goes back to the world.
 */

export interface LinkPasskeyDeps {
  db: AnyDb;
  challenges: ChallengeStore;
  passkey: PasskeyConfig;
}

type Ticket = { almaId: string; returnTo: string };

const COPY = {
  es: {
    title: "Agrega una passkey",
    lead: "Tu alma tendrá otra forma de entrar.",
    create: "Crear passkey",
    failed: "No salió. Prueba de nuevo.",
    already: "Este dispositivo ya tiene una passkey de tu alma. Usa otro (tu teléfono o una llave de seguridad).",
    back: "Volver",
  },
  en: {
    title: "Add a passkey",
    lead: "Your soul will have another way in.",
    create: "Create passkey",
    failed: "That did not work. Try again.",
    already: "This device already has a passkey for your soul. Use another one (your phone or a security key).",
    back: "Go back",
  },
} as const;

export function createLinkPasskeyRoutes(deps: LinkPasskeyDeps) {
  const app = new Hono();
  const ticketOf = async (ticket: string) => {
    const found = await deps.challenges.peek<Ticket>(ticket, "link-passkey");
    if (!found) throw new ProblemError(410, "challenge_expired", "This link expired", "Start again from your world.");
    return found;
  };

  app.get("/passkey/:ticket", async (c) => {
    const { returnTo } = await ticketOf(c.req.param("ticket"));
    const t = COPY[c.req.header("accept-language")?.toLowerCase().startsWith("en") ? "en" : "es"];
    const nonce = randomBytes(16).toString("base64");
    c.header("content-security-policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`);
    c.header("cache-control", "no-store");
    const base = `/link/passkey/${c.req.param("ticket")}`;
    return c.html(html`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>ALMA · ${t.title}</title>
<style nonce="${nonce}">body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f6f1e7;color:#2a2118;padding:16px}main{max-width:360px;width:100%;background:#fffaf1;border:1px solid #e3d6c2;border-radius:16px;padding:28px}button,a{display:block;width:100%;box-sizing:border-box;text-align:center;font:inherit;border-radius:10px;padding:.75rem;margin:.25rem 0}button{background:#8a4b2a;color:#fff;border:0;font-weight:600;cursor:pointer}a{color:#6b5d4f}#msg{min-height:1.5em;color:#8a4b2a}</style>
</head><body><main><h1>${t.title}</h1><p>${t.lead}</p><button id="create">${t.create}</button><div id="msg" role="status"></div><a href="${returnTo}">${t.back}</a></main>
<script nonce="${nonce}">${raw(`(async () => {
  const say = (m) => { document.getElementById("msg").textContent = m; };
  async function call(path, body) {
    const res = await fetch(${JSON.stringify(base)} + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.title || ${JSON.stringify(t.failed)});
    return data;
  }
  document.getElementById("create").onclick = async () => {
    say("");
    try {
      const options = await call("/options");
      const credential = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) });
      const { redirectTo } = await call("/verify", { credential: credential.toJSON() });
      location.assign(redirectTo);
    } catch (err) {
      say(err.name === "InvalidStateError" ? ${JSON.stringify(t.already)} : err.name === "NotAllowedError" ? ${JSON.stringify(t.failed)} : err.message);
    }
  };
})();`)}</script></body></html>`);
  });

  app.post("/passkey/:ticket/options", async (c) => {
    const ticket = c.req.param("ticket");
    const { almaId } = await ticketOf(ticket);
    const existing = await deps.db
      .select({ value: links.value })
      .from(links)
      .where(and(eq(links.almaId, almaId), eq(links.kind, "passkey"), isNull(links.revokedAt)));
    const options = await registrationOptions(deps.passkey, existing.map((l) => l.value));
    await deps.challenges.put(ticket, "link-passkey-challenge", { challenge: options.challenge });
    return c.json(options);
  });

  app.post("/passkey/:ticket/verify", async (c) => {
    const ticket = c.req.param("ticket");
    const found = await deps.challenges.take<Ticket>(ticket, "link-passkey");
    const pending = await deps.challenges.take<{ challenge: string }>(ticket, "link-passkey-challenge");
    if (!found || !pending) throw new ProblemError(410, "challenge_expired", "This link expired", "Start again from your world.");
    const { credential } = (await c.req.json().catch(() => ({}))) as { credential?: RegistrationResponseJSON };
    if (!credential) throw new ProblemError(400, "invalid_request", "Missing credential");
    const registration = await verifyRegistration(deps.passkey, pending.challenge, credential);
    const { link } = await addLink(deps.db, deps.challenges, found.almaId, {
      kind: "passkey",
      value: registration.credential.id,
      roles: ["login"],
      label: "Passkey",
      proof: { type: "webauthn", verifiedAt: new Date().toISOString() },
    });
    await storeCredential(deps.db, link.id, registration);
    return c.json({ redirectTo: found.returnTo });
  });

  return app;
}
