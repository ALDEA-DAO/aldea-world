import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPresenceStore } from "../src/routes/presence";
import { ALDEA_WORLD_ID, api, signInWithEmail, startStack, WORLD, type Stack } from "./helpers/stack";

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(() => stack.close());

const newEmail = () => `soul-${randomBytes(4).toString("hex")}@example.com`;
const online = async (origin?: string) => {
  const res = await fetch(`${stack.issuer}/v1/presence/aldea`, { headers: origin ? { origin } : {} });
  return { res, body: (await res.json()) as { online: number; updatedAt: string } };
};

describe("/v1/presence", () => {
  it("counts each signed-in tab once, however often it reports", async () => {
    const me = api(stack, (await signInWithEmail(stack, newEmail())).accessToken);
    const before = (await online()).body.online;

    expect((await me.post("/v1/presence/heartbeat", { worldId: ALDEA_WORLD_ID, sessionId: "tab-1" })).status).toBe(204);
    expect((await me.post("/v1/presence/heartbeat", { worldId: ALDEA_WORLD_ID.toUpperCase().replace("0X", "0x"), sessionId: "tab-1" })).status).toBe(204);
    expect((await online()).body.online).toBe(before + 1);

    await me.post("/v1/presence/heartbeat", { worldId: ALDEA_WORLD_ID, sessionId: "tab-2" });
    const other = api(stack, (await signInWithEmail(stack, newEmail())).accessToken);
    await other.post("/v1/presence/heartbeat", { worldId: ALDEA_WORLD_ID, sessionId: "tab-1" });
    const { body } = await online();
    expect(body.online).toBe(before + 3);
    expect(Date.parse(body.updatedAt)).not.toBeNaN();
  });

  it("requires a session, ALDEA World's id and a session id", async () => {
    const me = api(stack, (await signInWithEmail(stack, newEmail())).accessToken);
    expect((await api(stack, "nope").post("/v1/presence/heartbeat", { worldId: ALDEA_WORLD_ID, sessionId: "t" })).status).toBe(401);
    expect(await (await me.post("/v1/presence/heartbeat", { worldId: `0x${"ff".repeat(32)}`, sessionId: "t" })).json()).toMatchObject({ code: "unknown_world" });
    expect(await (await me.post("/v1/presence/heartbeat", { worldId: ALDEA_WORLD_ID })).json()).toMatchObject({ code: "invalid_session" });
    expect(await (await me.post("/v1/presence/heartbeat", { worldId: ALDEA_WORLD_ID, sessionId: "no spaces" })).json()).toMatchObject({ code: "invalid_session" });
  });

  it("is readable from any origin, without credentials", async () => {
    for (const origin of ["https://nocturna.example", WORLD]) {
      const { res } = await online(origin);
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    }
  });
});

describe("presence store", () => {
  it("forgets a tab 90 s after its last heartbeat", () => {
    let now = 1_000_000;
    const store = createPresenceStore(() => now);
    store.heartbeat("alma:main:human:a", "tab-1");
    now += 60_000;
    store.heartbeat("alma:main:human:a", "tab-2");
    expect(store.online()).toBe(2);
    now += 30_001;
    expect(store.online()).toBe(1);
    now += 60_000;
    expect(store.online()).toBe(0);
  });

  it("counts at most 5 tabs per soul, the latest ones", () => {
    let now = 0;
    const store = createPresenceStore(() => now);
    for (let tab = 1; tab <= 8; tab++) {
      now += 1_000;
      store.heartbeat("alma:main:human:a", `tab-${tab}`);
    }
    store.heartbeat("alma:main:human:b", "tab-1");
    expect(store.online()).toBe(6);
    // tabs 1 to 3 were dropped: once tab 4's 90 s pass, the soul is left with tabs 5 to 8
    now = 4_000 + 90_001;
    expect(store.online()).toBe(5);
  });
});
