/**
 * $ALDEA, the ALDEA DAO native asset on Cardano.
 *
 * The mainnet policy is a one-shot Plutus V1 policy whose parameter UTxO is already spent,
 * so the supply is fixed at 650,000,000 ALDEA: the embedded UTxO cd31184f…2ed8#0 was spent by the single 2022 mint
 * (tx 587bfdfe…fac9f). Verify: https://cardanoscan.io/tokenPolicy/37f9b0f7e6a46d03b46c8f167f3e8f27008bbfe68b2908d34bd5a673
 * Amounts are always handled in base units (6 decimals) as bigint.
 */
export type CardanoNetwork = "mainnet" | "preprod";

export interface AldeaAsset {
  policyId: string;
  assetNameHex: string;
  decimals: number;
}

export const ALDEA_ASSET_NAME_HEX = "414c444541"; // "ALDEA"
export const ALDEA_DECIMALS = 6;

export const ALDEA_ASSETS: Record<CardanoNetwork, AldeaAsset> = {
  mainnet: {
    policyId: "37f9b0f7e6a46d03b46c8f167f3e8f27008bbfe68b2908d34bd5a673",
    assetNameHex: ALDEA_ASSET_NAME_HEX,
    decimals: ALDEA_DECIMALS,
  },
  preprod: {
    // tALDEA: $ALDEA does not exist on preprod, so this is a test token minted for it (scripts/cardano/mint-taldea.ts),
    // under a native-script policy that closed after its single mint of 11,133,510 tALDEA.
    policyId: "e40d3a848fd97bb489c5c9faea52c0609a9e3dab67f735fcc977dac1",
    assetNameHex: ALDEA_ASSET_NAME_HEX,
    decimals: ALDEA_DECIMALS,
  },
};

export const ALDEA_POLICY_ID = ALDEA_ASSETS.mainnet.policyId;

/** Default Founder seal minimum: 1,000 ALDEA in base units (adjustable by the Safe). */
export const MIN_FOUNDER_BALANCE = 1_000n * 10n ** BigInt(ALDEA_DECIMALS);
