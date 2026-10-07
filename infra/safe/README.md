# Safe transactions

Templates for the transactions the ALDEA Safe signs, in the format of the Safe's Transaction Builder (Apps → Transaction
Builder → load a JSON file). Each one says what it does in `meta.description`. Replace every `<PLACEHOLDER>` before
loading it, and set `chainId` to the network (84532 Base Sepolia, 8453 Base).

| File | When |
|---|---|
| `setConfig-genesis.json` | Before Genesis Week: sets until when only souls with the Founder seal are born. |
| `setGovernor-executor.json` | Before the Charter opens: from then on only the Council sets the official version. |
| `openProposal.json` | Opens the Genesis Charter and publishes its rules for the read model, in one batch. |
| `veto.json` | Stops an open or queued proposal, with a public reason. |

The rules input in `openProposal.json` is the proposal's rules as canonical JSON (RFC 8785), wrapped as
`["cp","<proposalId>","<rules JSON>"]` and hex-encoded. `paramsInput` in `packages/shared/src/council.ts` builds
exactly that text:

```ts
import { paramsInput } from "@aldea/shared/council";
import { toHex } from "viem";

toHex(paramsInput(proposalId, {
  kind: "GenesisRatification",
  rule: "approved_unless_objected",
  objectionThresholdBps: 1000,
  weight: "aldea_balance_at_snapshot",
  voters: "founders_only",
  excludedCredentials: ["stake:…", "pay:…"], // treasury, vesting, pools
  durationDays: 7,
}));
```
