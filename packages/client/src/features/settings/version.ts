import { atlasRegistryAbi } from "@aldea/shared/abis";
import { classifyVersion, versionJsonSchema, type VersionJson, type VersionVerdict } from "@aldea/shared/version";
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { aldeaWorldId, atlasAddress } from "../../mud/deployment";
import { authConfig } from "../auth/config";
import { fetchWorld } from "../atlas/atlasApi";

/**
 * What this client is, checked against the Atlas on-chain: the `/version.json` it was published with says which
 * version it claims to be, and the Atlas says whether that version exists, belongs to this world and is official.
 *
 * - `development`: a dev server, which serves no `/version.json`;
 * - `unknown`: the chain could not be read, so nothing is claimed either way.
 */
export interface VersionInfo {
  state: VersionVerdict | "development" | "unknown";
  claim?: VersionJson;
  /** For an unofficial version: where the official one is served, when the Atlas lists a client for it. */
  officialUrl?: string;
}

const ZERO_32 = `0x${"0".repeat(64)}`;

/** The published claim, or undefined when there is none (a dev server answers `/version.json` with the app's HTML). */
async function readClaim(): Promise<VersionJson | undefined> {
  try {
    const res = await fetch(new URL("version.json", document.baseURI), { cache: "no-store" });
    const parsed = versionJsonSchema.safeParse(await res.json());
    return res.ok && parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** A client of the world's official version, as the read model lists it; best effort. */
async function officialClientUrl(worldId: string): Promise<string | undefined> {
  try {
    const world = await fetchWorld(worldId.toLowerCase());
    return world?.clients.find((client) => client.versionId === world.official?.versionId && client.kind === "web")?.url;
  } catch {
    return undefined;
  }
}

async function check(): Promise<VersionInfo> {
  const { chain } = authConfig();
  const worldId = aldeaWorldId(chain.id);
  const claim = await readClaim();
  if (!worldId) return { state: import.meta.env.DEV ? "development" : "unofficial", claim };
  try {
    const { createPublicClient, http } = await import("viem");
    const client = createPublicClient({ chain, transport: http() });
    const atlas = { address: atlasAddress(chain.id), abi: atlasRegistryAbi } as const;
    const [world, claimed] = await Promise.all([
      client.readContract({ ...atlas, functionName: "getWorld", args: [worldId] }),
      claim ? client.readContract({ ...atlas, functionName: "getVersion", args: [claim.versionId as Hex] }) : undefined,
    ]);
    const worldIsFork = world.parentWorldId !== ZERO_32;
    // A dev server claims nothing: that is not a mismatch
    if (!claim && !worldIsFork && import.meta.env.DEV) return { state: "development" };
    const state = classifyVersion(worldId, claim, {
      worldIsFork,
      officialVersionId: world.officialVersionId === ZERO_32 ? null : world.officialVersionId,
      claimed: claimed && claimed.status !== 0 ? { worldId: claimed.worldId, status: claimed.status, clientCid: claimed.clientCid } : undefined,
    });
    return { state, claim, officialUrl: state === "unofficial" ? await officialClientUrl(worldId) : undefined };
  } catch {
    return { state: "unknown", claim };
  }
}

// Checked once per page load: the top bar and the settings screen show the same answer
let checked: Promise<VersionInfo> | undefined;

/** This client's version, once it has been checked (undefined until then). */
export function useVersion(): VersionInfo | undefined {
  const [info, setInfo] = useState<VersionInfo>();
  useEffect(() => {
    let current = true;
    void (checked ??= check()).then((result) => current && setInfo(result));
    return () => {
      current = false;
    };
  }, []);
  return info;
}
