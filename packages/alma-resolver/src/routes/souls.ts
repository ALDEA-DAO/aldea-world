import { isAlmaId } from "@aldea/shared/alma";
import { Hono, type Context } from "hono";
import { isAddress, type Address } from "viem";
import { bearerToken, type AlmaAccess } from "../auth/accessToken";
import { ensureCustody, ensureDevelopmentController, type SoulDeps } from "../auth/souls";
import { almaDocument, anchorMaterial, findSoul } from "../lib/almaDoc";
import { ProblemError } from "../lib/problem";

/**
 * `/v1/souls`: the signed-in soul (`prepare` before its birth, `me`) and every soul's public view. The soul already
 * exists from its first sign-in; preparing makes sure its controller is set and returns what `anchorHuman` needs.
 */

export interface CharacterView {
  characterId: number;
  status: "gestating" | "born";
  characterClass: number;
  tribe: number | null;
  bornTx?: string;
  bornAt?: string;
}

/** What the read model (Effectstream) knows about a soul in the world; empty until it indexes the soul. */
export interface SoulActivity {
  character: CharacterView | null;
  founder: { claimed: boolean; eligible: boolean; balance?: string } | null;
  tribe: { index: number; almaId: string } | null;
}

export interface SoulRoutesDeps {
  soul: SoulDeps;
  verifyAccessToken: (token: string) => Promise<AlmaAccess | undefined>;
  activity: (almaId: string) => Promise<SoulActivity>;
  /** Local development without a custody provider: the client names its development key as controller. */
  allowDevelopmentController: boolean;
}

export const NO_ACTIVITY: SoulActivity = { character: null, founder: null, tribe: null };

export function createSoulRoutes(deps: SoulRoutesDeps) {
  const app = new Hono();

  const signedIn = async (c: Context) => {
    const token = bearerToken(c);
    const access = token ? await deps.verifyAccessToken(token) : undefined;
    if (!access) throw new ProblemError(401, "unauthorized", "Sign in first");
    const soul = await findSoul(deps.soul.db, access.almaId);
    if (!soul || soul.status === "revoked") throw new ProblemError(404, "soul_not_found", "This soul does not exist");
    return soul;
  };

  app.post("/prepare", async (c) => {
    const soul = await signedIn(c);
    if (soul.status !== "prepared") throw new ProblemError(409, "soul_already_anchored", "This soul is already anchored", soul.almaId);

    const { controller } = (await c.req.json().catch(() => ({}))) as { controller?: string };
    const custody = await ensureCustody(deps.soul, soul.almaId);
    if (!custody) {
      if (!deps.allowDevelopmentController) throw new ProblemError(503, "custody_unavailable", "Your keys are not ready yet", "Try again in a moment.");
      if (!controller || !isAddress(controller)) throw new ProblemError(400, "controller_required", "Name the development key that controls this soul");
      await ensureDevelopmentController(deps.soul, soul.almaId, controller as Address);
    }
    return c.json(anchorMaterial((await findSoul(deps.soul.db, soul.almaId))!));
  });

  app.get("/me", async (c) => {
    const soul = await signedIn(c);
    const [doc, activity] = await Promise.all([almaDocument(deps.soul.db, soul), deps.activity(soul.almaId)]);
    return c.json({ ...doc, character: activity.character, founder: activity.founder });
  });

  app.get("/:almaId", async (c) => {
    const almaId = c.req.param("almaId");
    const soul = isAlmaId(almaId) ? await findSoul(deps.soul.db, almaId) : undefined;
    if (!soul || soul.status === "revoked") throw new ProblemError(404, "soul_not_found", "This soul does not exist");
    const [doc, activity] = await Promise.all([almaDocument(deps.soul.db, soul, { publicOnly: true }), deps.activity(almaId)]);
    const { character } = activity;
    return c.json({
      id: doc.id,
      type: doc.type,
      createdAt: doc.createdAt,
      status: doc.status,
      tribe: activity.tribe,
      character: character && character.status === "born" ? { characterId: character.characterId, characterClass: character.characterClass, bornAt: character.bornAt ?? null } : null,
      founder: activity.founder?.claimed ?? false,
      relationships: doc.relationships,
      bindings: doc.bindings,
    });
  });

  return app;
}

