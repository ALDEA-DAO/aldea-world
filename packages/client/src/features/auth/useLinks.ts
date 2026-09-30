import { useCallback, useEffect, useMemo, useState } from "react";
import { AlmaApiError, createAlmaApi } from "../../lib/almaApi";
import { authConfig } from "./config";
import { useAlmaSession } from "./useAlmaSession";

/** The signed-in soul's linked keys, and the actions to add, remove and merge them. */

export type LinkRole = "login" | "controller" | "holdings";

export interface AlmaLink {
  id: string;
  kind: "passkey" | "email" | "google" | "apple" | "evm" | "cardano" | "midnight" | "bitcoin" | "lightning";
  display: string;
  roles: LinkRole[];
  label: string | null;
  addedAt: string;
  lastUsedAt: string | null;
}

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export function useLinks() {
  const { status, accessToken } = useAlmaSession();
  const config = useMemo(() => authConfig(), []);
  const almaApi = useMemo(() => createAlmaApi({ apiUrl: config.apiUrl, accessToken }), [config, accessToken]);
  const [links, setLinks] = useState<AlmaLink[]>();
  const [error, setError] = useState<AlmaApiError>();

  const reload = useCallback(async () => {
    setLinks((await almaApi<{ items: AlmaLink[] }>("/v1/me/links")).items);
  }, [almaApi]);

  useEffect(() => {
    if (status !== "player") return;
    let current = true;
    almaApi<{ items: AlmaLink[] }>("/v1/me/links")
      .then(({ items }) => current && setLinks(items))
      .catch((err: unknown) => current && err instanceof AlmaApiError && setError(err));
    return () => {
      current = false;
    };
  }, [status, almaApi]);

  /** Runs an action, keeps its error for the screen and reloads the list when it succeeds. */
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setError(undefined);
      try {
        await action();
        await reload();
        return true;
      } catch (err) {
        if (err instanceof AlmaApiError) setError(err);
        else throw err;
        return false;
      }
    },
    [reload],
  );

  const linkWallet = useCallback(
    (roles: LinkRole[]) =>
      run(async () => {
        const ethereum = (window as { ethereum?: Eip1193 }).ethereum;
        if (!ethereum) throw new AlmaApiError(0, "no_wallet", "No wallet found in this browser");
        const [address] = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
        const { message } = await almaApi<{ message: string }>("/v1/me/links/wallet/challenge", { body: { address, roles } });
        const signature = await ethereum.request({ method: "personal_sign", params: [message, address] });
        await almaApi("/v1/me/links/wallet/verify", { body: { message, signature } });
      }),
    [almaApi, run],
  );

  const startEmail = useCallback((email: string) => run(() => almaApi("/v1/me/links/email/start", { body: { email } })), [almaApi, run]);
  const verifyEmail = useCallback((email: string, code: string) => run(() => almaApi("/v1/me/links/email/verify", { body: { email, code } })), [almaApi, run]);

  /** Passkeys are created on ALMA Auth's page, which comes back here. */
  const addPasskey = useCallback(
    () =>
      run(async () => {
        const { url } = await almaApi<{ url: string }>("/v1/me/links/passkey", { body: { returnTo: location.href } });
        location.assign(url);
      }),
    [almaApi, run],
  );

  const remove = useCallback((id: string) => run(() => almaApi(`/v1/me/links/${id}`, { method: "DELETE" })), [almaApi, run]);
  const merge = useCallback(() => run(() => almaApi("/v1/me/merge", { body: {} })), [almaApi, run]);

  return { links, error, linkWallet, startEmail, verifyEmail, addPasskey, remove, merge, clearError: () => setError(undefined) };
}
