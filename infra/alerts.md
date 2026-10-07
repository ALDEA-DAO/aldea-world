# Alerts

What pages someone, where it is measured and how it was forced. Every service answers `GET …/alerts` with 200 while
nothing is wrong and 503 with what is, so an uptime monitor on that address **is** the alert: no monitor needs to
understand the service. Errors go to Sentry (`SENTRY_DSN` in each service, `VITE_SENTRY_DSN` in the client), with the
git commit as the release.

## Monitors (Better Stack, one minute apart)

| Monitor | Address | Alerts when |
|---|---|---|
| Resolver up | `https://<resolver>/health` | not 200 (the database does not answer) |
| Effectstream up | `https://<effectstream>/health` | not 200 |
| Relay up | `https://<relay>/health` | not 200 |
| Vote batcher up | `https://<batcher>/health` | not 200 |
| Client up | `https://aldea.world/health` | not 200 |
| Births and Base | `https://<effectstream>/api/v1/alerts` | 503: `gestation_stuck` or `base_lag` |
| Relay work | `https://<relay>/alerts` | 503: `relay_failing` or `relayer_balance_low` |
| Sponsorship | `https://<resolver>/alerts` | 503: `paymaster_rejections` |

## The alerts

| Alert | Fires when | Measured | What to do first |
|---|---|---|---|
| `gestation_stuck` | A birth has waited more than 60 s for its completion | The read model's outbox against its own clock | Is the relay up and funded? The client completes births by itself after 20 s, so players are born anyway |
| `base_lag` | The read model is more than 30 Base blocks behind | Last Base block read against the RPC's head | The node's log and `/health`: which chain it is waiting for; the RPC provider's status |
| `relay_failing` | A row of the outbox failed 3 or more times in a row | The relay's own retries | `relay_attempts` in the read model's database has each error |
| `relayer_balance_low` | The relayer holds less than 0.02 ETH (`RELAYER_MIN_BALANCE_WEI`) | The relayer's balance on Base | Send it ETH; it should never hold more than 0.1 |
| `paymaster_rejections` | More than 5% of sponsorship requests were refused in this hour and the last, with at least 20 asked | The Resolver's bundler proxy: its own policy, each soul's daily allowance and the paymaster's refusals | The Resolver's log (`sponsorship rejected`, with the reason); the paymaster's dashboard for its daily cap |

The paymaster's daily spending cap and its alert at 80% are set in the provider's dashboard, not here.

## How each was forced

Locally, on 2026-10-07 (anvil, the full stack). **On testnet: pending**, since testnet is not deployed.

| Alert | How | Result |
|---|---|---|
| `relayer_balance_low` | `anvil_setBalance` of the relayer to 0.01 ETH, then back | 503 `0.01 ETH left, under 0.02`, then 200 |
| `gestation_stuck` | A pending completion written into the outbox 90 s in the past, then removed | 503 `1 birth(s) waiting for their completion, the oldest for 90 s`, then 200 |
| `base_lag` | Not forced live: the local node catches up with anvil in under a second | Covered by `packages/effectstream-node/test/births.test.ts` (31 blocks behind fires, 30 does not) |
| `relay_failing` | Not forced live | Covered by `packages/relay-worker/test/council.test.ts` (an unreachable RPC: alert from the third failure until it goes through) |
| `paymaster_rejections` | Not forced live: the local stack has no paymaster | Covered by `packages/alma-resolver/test/aa.test.ts` (3 refused of 40 fires, 3 of 60 does not) |

On testnet, force each one for real before launch: drain the relayer, stop the relay with a birth under way, stop the
node's Base RPC, and send operations the policy refuses.
