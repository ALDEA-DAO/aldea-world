import type { HttpBindings } from "@hono/node-server";
import type { Context } from "hono";
import { createPostgresAdapter, type AnyDb } from "./adapter";
import type { AlmaAuth } from "./provider";
import { ProblemError } from "../lib/problem";

/**
 * Helpers for the login pages under `/interaction/:uid`: every call must come from the browser that started the
 * interaction (its `_interaction` cookie is scoped to that path), and challenges are single-use and short-lived.
 */

export type NodeContext = Context<{ Bindings: HttpBindings }>;

/** The pending login interaction of this browser, or a 400 when the uid is not this browser's. */
export async function currentLogin(auth: AlmaAuth, c: NodeContext) {
  const uid = c.req.param("uid");
  const interaction = await auth.provider.interactionDetails(c.env.incoming, c.env.outgoing).catch(() => undefined);
  if (!interaction || interaction.uid !== uid) throw new ProblemError(400, "interaction_expired", "This sign-in expired", "Start again from the world you came from.");
  if (interaction.prompt.name !== "login") throw new ProblemError(400, "interaction_not_login", "Nothing to sign in to");
  return interaction;
}

const CHALLENGE_TTL = 5 * 60;

export function createChallengeStore(db: AnyDb) {
  const Adapter = createPostgresAdapter(db);
  const store = new Adapter("LoginChallenge");
  return {
    async put(uid: string, kind: string, value: Record<string, unknown>) {
      await store.upsert(`${uid}:${kind}`, value, CHALLENGE_TTL);
    },
    /** Returns the challenge once: it is deleted on read. */
    async take<T extends Record<string, unknown>>(uid: string, kind: string): Promise<T | undefined> {
      const id = `${uid}:${kind}`;
      const value = await store.find(id);
      if (value) await store.destroy(id);
      return value as T | undefined;
    },
  };
}
export type ChallengeStore = ReturnType<typeof createChallengeStore>;
