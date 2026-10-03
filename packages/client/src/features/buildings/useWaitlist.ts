import { useCallback, useEffect, useMemo, useState } from "react";
import { AlmaApiError, createAlmaApi } from "../../lib/almaApi";
import { isSignedIn } from "../auth/AlmaAuthProvider";
import { authConfig } from "../auth/config";
import { useAlmaSession } from "../auth/useAlmaSession";

export type WaitlistBuilding = "npc_forge" | "velum_archive" | "soul_registry_agents";

/**
 * The signed-in soul's waitlist sign-ups (`/v1/waitlist`): whether it is already listed for `building`, and `join`.
 * A 409 means it already was: that is shown as listed, not as an error.
 */
export function useWaitlist(building: WaitlistBuilding) {
  const session = useAlmaSession();
  const signedIn = isSignedIn(session.status);
  const almaApi = useMemo(() => createAlmaApi({ apiUrl: authConfig().apiUrl, accessToken: session.accessToken }), [session.accessToken]);
  const [listed, setListed] = useState<Set<string>>();
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let current = true;
    almaApi<{ items: { building: string }[] }>("/v1/waitlist")
      // Merged, not replaced: a read that started before a sign-up must not undo it
      .then(({ items }) => current && setListed((known) => new Set([...items.map((i) => i.building), ...(known ?? [])])))
      .catch(() => current && setListed(new Set()));
    return () => {
      current = false;
    };
  }, [almaApi, signedIn]);

  /** Resolves true when the soul is (now or already) listed; rejects when the sign-up failed. */
  const join = useCallback(async () => {
    setJoining(true);
    try {
      await almaApi("/v1/waitlist", { body: { building } }).catch((err: unknown) => {
        if (!(err instanceof AlmaApiError && err.code === "already_listed")) throw err;
      });
      setListed((all) => new Set([...(all ?? []), building]));
    } finally {
      setJoining(false);
    }
  }, [almaApi, building]);

  return { signedIn, loading: signedIn && !listed, listed: Boolean(listed?.has(building)), joining, join };
}
