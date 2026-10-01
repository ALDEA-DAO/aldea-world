import { tribes } from "@aldea/shared/catalog";
import { useEffect, useMemo, useState } from "react";
import { createAlmaApi } from "../../lib/almaApi";
import { authConfig } from "../auth/config";
import { isSignedIn } from "../auth/AlmaAuthProvider";
import { useAlmaSession } from "../auth/useAlmaSession";

/** A soul as the Resolver serves it: its own full document (`/v1/souls/me`) or anyone's public view. */
export interface SoulView {
  id: string;
  type: "human" | "org" | "agent";
  createdAt: string;
  status: "prepared" | "anchored" | "active" | "revoked";
  relationships: { type: string; to: string; evidence: { txHash?: string } }[];
}

export interface SoulState {
  soul?: SoulView;
  /** The tribe the soul is a member of, once the Resolver recorded it. */
  tribe?: { index: number; txHash?: string };
  loading: boolean;
  failed: boolean;
  own: boolean;
}

/**
 * Loads a soul; `almaId` undefined means the signed-in one. With `awaitTribe`, keeps asking every 2 s until the
 * tribe membership shows up (the Resolver records it a few seconds after the birth).
 */
export function useSoul(almaId: string | undefined, awaitTribe: boolean): SoulState {
  const session = useAlmaSession();
  const config = useMemo(() => authConfig(), []);
  const own = isSignedIn(session.status) && (almaId === undefined || almaId === session.almaId);
  const target = own ? "me" : almaId;
  const almaApi = useMemo(() => createAlmaApi({ apiUrl: config.apiUrl, accessToken: session.accessToken }), [config, session.accessToken]);
  const [soul, setSoul] = useState<SoulView>();
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!target) return;
    let current = true;
    almaApi<SoulView>(`/v1/souls/${encodeURIComponent(target)}`)
      .then((s) => current && (setSoul(s), setFailed(false)))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [target, almaApi, round]);

  const membership = soul?.relationships.find((r) => r.type === "member_of");
  const tribeInfo = membership ? tribes.find((t) => t.almaOrgId === membership.to) : undefined;

  const waiting = awaitTribe && Boolean(soul) && !tribeInfo;
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setRound((n) => n + 1), 2_000);
    return () => clearTimeout(timer);
  }, [waiting, round]);

  return {
    soul: target ? soul : undefined,
    tribe: tribeInfo ? { index: tribeInfo.index, txHash: membership?.evidence.txHash } : undefined,
    loading: Boolean(target) && !soul && !failed,
    failed,
    own,
  };
}
