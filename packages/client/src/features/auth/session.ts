/*
 * The ALMA Auth session in the browser (Authorization Code + PKCE with oidc-client-ts).
 *
 * - Access and ID tokens live in memory only. The browser keeps the rotating refresh token (and the profile), so a
 *   reload renews the session without a new passkey.
 * - Refresh tokens are single-use: using one twice revokes the whole session. Every refresh therefore runs under a
 *   Web Lock shared by all tabs, and the new tokens are broadcast on `BroadcastChannel("alma-session")`, so tabs never
 *   race each other. Logging out is broadcast too.
 */
import { User, UserManager, WebStorageStateStore } from "oidc-client-ts";
import type { AuthConfig } from "./config";

const CHANNEL = "alma-session";
const REFRESH_LOCK = "alma-session-refresh";
/** Renew this long before the access token expires. */
const RENEW_MARGIN_S = 60;

/** Persists users without their access and ID tokens. */
class RefreshTokenOnlyStorage implements Storage {
  constructor(private readonly inner: Storage) {}
  get length() {
    return this.inner.length;
  }
  key(index: number) {
    return this.inner.key(index);
  }
  getItem(key: string) {
    return this.inner.getItem(key);
  }
  setItem(key: string, value: string) {
    const { access_token: _a, id_token: _i, expires_at: _e, ...rest } = JSON.parse(value) as Record<string, unknown>;
    this.inner.setItem(key, JSON.stringify(rest));
  }
  removeItem(key: string) {
    this.inner.removeItem(key);
  }
  clear() {
    this.inner.clear();
  }
}

type Message = { type: "tokens"; user: string } | { type: "logout" };

export interface ReturnState {
  /** The hash route to go back to after signing in. */
  returnTo: string;
}

export function createAlmaSession(config: AuthConfig) {
  const manager = new UserManager({
    authority: config.issuer,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    post_logout_redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid alma alma:links offline_access",
    userStore: new WebStorageStateStore({ store: new RefreshTokenOnlyStorage(localStorage) }),
    automaticSilentRenew: false,
    monitorSession: false,
    loadUserInfo: false,
    revokeTokenTypes: ["refresh_token"],
    // Keep amr in the profile: it tells the app how the soul signed in
    filterProtocolClaims: ["nbf", "jti", "auth_time", "nonce", "acr", "azp", "at_hash"],
  });

  let current: User | null = null;
  let restoring: Promise<{ user: User | null; returnTo?: string }> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(user: User | null) => void>();
  const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(CHANNEL);

  function set(user: User | null) {
    current = user;
    clearTimeout(timer);
    if (user?.expires_in !== undefined) timer = setTimeout(() => void refresh().catch(() => set(null)), Math.max(5, user.expires_in - RENEW_MARGIN_S) * 1000);
    for (const listener of listeners) listener(user);
  }

  channel?.addEventListener("message", (event: MessageEvent<Message>) => {
    if (event.data.type === "tokens") set(User.fromStorageString(event.data.user));
    if (event.data.type === "logout") set(null);
  });

  function publish(user: User) {
    set(user);
    channel?.postMessage({ type: "tokens", user: user.toStorageString() } satisfies Message);
  }

  /** Renews with the stored refresh token, one tab at a time. */
  async function refresh(): Promise<User | null> {
    const run = async () => {
      // Another tab may have renewed while this one waited for the lock
      if (current && current.expires_in !== undefined && current.expires_in > RENEW_MARGIN_S) return current;
      const stored = await manager.getUser();
      if (!stored?.refresh_token) return null;
      const user = await manager.signinSilent();
      if (user) publish(user);
      return user;
    };
    return navigator.locks ? navigator.locks.request(REFRESH_LOCK, run) : run();
  }

  return {
    subscribe(listener: (user: User | null) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    get user() {
      return current;
    },

    /** Access token for API calls, or undefined when signed out or expired. */
    accessToken() {
      return current && !current.expired ? current.access_token : undefined;
    },

    isCallback() {
      const params = new URLSearchParams(location.search);
      return params.has("state") && (params.has("code") || params.has("error"));
    },

    /**
     * Restores the session on page load: finishes a sign-in callback, or renews from the stored refresh token.
     * Returns the hash route to go back to after a callback. Runs once per page, however often it is called.
     */
    restore(): Promise<{ user: User | null; returnTo?: string }> {
      restoring ??= this.restoreOnce();
      return restoring;
    },

    async restoreOnce(): Promise<{ user: User | null; returnTo?: string }> {
      if (this.isCallback()) {
        try {
          const user = await manager.signinRedirectCallback();
          publish(user);
          return { user, returnTo: (user.state as ReturnState | undefined)?.returnTo };
        } finally {
          // Drop ?code&state from the address bar whatever happened
          history.replaceState(history.state, "", `${location.pathname}${location.hash}`);
        }
      }
      try {
        return { user: await refresh() };
      } catch {
        await manager.removeUser();
        set(null);
        return { user: null };
      }
    },

    /**
     * Goes to ALMA Auth. `nonce` binds the ID token to the custody session key; `reauthenticate` makes ALMA Auth ask
     * for a key again even with a live session (sensitive changes need a recent sign-in).
     */
    async signIn({ nonce, returnTo, reauthenticate }: { nonce: string; returnTo: string; reauthenticate?: boolean }) {
      await manager.signinRedirect({ nonce, state: { returnTo } satisfies ReturnState, ...(reauthenticate ? { prompt: "login" } : {}) });
    },

    /** Revokes the refresh token, signs out of ALMA Auth and tells the other tabs. */
    async signOut() {
      const idToken = current?.id_token;
      await manager.revokeTokens(["refresh_token"]).catch(() => undefined);
      await manager.removeUser();
      channel?.postMessage({ type: "logout" } satisfies Message);
      set(null);
      await manager.signoutRedirect({ id_token_hint: idToken, post_logout_redirect_uri: config.redirectUri });
    },
  };
}

export type AlmaSession = ReturnType<typeof createAlmaSession>;
