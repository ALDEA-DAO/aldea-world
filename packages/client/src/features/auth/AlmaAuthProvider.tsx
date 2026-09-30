import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "oidc-client-ts";
import { authConfig } from "./config";
import { createAlmaSession } from "./session";
import type { PlayerAccount } from "./smartAccount";

// Custody and the smart wallet (viem account abstraction, Turnkey) load after the first render
const custody = () => import("./custody");
const smartAccount = () => import("./smartAccount");

/**
 * Sign in with ALMA for the whole app. Every screen works as a guest; only writing actions need a session.
 *
 * - `guest`: no session.
 * - `player`: signed in with a soul (prepared until it is anchored on-chain when the player is born).
 */
export type SessionStatus = "loading" | "guest" | "player";

export interface AlmaSessionValue {
  status: SessionStatus;
  almaId?: string;
  /** How the soul signed in (`hwk` passkey, `otp` email code, `pop` wallet). */
  amr?: string[];
  /** The player's account on Base, once the custody session is open. */
  account?: PlayerAccount;
  /** Why the account could not be opened, if it failed. */
  accountError?: string;
  /** True while coming back from ALMA Auth ("Looking for your soul…"). */
  returning: boolean;
  /** The last sign-in failed (not cancelled): offer to retry. */
  signInFailed: boolean;
  accessToken: () => string | undefined;
  /** Signs in; `reauthenticate` asks for a key again even with a live session (before sensitive changes). */
  signIn: (options?: { reauthenticate?: boolean }) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AlmaSessionContext = createContext<AlmaSessionValue | undefined>(undefined);

export function AlmaAuthProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => authConfig(), []);
  const session = useMemo(() => createAlmaSession(config), [config]);
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [account, setAccount] = useState<PlayerAccount>();
  const [accountError, setAccountError] = useState<string>();
  const [returning, setReturning] = useState(() => session.isCallback());
  const [signInFailed, setSignInFailed] = useState(false);
  const accountFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    const apply = (next: User | null) => {
      setUser(next);
      setStatus(next ? "player" : "guest");
      if (!next) {
        // Signed out (here or in another tab): the account goes with the session
        setAccount(undefined);
        accountFor.current = undefined;
      }
    };
    const unsubscribe = session.subscribe(apply);
    void session
      .restore()
      .then(({ user: restored, returnTo }) => {
        apply(restored);
        if (returnTo) location.hash = returnTo;
      })
      .catch((err: unknown) => {
        // Cancelling on ALMA Auth comes back as access_denied: back to the world as a guest, without an error
        setSignInFailed((err as { error?: string }).error !== "access_denied");
        setStatus("guest");
      })
      .finally(() => setReturning(false));
    return () => void unsubscribe();
  }, [session]);

  const almaId = user?.profile.sub;

  // Opens the custody session once per soul: needs the ID token, which arrives with each sign-in and refresh
  useEffect(() => {
    if (!almaId || !user || accountFor.current === almaId) return;
    accountFor.current = almaId;
    setAccountError(undefined);
    void custody()
      .then(({ openCustody }) => openCustody(config, { almaId, idToken: user.id_token, accessToken: user.access_token }))
      .then(async ({ owner }) =>
        (await smartAccount()).createPlayerAccount({
          owner,
          chain: config.chain,
          mode: config.aaMode,
          aaRpcUrl: `${config.apiUrl}/v1/aa/rpc`,
          getAccessToken: session.accessToken,
        }),
      )
      .then(setAccount)
      .catch((err: unknown) => {
        accountFor.current = undefined;
        setAccountError(err instanceof Error ? err.message : String(err));
      });
  }, [almaId, user, config, session]);

  const signIn = useCallback(async (options?: { reauthenticate?: boolean }) => {
    setSignInFailed(false);
    const nonce = await (await custody()).newCustodyNonce(config);
    await session.signIn({ nonce, returnTo: location.hash || "#/", reauthenticate: options?.reauthenticate });
  }, [config, session]);

  const signOut = useCallback(async () => {
    await (await custody()).closeCustody(config).catch(() => undefined);
    await session.signOut();
  }, [config, session]);

  const value = useMemo<AlmaSessionValue>(
    () => ({
      status,
      almaId,
      amr: user?.profile.amr as string[] | undefined,
      account,
      accountError,
      returning,
      signInFailed,
      accessToken: session.accessToken,
      signIn,
      signOut,
    }),
    [status, almaId, user, account, accountError, returning, signInFailed, session, signIn, signOut],
  );

  return <AlmaSessionContext.Provider value={value}>{children}</AlmaSessionContext.Provider>;
}
