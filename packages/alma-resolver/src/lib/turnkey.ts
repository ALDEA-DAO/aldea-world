import { DEFAULT_ETHEREUM_ACCOUNTS, Turnkey, type TurnkeyApiClient } from "@turnkey/sdk-server";
import { getAddress, type Address } from "viem";
import { assertAlmaId } from "./almaId";

/**
 * Custody for souls without a wallet (ADR 0006). Each soul gets its own Turnkey sub-organization, created by the
 * parent organization's API key on the soul's first login:
 *
 * - its only root user signs in with ALMA Auth ID tokens. The user is identified by the token's `iss`, `sub` and `aud`
 *   (registered as claims, so Turnkey does not need a live token at creation), and every login token must carry
 *   `nonce = sha256(sessionPublicKey)`, which binds it to the browser's session key;
 * - an HD wallet with one Ethereum account, the owner of the soul's Coinbase Smart Wallet on Base. Cardano and
 *   Midnight accounts are derived from the same wallet only when they are needed;
 * - Turnkey's own email and SMS login and recovery are disabled: ALMA Auth is the only way in.
 *
 * The parent organization cannot sign for a sub-organization: keys stay non-custodial.
 */

export interface TurnkeyConfig {
  apiBaseUrl: string;
  organizationId: string;
  apiPublicKey: string;
  apiPrivateKey: string;
}

export interface SoulCustodyInput {
  almaId: string;
  /** ALMA Auth issuer, e.g. https://auth.adasouls.io */
  issuer: string;
  /** OIDC client whose ID tokens log in to Turnkey (the world's client id, e.g. `aldea-world`). */
  audience: string;
}

export interface SoulCustody {
  subOrganizationId: string;
  walletId: string;
  /** The Turnkey EVM account: the first owner of the soul's Coinbase Smart Wallet. */
  ownerAddress: Address;
}

export function turnkeyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TurnkeyConfig | undefined {
  const { TURNKEY_ORG_ID, TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY } = env;
  if (!TURNKEY_ORG_ID || !TURNKEY_API_PUBLIC_KEY || !TURNKEY_API_PRIVATE_KEY) return undefined;
  return {
    apiBaseUrl: env.TURNKEY_API_BASE_URL ?? "https://api.turnkey.com",
    organizationId: TURNKEY_ORG_ID,
    apiPublicKey: TURNKEY_API_PUBLIC_KEY,
    apiPrivateKey: TURNKEY_API_PRIVATE_KEY,
  };
}

export function createTurnkeyClient(config: TurnkeyConfig): TurnkeyApiClient {
  return new Turnkey({
    apiBaseUrl: config.apiBaseUrl,
    defaultOrganizationId: config.organizationId,
    apiPublicKey: config.apiPublicKey,
    apiPrivateKey: config.apiPrivateKey,
  }).apiClient();
}

/** Parameters of the soul's sub-organization (pure, so the tests can check what is sent to Turnkey). */
export function soulSubOrganizationParams({ almaId, issuer, audience }: SoulCustodyInput) {
  assertAlmaId(almaId, "human");
  return {
    subOrganizationName: almaId,
    rootUsers: [
      {
        userName: "soul",
        apiKeys: [] as { apiKeyName: string; publicKey: string; curveType: "API_KEY_CURVE_P256" }[],
        authenticators: [],
        oauthProviders: [{ providerName: "ALMA Auth", oidcClaims: { iss: issuer, sub: almaId, aud: audience } }],
      },
    ],
    rootQuorumThreshold: 1,
    wallet: { walletName: "soul", accounts: DEFAULT_ETHEREUM_ACCOUNTS },
    disableEmailRecovery: true,
    disableEmailAuth: true,
    disableOtpEmailAuth: true,
    disableSmsAuth: true,
  };
}

export async function createSoulCustody(
  client: TurnkeyApiClient,
  params: ReturnType<typeof soulSubOrganizationParams>,
): Promise<SoulCustody> {
  const result = await client.createSubOrganization(params);
  const address = result.wallet?.addresses[0];
  if (!result.wallet || !address) throw new Error(`Turnkey created ${result.subOrganizationId} without an EVM account`);
  return { subOrganizationId: result.subOrganizationId, walletId: result.wallet.walletId, ownerAddress: getAddress(address) };
}
