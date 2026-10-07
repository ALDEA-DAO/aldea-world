import { almaAnchorRegistryAbi } from "@aldea/shared/abis";
import { almaIdHash } from "@aldea/shared/alma";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { AlmaApiError, createAlmaApi } from "../../lib/almaApi";
import { decodeGameError, isGameError } from "../../lib/errors";
import type { FounderClaim } from "../../mud/systemCalls";
import { useMud, useWorld, type WorldState, type WorldTables } from "../../mud/store";
import { authConfig } from "../auth/config";
import { useAlmaSession } from "../auth/useAlmaSession";

/**
 * The Founder seal of the signed-in soul: whether it has it (read from the synced World), whether Genesis is on, and
 * claiming it. Claiming asks the Resolver for an attestation of the linked Cardano wallet's $ALDEA and sends it to the
 * World in one operation, anchoring the soul first when it is not anchored yet.
 */

/** What went wrong, as copy: an i18n key and its values. */
export interface FounderProblem {
  copyKey: string;
  values?: Record<string, string>;
}

const RESOLVER_COPY: Record<string, string> = {
  below_minimum: "founder.errors.belowMinimum",
  holdings_stale: "founder.errors.readingCardano",
  cardano_not_linked: "founder.errors.notLinked",
  already_founder: "founder.errors.alreadyFounder",
  soul_not_prepared: "founder.errors.tryAgain",
};

/** 1500000000 base units → "1,500" (6 decimals, no trailing zeros). */
export function formatAldea(baseUnits: string | bigint, locale: string): string {
  const value = BigInt(baseUnits);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const separator = (1.1).toLocaleString(locale).charAt(1);
  return `${whole.toLocaleString(locale)}${fraction ? `${separator}${fraction}` : ""}`;
}

export function resolverProblem(err: unknown, locale: string): FounderProblem {
  if (err instanceof AlmaApiError) {
    const { balance, minimum } = err.extra;
    if (err.code === "below_minimum" && balance && minimum) {
      return { copyKey: "founder.errors.missing", values: { amount: formatAldea(BigInt(minimum) - BigInt(balance), locale) } };
    }
    return { copyKey: RESOLVER_COPY[err.code] ?? "founder.errors.tryAgain" };
  }
  return { copyKey: decodeGameError(err).copyKey };
}

const selectGenesisEndsAt = (state: WorldState, tables: WorldTables) => state.getValue(tables.Config, {})?.genesisEndsAt;

export function useFounder(locale = "es") {
  const { account, accessToken, almaId } = useAlmaSession();
  const { network, systemCalls } = useMud();
  const config = useMemo(() => authConfig(), []);
  const almaApi = useMemo(() => createAlmaApi({ apiUrl: config.apiUrl, accessToken }), [config, accessToken]);
  const [claiming, setClaiming] = useState(false);
  const [problem, setProblem] = useState<FounderProblem>();
  const inFlight = useRef(false);

  // The clock, read every half minute: Genesis ends on its own while the page is open
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const hash = useMemo(() => (almaId ? almaIdHash(almaId) : undefined), [almaId]);
  // One primitive per selector: the store compares snapshots by identity
  const selectClaimedAt = useCallback((state: WorldState, tables: WorldTables) => (hash ? state.getValue(tables.Founder, { almaIdHash: hash })?.claimedAt : undefined), [hash]);
  const claimedAt = useWorld(selectClaimedAt);
  const endsAt = useWorld(selectGenesisEndsAt);
  const isFounder = Boolean(claimedAt && claimedAt > 0n);
  const genesisEndsAt = useMemo(() => (endsAt && endsAt > 0n ? new Date(Number(endsAt) * 1000) : undefined), [endsAt]);

  /** A fresh attestation from the Resolver; throws an AlmaApiError when the soul is not eligible right now. */
  const attest = useCallback(() => almaApi<FounderClaim>("/v1/founders/attestation", { body: {} }), [almaApi]);

  const claim = useCallback(async () => {
    if (inFlight.current || !account || !systemCalls || !network || !almaId || !hash) return false;
    inFlight.current = true;
    setClaiming(true);
    setProblem(undefined);
    try {
      // The soul needs its account on Base before anything can be attested to it; an anchored soul already has it
      const prepared = await almaApi<{ almaId: string; docHash: Hex }>("/v1/souls/prepare", { body: config.aaMode === "eoa" ? { controller: account.address } : {} }).catch((err: unknown) => {
        if (err instanceof AlmaApiError && err.code === "soul_already_anchored") return undefined;
        throw err;
      });
      const anchored = await network.publicClient.readContract({ address: network.deployment.almaRegistry, abi: almaAnchorRegistryAbi, functionName: "isController", args: [hash, account.address as Address] });
      const anchor = anchored || !prepared ? undefined : { almaId: prepared.almaId, docHash: prepared.docHash };
      try {
        await systemCalls.claimFounder({ ...(await attest()), anchor });
      } catch (err) {
        // An attestation lasts 15 minutes and works once: ask for another and try again
        if (!isGameError(err, "FounderSystem_AttestationExpired") && !isGameError(err, "FounderSystem_AttestationUsed")) throw err;
        await systemCalls.claimFounder({ ...(await attest()), anchor });
      }
      return true;
    } catch (err) {
      setProblem(resolverProblem(err, locale));
      return false;
    } finally {
      inFlight.current = false;
      setClaiming(false);
    }
  }, [account, systemCalls, network, almaId, hash, almaApi, config, attest, locale]);

  return {
    isFounder,
    /** Until when only Founders are born; undefined when Genesis is not configured. */
    genesisEndsAt,
    genesisActive: genesisEndsAt !== undefined && genesisEndsAt.getTime() > now,
    ready: Boolean(account && systemCalls),
    claiming,
    problem,
    claim,
    attest,
  };
}
