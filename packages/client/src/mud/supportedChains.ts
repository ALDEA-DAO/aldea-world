/*
 * Chains ALDEA World runs on:
 * - mudFoundry: local anvil (base fee 0), started by `pnpm dev`.
 * - baseSepolia (84532): staging.
 * - base (8453): production.
 *
 * Redstone and Garnet were shut down in May 2026 and are no longer supported.
 */
import { type MUDChain, mudFoundry } from "@latticexyz/common/chains";
import { base, baseSepolia } from "viem/chains";

export const supportedChains: MUDChain[] = [mudFoundry, baseSepolia, base];
