import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signInWithEmail, startStack, type Stack } from "./helpers/stack";

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(() => stack.close());

const newEmail = () => `soul-${randomBytes(4).toString("hex")}@example.com`;

describe("/v1/waitlist", () => {
  it("signs a soul up once per building: 201, then 409 already_listed", async () => {
    const tokens = await signInWithEmail(stack, newEmail());
    const me = api(stack, tokens.accessToken);

    const first = await me.post("/v1/waitlist", { building: "npc_forge" });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ building: "npc_forge" });

    const again = await me.post("/v1/waitlist", { building: "npc_forge" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "already_listed", detail: "npc_forge" });

    expect((await me.post("/v1/waitlist", { building: "velum_archive" })).status).toBe(201);
    const listed = (await (await me.get("/v1/waitlist")).json()) as { items: { building: string }[] };
    expect(listed.items.map((i) => i.building).sort()).toEqual(["npc_forge", "velum_archive"]);
  });

  it("keeps each soul's sign-ups apart", async () => {
    const other = api(stack, (await signInWithEmail(stack, newEmail())).accessToken);
    expect(await (await other.get("/v1/waitlist")).json()).toEqual({ items: [] });
    expect((await other.post("/v1/waitlist", { building: "npc_forge" })).status).toBe(201);
  });

  it("rejects unknown buildings and requires a session", async () => {
    const me = api(stack, (await signInWithEmail(stack, newEmail())).accessToken);
    expect((await me.post("/v1/waitlist", { building: "town_center" })).status).toBe(400);
    expect((await api(stack, "nope").post("/v1/waitlist", { building: "npc_forge" })).status).toBe(401);
    expect((await api(stack, "nope").get("/v1/waitlist")).status).toBe(401);
  });
});
