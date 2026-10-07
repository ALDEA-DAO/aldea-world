import { almaAnchorRegistryAbi } from "@aldea/shared/abis";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { AlmaApiError, createAlmaApi } from "../../lib/almaApi";
import { decodeGameError, isGameError, type GameError } from "../../lib/errors";
import { useBlockNumber, useMud, useWorld, type WorldState, type WorldTables } from "../../mud/store";
import { authConfig } from "../auth/config";
import { useAlmaSession } from "../auth/useAlmaSession";
import { resolverProblem } from "../founders/useFounder";
import type { FounderClaim } from "../../mud/systemCalls";
import { track } from "../../lib/analytics";

/**
 * Being born: prepare the soul, then one operation with `anchorHuman` (when the soul is not anchored yet) and
 * `aldea__requestBirth`. The character's state is read from the synced World (`CharacterOf` → `Character`), so a
 * reload or another tab sees the same birth. If nobody completes the birth 20 s after its target block, this client
 * does (FR-011); losing that race to the Midwife is fine.
 */

export type BirthStage =
  | "idle" // no character: pick a class
  | "sending" // preparing the soul and sending the operation
  | "arriving" // gestating, waiting for the target block ("Your soul is arriving…")
  | "choosing" // target block reached, the tribe is being drawn ("The embers are choosing their color…")
  | "completing" // nobody completed it in time: this client does ("Lighting the fire ourselves…")
  | "born";

export interface BirthCharacter {
  id: number;
  characterClass: number;
  tribe: number;
  status: number; // BirthStatus: 0 None, 1 Gestating, 2 Born
  targetBlock: bigint;
  bornAt: bigint;
}

const BORN = 2;
const GESTATING = 1;
/** When this page asked for a birth: the hook is used in several places, the event is tracked once. */
let requestedAt: number | undefined;
const FALLBACK_MS = Number(import.meta.env.VITE_BIRTH_FALLBACK_SECONDS ?? 20) * 1000;

export function useBirth() {
  const { account, accessToken, almaId } = useAlmaSession();
  const { network, systemCalls } = useMud();
  const config = useMemo(() => authConfig(), []);
  const almaApi = useMemo(() => createAlmaApi({ apiUrl: config.apiUrl, accessToken }), [config, accessToken]);
  const [sending, setSending] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [rescheduled, setRescheduled] = useState(false);
  const [error, setError] = useState<GameError>();
  const inFlight = useRef(false);

  const owner = account?.address;
  const selectCharacter = useCallback(
    (state: WorldState, tables: WorldTables) => {
      if (!owner) return undefined;
      const characterId = state.getValue(tables.CharacterOf, { owner })?.characterId;
      return characterId ? state.getRecord(tables.Character, { id: characterId }) : undefined;
    },
    [owner],
  );
  const record = useWorld(selectCharacter);
  // MUD keeps key fields (the id) in the record's key, not in its value
  const character = useMemo(() => (record ? ({ ...record.value, id: record.key.id } as BirthCharacter) : undefined), [record]);
  const latestBlock = useBlockNumber(character?.status === GESTATING);

  const birth = useCallback(
    async (characterClass: number) => {
      if (inFlight.current || !account || !systemCalls || !network || !almaId) return;
      inFlight.current = true;
      setSending(true);
      setError(undefined);
      try {
        const soul = await almaApi<{ almaId: string; almaIdHash: Hex; docHash: Hex }>("/v1/souls/prepare", {
          body: config.aaMode === "eoa" ? { controller: account.address } : {},
        });
        const anchored = await network.publicClient.readContract({
          address: network.deployment.almaRegistry,
          abi: almaAnchorRegistryAbi,
          functionName: "isController",
          args: [soul.almaIdHash, account.address as Address],
        });
        // During Genesis only Founders are born: a soul without the seal claims it in the same operation, with the
        // Resolver's attestation of its linked Cardano wallet (which fails here if it is not eligible)
        const world = network.useStore.getState();
        const genesisEndsAt = world.getValue(network.tables.Config, {})?.genesisEndsAt ?? 0n;
        const isFounder = (world.getValue(network.tables.Founder, { almaIdHash: soul.almaIdHash })?.claimedAt ?? 0n) > 0n;
        const founder = genesisEndsAt * 1000n > BigInt(Date.now()) && !isFounder ? await almaApi<FounderClaim>("/v1/founders/attestation", { body: {} }) : undefined;
        track("soul_prepared");
        await systemCalls.requestBirth({
          characterClass,
          almaIdHash: soul.almaIdHash,
          anchor: anchored ? undefined : { almaId: soul.almaId, docHash: soul.docHash },
          founder,
        });
        requestedAt = Date.now();
        track("birth_requested", { class: characterClass });
        if (founder) track("founder_claimed", { withBirth: true });
      } catch (err) {
        const failure = err instanceof AlmaApiError ? err.code : decodeGameError(err).name;
        track("birth_failed", { code: failure });
        // The Resolver refusing the attestation is the Genesis rule seen from here
        setError(err instanceof AlmaApiError && err.status !== 0 && err.code !== "unknown" ? { name: err.code, copyKey: resolverProblem(err, "es").copyKey } : decodeGameError(err));
      } finally {
        inFlight.current = false;
        setSending(false);
      }
    },
    [account, systemCalls, network, almaId, almaApi, config],
  );

  // Fallback completion: 20 s after the target block exists, if the character is still gestating
  const characterId = character?.id;
  const gestating = character?.status === GESTATING;
  const targetBlock = character?.targetBlock;
  const targetReached = gestating && latestBlock !== undefined && targetBlock !== undefined && latestBlock > targetBlock;
  useEffect(() => {
    if (!targetReached || !systemCalls || characterId === undefined) return;
    const timer = setTimeout(() => {
      setCompleting(true);
      systemCalls
        .completeBirth(characterId)
        .catch((err: unknown) => {
          // Someone else completed it first: that is the expected outcome
          if (!isGameError(err, "CharacterSystem_NotGestating")) setError(decodeGameError(err));
        })
        .finally(() => setCompleting(false));
    }, FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [targetReached, targetBlock, systemCalls, characterId]);

  // A completion that found the block too old moves the target block forward: "the embers rekindled"
  const firstTarget = useRef<bigint | undefined>(undefined);
  useEffect(() => {
    if (targetBlock === undefined) return;
    if (firstTarget.current === undefined) firstTarget.current = targetBlock;
    else if (targetBlock !== firstTarget.current) setRescheduled(true);
  }, [targetBlock]);

  const bornTribe = character?.status === BORN ? character.tribe : undefined;
  const bornClass = character?.characterClass;
  useEffect(() => {
    if (bornTribe === undefined || requestedAt === undefined) return;
    track("birth_completed", { latencyMs: Date.now() - requestedAt, tribe: bornTribe, class: bornClass ?? -1 });
    requestedAt = undefined;
  }, [bornTribe, bornClass]);

  const stage: BirthStage =
    character?.status === BORN
      ? "born"
      : gestating
        ? completing
          ? "completing"
          : targetReached
            ? "choosing"
            : "arriving"
        : sending
          ? "sending"
          : "idle";

  return { stage, character, error, rescheduled, ready: Boolean(account && systemCalls), birth, retryCompletion: () => characterId !== undefined && systemCalls?.completeBirth(characterId) };
}
