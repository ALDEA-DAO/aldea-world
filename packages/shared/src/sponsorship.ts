/**
 * Calls whose gas ALDEA sponsors (PRD § Security Considerations > Paymaster). The same list is configured as the CDP
 * paymaster's allowlist, and the ALMA Resolver's bundler proxy checks it before forwarding a UserOperation.
 * Anything else, including calls to the player's own smart account (adding or removing owners), is never sponsored.
 */
export const SPONSORED_WORLD_FUNCTIONS = [
  "aldea__requestBirth",
  "aldea__completeBirth",
  "aldea__enterBuilding",
  "aldea__leaveBuilding",
  "aldea__claimFounder",
] as const;

export const SPONSORED_ALMA_REGISTRY_FUNCTIONS = ["anchorHuman"] as const;
