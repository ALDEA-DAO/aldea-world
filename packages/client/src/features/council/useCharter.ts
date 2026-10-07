import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeCouncil } from "../../lib/effectstream";
import { aldeaWorldId } from "../../mud/deployment";
import { fetchWorld, type AtlasVersion } from "../atlas/atlasApi";
import { authConfig } from "../auth/config";
import { fetchCharter, fetchCharterId, type Charter } from "./councilApi";

const REFRESH_MS = 5_000;
/** A Charter that ended does not change, but a new one can be opened after it: look for it now and then. */
const SETTLED_REFRESH_MS = 60_000;

export interface CharterState {
  /** `none`: no Genesis Charter has been opened for this world yet. */
  status: "loading" | "none" | "ready" | "failed";
  charter?: Charter;
  /** The version being ratified, as the Atlas has it; null when the Atlas does not know it (yet). */
  version?: AtlasVersion | null;
  refresh: () => void;
}

/**
 * This world's Genesis Charter (the newest one), live: read from Effectstream, again whenever the node announces a
 * change in the Council, and every few seconds while it can still change (the read model can run behind the clock). `voter`
 * is the Cardano credential linked to the signed-in soul, to know its weight and vote.
 */
export function useCharter(voter?: string): CharterState {
  const [state, setState] = useState<Omit<CharterState, "refresh">>({ status: "loading" });
  const read = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    let current = true;
    let proposalId: string | null;
    let settled = false;
    let versionOf: string | undefined;

    read.current = async () => {
      const worldId = aldeaWorldId(authConfig().chain.id);
      try {
        // The newest Charter, asked every time: another can be opened while this one is on screen
        proposalId = worldId ? await fetchCharterId(worldId) : null;
        const charter = proposalId ? await fetchCharter(proposalId, voter) : null;
        if (!current) return;
        if (!charter) {
          setState({ status: "none" });
          return;
        }
        settled = charter.proposal.status === "executed" || charter.proposal.status === "vetoed";
        setState((before) => ({ ...before, status: "ready", charter }));
        const versionId = charter.proposal.versionIds[0];
        if (versionId && versionOf !== versionId) {
          const world = await fetchWorld(charter.proposal.worldId).catch(() => undefined);
          if (!current || world === undefined) return;
          versionOf = versionId;
          setState((before) => ({ ...before, version: world?.versions.find((v) => v.versionId === versionId) ?? null }));
        }
      } catch {
        // Keep what was on screen: only a first read that fails has nothing to show
        if (current) setState((before) => (before.status === "ready" ? before : { status: "failed" }));
      }
    };
    void read.current();

    const unsubscribe = subscribeCouncil(() => void read.current());
    let last = Date.now();
    const timer = setInterval(() => {
      if (settled && Date.now() - last < SETTLED_REFRESH_MS) return;
      last = Date.now();
      void read.current();
    }, REFRESH_MS);
    return () => {
      current = false;
      unsubscribe();
      clearInterval(timer);
    };
  }, [voter]);

  const refresh = useCallback(() => void read.current(), []);
  return { ...state, refresh };
}
