import { randomBytes, randomUUID } from "node:crypto";
import { MIN_FOUNDER_BALANCE } from "@aldea/shared/constants";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { AlmaAccess } from "../auth/accessToken";
import { bearerToken } from "../auth/accessToken";
import type { AnyDb } from "../auth/adapter";
import type { ChallengeStore } from "../auth/interaction";
import { links } from "../db/schema";
import { cardanoSigner, linkPayload, verifyCip8, type CardanoNetworkId } from "../lib/cip8";
import { ProblemError } from "../lib/problem";

/**
 * `/v1/cardano`: linking a Cardano wallet to the signed-in soul, so its $ALDEA counts for it. The wallet only signs a
 * message (CIP-8); no transaction is built and nothing moves. The link has the `holdings` role: it proves ownership
 * and is not a way to sign in.
 */

export interface CardanoRoutesDeps {
  db: AnyDb;
  challenges: ChallengeStore;
  verifyAccessToken: (token: string) => Promise<AlmaAccess | undefined>;
  network: CardanoNetworkId;
  /** Origins of the worlds allowed to call: the signed message names the caller's domain. */
  worldOrigins: string[];
  /** $ALDEA the credential holds, in base units, as the read model knows it; undefined when it cannot be read. */
  holdings: (credential: string) => Promise<string | undefined>;
}

const CHALLENGE = "link-cardano";
// The challenge store keeps challenges for 5 minutes
const CHALLENGE_MS = 5 * 60 * 1000;

export function createCardanoRoutes(deps: CardanoRoutesDeps) {
  const app = new Hono<{ Variables: { access: AlmaAccess } }>();

  app.use("*", async (c, next) => {
    const token = bearerToken(c);
    const access = token ? await deps.verifyAccessToken(token) : undefined;
    if (!access) throw new ProblemError(401, "unauthorized", "Sign in first");
    c.set("access", access);
    await next();
  });

  app.post("/link/challenge", async (c) => {
    const origin = c.req.header("origin");
    if (!origin || !deps.worldOrigins.includes(origin)) throw new ProblemError(403, "unknown_origin", "Wallets can only be linked from a registered world");
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + CHALLENGE_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
    const payload = linkPayload({ almaId: c.var.access.almaId, domain: new URL(origin).host, nonce: randomBytes(8).toString("hex"), expiresAt });
    await deps.challenges.put(challengeId, CHALLENGE, { almaId: c.var.access.almaId, payload });
    return c.json({ challengeId, payload, payloadHex: Buffer.from(payload, "utf8").toString("hex"), expiresAt });
  });

  app.post("/link/verify", async (c) => {
    const { almaId, amr } = c.var.access;
    const body = (await c.req.json().catch(() => ({}))) as { challengeId?: string; address?: string; signature?: string; key?: string };
    if (!body.challengeId || !body.address || !body.signature || !body.key) throw new ProblemError(400, "invalid_request", "Missing challenge, address, signature or key");
    const signer = cardanoSigner(body.address, deps.network);

    const pending = await deps.challenges.take<{ almaId: string; payload: string }>(body.challengeId, CHALLENGE);
    if (!pending || pending.almaId !== almaId) throw new ProblemError(410, "challenge_expired", "The request expired", "Try again.");
    if (!verifyCip8(signer, pending.payload, body.signature, body.key)) {
      throw new ProblemError(401, "invalid_cip8_signature", "The signature did not match", signer.hasStakePart ? "Sign with the wallet's stake address." : undefined);
    }

    const value = `cardano:${signer.credential}`;
    const [taken] = await deps.db.select({ almaId: links.almaId }).from(links).where(and(eq(links.kind, "cardano"), eq(links.value, value), isNull(links.revokedAt))).limit(1);
    if (taken && taken.almaId !== almaId) throw new ProblemError(409, "credential_linked_elsewhere", "This wallet already belongs to another soul");
    const [own] = await deps.db.select({ value: links.value }).from(links).where(and(eq(links.almaId, almaId), eq(links.kind, "cardano"), isNull(links.revokedAt))).limit(1);
    // One Cardano credential per soul: the Founder seal is bound to exactly one
    if (own && own.value !== value) throw new ProblemError(409, "cardano_already_linked", "Your soul already has a Cardano wallet", "Unlink it before linking another one.");
    if (!own) {
      await deps.db.insert(links).values({
        almaId,
        kind: "cardano",
        value,
        roles: ["holdings"],
        label: "Cardano",
        proof: { type: "cip8", payload: pending.payload, signature: body.signature, key: body.key, address: signer.address, amr, verifiedAt: new Date().toISOString() },
      });
    }

    const balance = await deps.holdings(signer.credential).catch(() => undefined);
    return c.json(
      {
        link: { kind: "cardano", value, roles: ["holdings"], hasStakePart: signer.hasStakePart },
        // null: the wallet is linked, but Cardano cannot be read right now
        holdings: balance === undefined ? null : { balance, eligible: BigInt(balance) >= MIN_FOUNDER_BALANCE, minimum: MIN_FOUNDER_BALANCE.toString() },
      },
      own ? 200 : 201,
    );
  });

  return app;
}
