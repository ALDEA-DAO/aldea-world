import { describe, expect, it } from "vitest";
import { classifyVersion, VERSION_STATUS, versionJsonSchema, type AtlasVersionFacts } from "../src/version";

const WORLD = `0x${"a1".repeat(32)}`;
const OTHER_WORLD = `0x${"a2".repeat(32)}`;
const V1 = `0x${"b1".repeat(32)}`;
const V2 = `0x${"b2".repeat(32)}`;
const claim = { versionId: V1, clientCid: "bafy-v1", gitCommit: "3f2c9a1", semver: "0.1.0" };
const entry = (status: number, overrides: Partial<NonNullable<AtlasVersionFacts["claimed"]>> = {}) => ({ worldId: WORLD, status, clientCid: "bafy-v1", ...overrides });

describe("classifyVersion", () => {
  it("is official only while the world keeps that version official", () => {
    expect(classifyVersion(WORLD, claim, { worldIsFork: false, officialVersionId: V1.toUpperCase().replace("0X", "0x"), claimed: entry(VERSION_STATUS.official) })).toBe("official");
    expect(classifyVersion(WORLD, claim, { worldIsFork: false, officialVersionId: V2, claimed: entry(VERSION_STATUS.superseded) })).toBe("unofficial");
  });

  it("is a candidate until the governor decides", () => {
    expect(classifyVersion(WORLD, claim, { worldIsFork: false, officialVersionId: null, claimed: entry(VERSION_STATUS.candidate) })).toBe("candidate");
    expect(classifyVersion(WORLD, claim, { worldIsFork: false, officialVersionId: V2, claimed: entry(VERSION_STATUS.withdrawn) })).toBe("unofficial");
  });

  it("is unofficial when the Atlas does not back the claim", () => {
    const atlas = { worldIsFork: false, officialVersionId: V2 };
    expect(classifyVersion(WORLD, undefined, atlas)).toBe("unofficial");
    expect(classifyVersion(WORLD, claim, atlas)).toBe("unofficial");
    // The official version of another world, or this version id with another build
    expect(classifyVersion(WORLD, claim, { ...atlas, officialVersionId: V1, claimed: entry(VERSION_STATUS.official, { worldId: OTHER_WORLD }) })).toBe("unofficial");
    expect(classifyVersion(WORLD, claim, { ...atlas, officialVersionId: V1, claimed: entry(VERSION_STATUS.official, { clientCid: "bafy-tampered" }) })).toBe("unofficial");
  });

  it("labels a fork's client as a fork, whatever its version", () => {
    expect(classifyVersion(WORLD, claim, { worldIsFork: true, officialVersionId: V1, claimed: entry(VERSION_STATUS.official) })).toBe("fork");
    expect(classifyVersion(WORLD, undefined, { worldIsFork: true, officialVersionId: null })).toBe("fork");
  });
});

describe("versionJsonSchema", () => {
  it("accepts what the publish step writes and rejects anything else", () => {
    expect(versionJsonSchema.parse(claim)).toEqual(claim);
    expect(versionJsonSchema.safeParse({ ...claim, versionId: "0x12" }).success).toBe(false);
    expect(versionJsonSchema.safeParse("<!doctype html>").success).toBe(false);
  });
});
