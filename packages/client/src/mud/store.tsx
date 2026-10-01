import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { authConfig } from "../features/auth/config";
import { useAlmaSession } from "../features/auth/useAlmaSession";
import type { Network } from "./setupNetwork";
import { createSystemCalls, type SystemCalls } from "./systemCalls";

/**
 * The World in React: its synced tables for everyone (guests included) and system calls once the player's account is
 * ready. MUD's sync code loads after the first render.
 */

interface MudValue {
  network?: Network;
  systemCalls?: SystemCalls;
  error?: string;
}

const MudContext = createContext<MudValue>({});

export function MudProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<Network>();
  const [error, setError] = useState<string>();
  const { account } = useAlmaSession();

  useEffect(() => {
    let current = true;
    void import("./setupNetwork")
      .then(({ setupNetwork }) => setupNetwork(authConfig().chain))
      .then((n) => (current ? setNetwork(n) : n.stopSync()))
      .catch((err: unknown) => current && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      current = false;
    };
  }, []);

  const value = useMemo<MudValue>(() => ({ network, systemCalls: network && account ? createSystemCalls(network, account) : undefined, error }), [network, account, error]);
  return <MudContext.Provider value={value}>{children}</MudContext.Provider>;
}

export const useMud = () => useContext(MudContext);

type State = ReturnType<Network["useStore"]["getState"]>;
export type WorldState = State;
export type WorldTables = Network["tables"];

/** Reads from the synced World; undefined until the first sync. `select` must return stable values (records, primitives). */
export function useWorld<T>(select: (state: State, tables: Network["tables"]) => T): T | undefined {
  const { network } = useMud();
  const subscribe = useCallback((notify: () => void) => network?.useStore.subscribe(notify) ?? (() => {}), [network]);
  const snapshot = useCallback(() => (network ? select(network.useStore.getState(), network.tables) : undefined), [network, select]);
  return useSyncExternalStore(subscribe, snapshot);
}

/** The chain's latest block while `enabled` (e.g. while a birth waits for its target block). */
export function useBlockNumber(enabled: boolean): bigint | undefined {
  const { network } = useMud();
  const [block, setBlock] = useState<bigint>();
  useEffect(() => {
    if (!enabled || !network) return;
    return network.publicClient.watchBlockNumber({ emitOnBegin: true, onBlockNumber: setBlock });
  }, [enabled, network]);
  return enabled ? block : undefined;
}

// The Census record is written by the first birth: once the sync is live, no record means nobody was born yet
const EMPTY_CENSUS = {
  lastCharacterId: 0,
  totalPopulation: 0,
  gestating: 0,
  classPopulation: Array(11).fill(0) as number[],
  tribePopulation: Array(5).fill(0) as number[],
};
const selectCensus = (state: State, tables: Network["tables"]) =>
  state.getValue(tables.Census, {}) ?? (state.syncProgress.step === "live" ? EMPTY_CENSUS : undefined);
const selectPaused = (state: State, tables: Network["tables"]) => state.getValue(tables.Config, {})?.paused;

/** Births so far: total, gestating and per class and tribe. */
export const useCensus = () => useWorld(selectCensus);
/** True while the World is paused (births, entries and Founder claims wait). */
export const useWorldPaused = () => useWorld(selectPaused) ?? false;
