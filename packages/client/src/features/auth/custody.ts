/*
 * The key that owns the player's smart wallet.
 *
 * - With Turnkey (testnet, production): before going to ALMA Auth, the browser creates a session key in IndexedDB
 *   (non-extractable) and sends `nonce = sha256(publicKey)`, which binds the ID token to that key. Back from ALMA
 *   Auth, the Resolver opens a Turnkey session for it, and the browser signs with the soul's EVM key through Turnkey.
 * - Locally (anvil): Turnkey cannot reach a localhost ALMA Auth, so each soul gets a development key kept in this
 *   browser.
 *
 * The Turnkey SDK is loaded only when needed, to keep the first render small.
 */
import type { Address, LocalAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { AuthConfig } from "./config";

async function stamper() {
  const { IndexedDbStamper } = await import("@turnkey/indexed-db-stamper");
  const s = new IndexedDbStamper();
  await s.init();
  return s;
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A fresh session key for a new sign-in, and the nonce that binds the ID token to it. */
export async function newCustodyNonce(config: AuthConfig): Promise<string> {
  if (config.aaMode === "eoa") return hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const s = await stamper();
  await s.resetKeyPair();
  const publicKey = s.getPublicKey();
  if (!publicKey) throw new Error("Could not create the session key");
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(publicKey)));
}

export interface CustodyOwner {
  owner: LocalAccount;
  /** The smart wallet address the Resolver computed (smart mode). */
  smartAccountAddress?: Address;
}

/** Opens the soul's custody session and returns the owner key as a viem account. */
export async function openCustody(config: AuthConfig, { almaId, idToken, accessToken }: { almaId: string; idToken?: string; accessToken?: string }): Promise<CustodyOwner> {
  if (config.aaMode === "eoa") return { owner: developmentOwner(almaId) };
  if (!idToken || !accessToken) throw new Error("Sign in again to unlock your keys");

  const s = await stamper();
  const res = await fetch(`${config.apiUrl}/v1/custody/session`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ oidcToken: idToken, publicKey: s.getPublicKey() }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { title?: string }).title ?? "Your keys are not available right now");
  const session = (await res.json()) as { subOrganizationId: string; ownerAddress: Address; smartAccountAddress: Address };

  const [{ TurnkeyClient }, { createAccount }] = await Promise.all([import("@turnkey/http"), import("@turnkey/viem")]);
  const client = new TurnkeyClient({ baseUrl: config.turnkeyApiUrl }, s);
  const owner = await createAccount({ client, organizationId: session.subOrganizationId, signWith: session.ownerAddress, ethereumAddress: session.ownerAddress });
  return { owner, smartAccountAddress: session.smartAccountAddress };
}

/** Forgets the Turnkey session key of this browser. */
export async function closeCustody(config: AuthConfig) {
  if (config.aaMode === "smart") await (await stamper()).clear();
}

/** Local only: a per-soul key kept in this browser, funded by anvil. */
function developmentOwner(almaId: string): LocalAccount {
  const storageKey = `aldea:dev-owner:${almaId}`;
  let key = localStorage.getItem(storageKey) as `0x${string}` | null;
  if (!key) {
    key = generatePrivateKey();
    localStorage.setItem(storageKey, key);
  }
  return privateKeyToAccount(key);
}
