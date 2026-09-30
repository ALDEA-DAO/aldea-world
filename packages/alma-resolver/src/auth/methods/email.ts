import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { emailCodes } from "../../db/schema";
import { logger } from "../../lib/logger";
import { ProblemError } from "../../lib/problem";
import { loginWithKey, type SoulDeps } from "../souls";

/**
 * Email one-time codes: the fallback and recovery method. The address is never stored, only HMAC(email), so the user
 * types it again to receive a code. Codes have 6 digits, live 10 minutes, allow 5 attempts and at most 3 are sent per
 * address and hour. Starting always answers the same way, so it does not reveal whether an address has a soul.
 */

export interface EmailCodeSender {
  send(to: string, code: string, locale: "es" | "en"): Promise<void>;
}

export interface EmailConfig {
  hmacKey: string;
  sender: EmailCodeSender;
}

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 3;

const normalize = (email: string) => email.trim().toLowerCase();
export const emailHmac = (key: string, email: string) => createHmac("sha256", key).update(normalize(email)).digest();
const codeHash = (code: string) => createHash("sha256").update(code).digest();

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function emailStart(config: EmailConfig, deps: SoulDeps, email: string, locale: "es" | "en") {
  if (!isEmail(email)) throw new ProblemError(400, "invalid_email", "That email address does not look right");
  const hmac = emailHmac(config.hmacKey, email);
  const [{ sent } = { sent: 0 }] = await deps.db
    .select({ sent: sql<number>`count(*)::int` })
    .from(emailCodes)
    .where(and(eq(emailCodes.emailHmac, hmac), gt(emailCodes.createdAt, new Date(Date.now() - 60 * 60 * 1000))));
  if (sent >= MAX_SENDS_PER_HOUR) return; // same answer: the limit is not an oracle either

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await deps.db.insert(emailCodes).values({ emailHmac: hmac, codeHash: codeHash(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  await config.sender.send(normalize(email), code, locale);
}

const wrongCode = () => new ProblemError(401, "invalid_code", "That code did not work", "Check the latest email we sent, or ask for a new code.");

/** Checks and consumes the latest code for this address; returns the link value (`hmac:<hex>`) it proves. */
export async function consumeEmailCode(config: EmailConfig, db: SoulDeps["db"], email: string, code: string): Promise<string> {
  if (!isEmail(email) || !/^\d{6}$/.test(code)) throw wrongCode();
  const hmac = emailHmac(config.hmacKey, email);
  const [latest] = await db
    .select()
    .from(emailCodes)
    .where(and(eq(emailCodes.emailHmac, hmac), isNull(emailCodes.usedAt), gt(emailCodes.expiresAt, new Date())))
    .orderBy(desc(emailCodes.createdAt))
    .limit(1);
  if (!latest || latest.attempts >= MAX_ATTEMPTS) throw wrongCode();

  await db.update(emailCodes).set({ attempts: latest.attempts + 1 }).where(eq(emailCodes.id, latest.id));
  if (!timingSafeEqual(latest.codeHash, codeHash(code))) throw wrongCode();
  await db.update(emailCodes).set({ usedAt: new Date() }).where(eq(emailCodes.id, latest.id));
  return `hmac:${hmac.toString("hex")}`;
}

export async function emailVerify(config: EmailConfig, deps: SoulDeps, email: string, code: string) {
  return loginWithKey(deps, {
    kind: "email",
    value: await consumeEmailCode(config, deps.db, email, code),
    proof: { type: "email_otp", verifiedAt: new Date().toISOString() },
    label: "Email",
  });
}

const SUBJECT = { es: "Tu código de ALMA", en: "Your ALMA code" };
const BODY = {
  es: (code: string) => `Tu código para entrar a ALMA es ${code}. Vence en 10 minutos.\n\nSi no lo pediste, ignora este mensaje.`,
  en: (code: string) => `Your code to sign in to ALMA is ${code}. It expires in 10 minutes.\n\nIf you did not ask for it, ignore this message.`,
};

/** Sends codes through Resend (https://resend.com). */
export function resendSender({ apiKey, from }: { apiKey: string; from: string }): EmailCodeSender {
  return {
    async send(to, code, locale) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject: SUBJECT[locale], text: BODY[locale](code) }),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}: ${await res.text()}`);
    },
  };
}

/** Development only: the code goes to the Resolver's log instead of an inbox. */
export const logSender: EmailCodeSender = {
  async send(_to, code) {
    logger.warn({ code }, "email code (RESEND_API_KEY is not set: development only)");
  },
};
