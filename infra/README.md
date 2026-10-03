# Infrastructure

- **Local:** `compose.yml` (Postgres and anvil) for `pnpm dev`; see the root README.
- **Testnet (Base Sepolia):** the files below. **Testnet has not been deployed yet**: everything here is prepared and
  the images are verified to build and start, but no contract, service or DNS record exists so far.

| File | What it is |
|---|---|
| `docker/node-service.Dockerfile` | ALMA Resolver and relay worker (`--build-arg PACKAGE=@aldea/alma-resolver` or `@aldea/relay-worker`) |
| `docker/effectstream-node.Dockerfile` | Effectstream node (Bun) |
| `docker/mud-indexer.Dockerfile` | MUD store indexer (`postgres-indexer` + `postgres-frontend`) |
| `fly/*.toml` | Fly.io apps for the four services (region `gru`), with the secrets each one needs listed at the top |
| `../scripts/deploy-testnet.sh` | Deploys the contracts to Base Sepolia and writes `packages/shared/src/deployments/84532.json` |
| `../.github/workflows/deploy-testnet.yml` | Manual workflow: services to Fly.io, client to Cloudflare Pages |

Build context is always the repository root: `podman build -f infra/docker/<file> .` (or `docker build`).

## Deploying testnet, in order

1. **Contracts.** With a funded Base Sepolia deployer and a Basescan API key:
   `PRIVATE_KEY=… BASESCAN_API_KEY=… CONFIRM=base-sepolia scripts/deploy-testnet.sh`.
   Register `84532.json` in `packages/shared/src/deployments/index.ts` (`committed[84532]`) and commit both.
2. **Databases.** Managed Postgres 16 with three databases: the Resolver's, Effectstream's and the MUD indexer's.
   **Effectstream's needs the `pg_ivm` extension** (or `ALLOW_NO_PG_IVM=true`, slower: plain views). Create a role for
   the relay that is read-only on Effectstream's database except `INSERT` on `relay_attempts`.
3. **Fly apps and secrets.** `fly apps create` for each `app` in `fly/*.toml`, then `fly secrets set -c infra/fly/<service>.toml …`
   with the secrets listed at the top of each file. ALMA Auth's signing keys:
   `pnpm --filter @aldea/alma-resolver auth:keygen` (keep the output only in the secret manager).
4. **Resolver configuration.** Set `WORLD_ADDRESS` and `ALMA_REGISTRY_ADDRESS` (the sponsored-gas allowlist), and register
   the OIDC client with testnet's redirect URI:
   `ALMA_AUTH_CLIENTS='[{"clientId":"aldea-world","name":"ALDEA World","redirectUris":["https://testnet.aldea.world/"],"postLogoutRedirectUris":["https://testnet.aldea.world/"]}]'`
   then run `pnpm --filter @aldea/alma-resolver db:clients` once (for example with `fly ssh console`).
5. **DNS.** `auth.adasouls.io` → the Resolver app (certificate with `fly certs add`). ALMA Auth must be publicly reachable
   there before the first real sign-in: Turnkey fetches its JWKS to verify ID tokens, and passkeys are bound to that
   domain forever. `testnet.aldea.world` → the Cloudflare Pages project.
6. **Services and client.** Run the "Deploy testnet" workflow (needs the `FLY_API_TOKEN`, `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` repository secrets), or `fly deploy . --config … --dockerfile …` by hand.
7. **CDP paymaster.** In the CDP portal (Live, Base Sepolia): allowlist the World and AlmaAnchorRegistry with the
   functions in `packages/shared/src/sponsorship.ts`, 50 operations per day per account and a daily cap.
8. **Check.** `/health` on the Resolver, Effectstream and the relay; then a full birth on `testnet.aldea.world` from a
   clean browser, and the "View on-chain" link opening the birth transaction on Basescan.

## What testnet confirms for the first time

- The real Turnkey login (`oauth_login` with ALMA Auth's ID token and `nonce = sha256(sessionPublicKey)`).
- A sponsored birth through the Resolver's bundler proxy with the CDP allowlist in place.
- Smart-wallet owners added on-chain (`addOwnerAddress`) from "Your keys".
- Wallet sign-in from a not-yet-deployed smart account (ERC-6492).
