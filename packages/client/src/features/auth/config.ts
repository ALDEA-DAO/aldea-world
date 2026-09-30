import type { Chain } from "viem";
import { supportedChains } from "../../mud/supportedChains";
import type { AaMode } from "./smartAccount";

/** Sign in with ALMA and custody settings, from the build's environment. */
export interface AuthConfig {
  issuer: string;
  clientId: string;
  /** The ALMA Resolver (API, bundler proxy, custody sessions). */
  apiUrl: string;
  turnkeyApiUrl: string;
  aaMode: AaMode;
  chain: Chain;
  /** Where ALMA Auth sends the browser back: the app's own page (hash routes carry the screen). */
  redirectUri: string;
}

export function authConfig(): AuthConfig {
  const env = import.meta.env;
  const chainId = Number(env.VITE_CHAIN_ID ?? 31337);
  const chain = supportedChains.find((c) => c.id === chainId);
  if (!chain) throw new Error(`Unsupported VITE_CHAIN_ID ${chainId}`);
  return {
    issuer: env.VITE_ALMA_AUTH_ISSUER ?? "http://localhost:8787",
    clientId: env.VITE_ALMA_AUTH_CLIENT_ID ?? "aldea-world",
    apiUrl: env.VITE_ALMA_API_URL ?? "http://localhost:8787",
    turnkeyApiUrl: env.VITE_TURNKEY_API_URL ?? "https://api.turnkey.com",
    aaMode: env.VITE_AA_MODE === "smart" ? "smart" : "eoa",
    chain,
    redirectUri: `${location.origin}${location.pathname}`,
  };
}
