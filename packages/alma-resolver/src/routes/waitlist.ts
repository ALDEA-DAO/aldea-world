import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { waitlist } from "../db/schema";
import { ProblemError } from "../lib/problem";
import { signedInSoul, type SoulRoutesDeps } from "./souls";

/**
 * `/v1/waitlist`: a soul signs up for a building under construction, once per building. The Operator exports it as
 * CSV straight from SQL:
 *
 *   psql "$DATABASE_URL" -c "\copy (SELECT alma_id, building, created_at FROM alma.waitlist ORDER BY created_at) TO 'waitlist.csv' CSV HEADER"
 */

export const WAITLIST_BUILDINGS = ["npc_forge", "velum_archive", "soul_registry_agents"] as const;
type WaitlistBuilding = (typeof WAITLIST_BUILDINGS)[number];
const isWaitlistBuilding = (value: unknown): value is WaitlistBuilding => WAITLIST_BUILDINGS.includes(value as WaitlistBuilding);

export function createWaitlistRoutes(deps: Pick<SoulRoutesDeps, "soul" | "verifyAccessToken">) {
  const app = new Hono();
  const signedIn = signedInSoul(deps);

  /** The buildings the signed-in soul is already signed up for. */
  app.get("/", async (c) => {
    const soul = await signedIn(c);
    const rows = await deps.soul.db.select({ building: waitlist.building, createdAt: waitlist.createdAt }).from(waitlist).where(eq(waitlist.almaId, soul.almaId));
    return c.json({ items: rows.map((r) => ({ building: r.building, createdAt: r.createdAt.toISOString() })) });
  });

  /** Signs the soul up: 201 the first time, 409 `already_listed` after that. */
  app.post("/", async (c) => {
    const soul = await signedIn(c);
    const { building } = (await c.req.json().catch(() => ({}))) as { building?: unknown };
    if (!isWaitlistBuilding(building)) throw new ProblemError(400, "invalid_building", `building must be one of ${WAITLIST_BUILDINGS.join(", ")}`);
    const [row] = await deps.soul.db.insert(waitlist).values({ almaId: soul.almaId, building }).onConflictDoNothing().returning({ createdAt: waitlist.createdAt });
    if (!row) throw new ProblemError(409, "already_listed", "This soul is already signed up for this building", building);
    return c.json({ building, createdAt: row.createdAt.toISOString() }, 201);
  });

  return app;
}
