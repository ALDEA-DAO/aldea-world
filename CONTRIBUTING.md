# Contributing to ALDEA World

Thanks for helping build ALDEA World. This guide explains how the project is organized and what a good contribution
looks like.

## Before you start

- Read the [README](README.md) and, for anything non-trivial, the relevant sections of [`docs/prd.md`](docs/prd.md).
  The PRD is the specification; the [roadmap](docs/product-roadmap.md) says what is being built now.
- For bugs, open an issue with steps to reproduce. For features or design changes, open an issue to discuss first:
  some decisions belong to the ALDEA DAO community (see [GOVERNANCE.md](GOVERNANCE.md)).
- Security issues: do **not** open a public issue — follow [SECURITY.md](SECURITY.md).

## Development setup

Follow [Getting started](README.md#getting-started). In short: Node 22, pnpm 9, Foundry, Bun and Podman (or use
`pnpm dev:lite` without containers).

## Workflow

1. Fork the repository and create a branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Keep changes focused; one topic per pull request.
3. Run the checks locally: `pnpm lint`, `pnpm -r typecheck` and the tests of the packages you touched
   (see [Tests](README.md#tests)).
4. Open a pull request using the template. CI (lint, typecheck, contract tests, unit tests, Slither, gitleaks) must be
   green, and CodeRabbit posts an automated review that a maintainer reads together with yours.
5. A maintainer reviews and merges. Releases and the official version of aldea.world are decided by the community
   through the Atlas, not by merging.

## Conventions

- **Language:** code, comments, commits and documentation in English. In-product copy lives in
  `packages/client/src/locales/` (Spanish is the default locale, English the second).
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org) (`feat(client): …`, `fix(contracts): …`).
- **Solidity (MUD systems):** always `_msgSender()`, never `msg.sender`; systems are stateless; custom errors are
  prefixed with the system name (`CharacterSystem_…`); shared structs go in `src/types/`. Every change ships with
  tests; invariants in `packages/contracts/test/Invariants.t.sol` must keep passing.
- **Effectstream STFs:** deterministic (no `Date`, `Math.random` or I/O; writes only through `World.resolve`) and never
  issue SQL that can fail on chain data (see `packages/effectstream-node/SPIKE.md`).
- **Client:** accessibility first (keyboard, visible focus, `aria-live`, reduced motion, never color alone) and design
  tokens instead of raw colors.
- **Secrets:** never commit keys or `.env` files; each package has a `.env.example`.

## Licensing of contributions

By contributing you agree that your code is licensed under the [MIT License](LICENSE) and your art or lore under
[CC BY-NC-SA 4.0](LICENSE-ASSETS.md).
