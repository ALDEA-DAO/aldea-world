# Governance

ALDEA World belongs to the ALDEA DAO community. This document says who controls what, today, and which powers are
held as temporary trust until they are decentralized.

## Who controls what

| Power | Holder | How it is exercised |
|---|---|---|
| The World's `aldea` namespace (admin systems, pause) | ALDEA Safe on Base (3-of-5 ALDEA SPOs) | Safe transaction |
| Admin of `AlmaAnchorRegistry` and `AtlasRegistry` on ALDEA's deployment | ALDEA Safe | Safe transaction |
| Controller of the tribe organizations and `alma:main:org:aldea-world` | ALDEA Safe | Safe transaction |
| Official version of ALDEA World in the Atlas | `AldeaCouncilExecutor` (Genesis Charter, 24 h delay) or the Safe until the Council is active | Charter vote / Safe |
| Veto and role changes on `AldeaCouncilExecutor` | ALDEA Safe (guardian) | Safe transaction |
| Merging code into this repository | Maintainers | Pull request review |

Merging code does **not** change what aldea.world serves: only the version registered as official in the Atlas is
published, and its CID is verifiable from the client.

## Declared temporary trust

These roles are operated by AdaSouls today. Each one is limited and publicly verifiable:

- **Founder attestation signer** — signs EIP-712 attestations of $ALDEA balances (15-minute, single-use, bound to one
  account and one soul). Rotatable by the Safe through `AdminSystem.setConfig`.
- **Relayer** — completes births (permissionless anyway) and queues Charter results; a wrong tally does not match the
  published one and can be vetoed during the 24 h delay.
- **Vote batcher** — publishes Founders' signed Charter votes on Base and pays their gas. It cannot forge or change a
  vote (each one carries its Cardano wallet's signature, which every node verifies again). It could delay one, or
  hold back a voter's earlier vote and publish it after a later one (the last vote published is the one that counts);
  a voter sees their counted vote in the Council and can vote again, and anyone can run another batcher or publish a
  signed vote in `CouncilInputs` themselves.
- **Charter rules for the read model** — the read model cannot fetch the rules at a proposal's `paramsURI`, so the
  guardian (the Safe) publishes them in `CouncilInputs` when it opens the proposal. They are part of the public tally,
  with their hash, for anyone to compare with the published ones.
- **Repository administration** — whoever administers the GitHub organization can change the code that gets published
  as a candidate. The goal is that the `ALDEA-DAO` organization has **several administrators who are Safe signers**,
  never a single person. Until then, the current administrators are listed below and on aldea.world under
  `#/acerca` ("temporary trust").

| GitHub organization | Administrators (today) |
|---|---|
| `ALDEA-DAO` | _to be filled in: GitHub handles of the Safe signers_ |
| `AdaSouls` | _to be filled in_ |

## Maintainers

Maintainers review and merge pull requests and triage issues. The list lives in `.github/CODEOWNERS`. Product and
governance decisions with community impact (tribes, classes, the Charter, economic changes) go through ALDEA DAO.
