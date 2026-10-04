import type { VersionJson, VersionVerdict } from "@aldea/shared/version";
import { useEffect, useState } from "react";

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

// Checked once per page load: the top bar and the settings screen show the same answer. The check (viem, the Atlas'
// ABI, the deployment) loads after the first render.
let checked: Promise<VersionInfo> | undefined;

/** This client's version, once it has been checked (undefined until then). */
export function useVersion(): VersionInfo | undefined {
  const [info, setInfo] = useState<VersionInfo>();
  useEffect(() => {
    let current = true;
    void (checked ??= import("./versionCheck").then((m) => m.checkVersion())).then((result) => current && setInfo(result));
    return () => {
      current = false;
    };
  }, []);
  return info;
}
