import { CLIENT_MANIFEST_PATH, clientManifestSchema, presenceSchema } from "@aldea/shared/manifest";
import { effectstreamApi, EffectstreamError } from "../../lib/effectstream";

/** The Atlas as Effectstream's read model serves it (`/api/v1/atlas/worlds`). */

export interface AtlasClient {
  clientId: string;
  versionId: string;
  url: string;
  kind: "web" | "mobile" | "desktop" | "agent";
  operatorAlmaIdHash: string;
  operatorAlmaId: string | null;
  registeredTx: string | null;
}

export interface AtlasWorld {
  worldId: string;
  name: string;
  verified: boolean;
  visibility: "public" | "unlisted" | "private";
  parentWorldId: string | null;
  governor: string;
  createdTx: string | null;
  org: { almaIdHash: string; almaId: string | null };
  official: { versionId: string; semver: string; clientCid: string; chainId: number; worldAddress: string } | null;
  candidates: number;
  forks: number;
  clients: AtlasClient[];
  /** `null` when this node has no way to measure the world's on-chain activity. */
  activity24h: { births: number; visits: number; uniqueSouls: number } | null;
}

export type VersionStatus = "none" | "candidate" | "official" | "superseded" | "withdrawn";

export interface AtlasVersion {
  versionId: string;
  parentVersionId: string | null;
  status: VersionStatus;
  semver: string;
  clientCid: string;
  gitCommit: string;
  engine: string;
  chainId: number;
  worldAddress: string;
  registeredTx: string | null;
  /** Unix seconds. */
  registeredTs: number | null;
}

export interface AtlasWorldDetail extends AtlasWorld {
  versions: AtlasVersion[];
  /** From the first ancestor down to the world itself. */
  lineage: { worldId: string; name: string }[];
}

const PAGE = 100;
const MAX_PAGES = 5;

/** Every public world, in registration order (the Portal filters them itself, so it can name each fork's parent). */
export async function fetchWorlds(): Promise<AtlasWorld[]> {
  const worlds: AtlasWorld[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query: string = `visibility=public&limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await effectstreamApi<{ items: AtlasWorld[]; nextCursor: string | null }>(`/api/v1/atlas/worlds?${query}`);
    worlds.push(...res.items);
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return worlds;
}

/** A world with its versions and lineage, or `null` when the Atlas does not know it. */
export async function fetchWorld(worldId: string): Promise<AtlasWorldDetail | null> {
  try {
    return await effectstreamApi<AtlasWorldDetail>(`/api/v1/atlas/worlds/${worldId}`);
  } catch (err) {
    if (err instanceof EffectstreamError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

/** Where "Travel" goes: the world's first web client. */
export const travelUrl = (world: AtlasWorld): string | undefined => world.clients.find((client) => client.kind === "web")?.url;

/**
 * What a world's own client says about who is there: a count, `offline` when the client does not answer with its
 * manifest, or `unavailable` when its presence URL cannot be read. Never an error: it is self-reported decoration.
 */
export type WorldPresence = { state: "online"; online: number } | { state: "offline" } | { state: "unavailable" };

const TIMEOUT_MS = 3_000;
const getJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};

async function readPresence(presenceUrl: string): Promise<WorldPresence> {
  try {
    return { state: "online", online: presenceSchema.parse(await getJson(presenceUrl)).online };
  } catch {
    return { state: "unavailable" };
  }
}

/** `ownPresenceUrl` is this client's own Resolver: its world needs no manifest to find it. */
export async function fetchPresence(world: AtlasWorld, ownPresenceUrl?: string): Promise<WorldPresence | undefined> {
  if (ownPresenceUrl) return readPresence(ownPresenceUrl);
  const client = travelUrl(world);
  if (!client) return undefined;
  let presenceUrl: string;
  try {
    presenceUrl = clientManifestSchema.parse(await getJson(`${client.replace(/\/$/, "")}/${CLIENT_MANIFEST_PATH}`)).presenceUrl;
  } catch {
    return { state: "offline" };
  }
  return readPresence(presenceUrl);
}
