import { useEffect } from "react";
import { authConfig } from "../features/auth/config";
import { isSignedIn } from "../features/auth/AlmaAuthProvider";
import { useAlmaSession } from "../features/auth/useAlmaSession";
import { aldeaWorldId } from "../mud/deployment";

/**
 * Self-reported presence: while this tab is visible and signed in, it tells the Resolver every 30 s that someone is
 * here. The Resolver counts the tabs heard from in the last 90 s (`GET /v1/presence/aldea`), which the Portal shows
 * as "self-reported". A failed heartbeat is not an error for the player: the next one tries again.
 */

const HEARTBEAT_MS = 30_000;

export function startPresence({ apiUrl, worldId, accessToken }: { apiUrl: string; worldId: string; accessToken: () => string | undefined }) {
  // One id per tab, for as long as it is open
  const sessionId = crypto.randomUUID();
  const beat = () => {
    const token = accessToken();
    if (!token || document.visibilityState !== "visible") return;
    void fetch(`${apiUrl}/v1/presence/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ worldId, sessionId }),
    }).catch(() => undefined);
  };
  beat();
  const timer = setInterval(beat, HEARTBEAT_MS);
  // Coming back to the tab counts at once, without waiting for the next tick
  document.addEventListener("visibilitychange", beat);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", beat);
  };
}

/** Reports presence while someone is signed in and the world is registered in the Atlas. */
export function usePresence() {
  const { status, accessToken } = useAlmaSession();
  const signedIn = isSignedIn(status);
  useEffect(() => {
    if (!signedIn) return;
    const { apiUrl, chain } = authConfig();
    const worldId = aldeaWorldId(chain.id);
    if (!worldId) return;
    return startPresence({ apiUrl, worldId, accessToken });
  }, [signedIn, accessToken]);
}
