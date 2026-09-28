import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { assertAlmaId } from "../src/lib/almaId";
import { ProblemError } from "../src/lib/problem";

const deps = (overrides: Partial<Parameters<typeof createApp>[0]> = {}) => ({
  pingDb: async () => {},
  baseHead: async () => 1234n,
  corsOrigins: ["http://localhost:3000"],
  ...overrides,
});

describe("GET /health", () => {
  it("reports ok with the database and the Base head", async () => {
    const res = await createApp(deps()).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok", baseHead: "1234" });
  });

  it("stays ok without Base but fails without the database", async () => {
    const noRpc = await createApp(deps({ baseHead: async () => Promise.reject(new Error("down")) })).request("/health");
    expect(await noRpc.json()).toMatchObject({ status: "ok", baseHead: null });
    const noDb = await createApp(deps({ pingDb: async () => Promise.reject(new Error("down")) })).request("/health");
    expect(noDb.status).toBe(503);
    expect(await noDb.json()).toMatchObject({ status: "error", db: "error" });
  });
});

describe("problem+json errors", () => {
  it("answers unknown routes with a stable code and no stack trace", async () => {
    const res = await createApp(deps()).request("/v1/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toEqual({ type: "https://api.aldea.world/problems/not_found", title: "Not found", status: 404, code: "not_found" });
  });

  it("hides unexpected errors behind an opaque 500", async () => {
    const app = createApp(deps());
    app.get("/boom", () => {
      throw new Error("secret detail");
    });
    const res = await app.request("/boom");
    const body = (await res.json()) as { code: string };
    expect(res.status).toBe(500);
    expect(body.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("secret detail");
  });

  it("validates ALMA identifiers like the on-chain registry", async () => {
    expect(assertAlmaId("alma:main:org:tribu-raes", "org")).toBe("alma:main:org:tribu-raes");
    expect(() => assertAlmaId("alma:main:organization:tribu-raes")).toThrow(ProblemError);
  });

  it("rejects identifiers alma-core accepts but the registry cannot anchor", () => {
    expect(assertAlmaId("alma:main:human:0123456789abcdef0123456789abcdef", "human")).toBe(
      "alma:main:human:0123456789abcdef0123456789abcdef",
    );
    for (const id of [
      "alma:preview:org:tribu-raes", // another network
      "alma:main:org:Tribu_Raes", // alma-core allows uppercase and underscores
      `alma:main:org:${"a".repeat(65)}`, // over 64 characters
      "alma:main:org", // malformed
    ]) {
      expect(() => assertAlmaId(id)).toThrow(ProblemError);
    }
    expect(() => assertAlmaId("alma:main:org:tribu-raes", "human")).toThrow(ProblemError);
  });
});
