import { describe, expect, it } from "vitest";
import { clientManifestSchema } from "../src/manifest";

describe("clientManifestSchema", () => {
  const manifest = {
    schema: "alma-world-client/v1",
    worldId: `0x${"ab".repeat(32)}`,
    versionId: `0x${"cd".repeat(32)}`,
    name: "ALDEA World",
    operator: "alma:main:org:aldea-world",
    clientCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    gitCommit: "3f2c9a1",
    presenceUrl: "https://api.aldea.world/v1/presence/aldea",
    locale: ["es", "en"],
  };

  it("accepts a complete manifest", () => {
    expect(clientManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it("rejects a wrong schema tag or operator", () => {
    expect(clientManifestSchema.safeParse({ ...manifest, schema: "v2" }).success).toBe(false);
    expect(clientManifestSchema.safeParse({ ...manifest, operator: "aldea-world" }).success).toBe(false);
  });
});
