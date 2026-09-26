# ALDEA World — reference contracts and tests

This folder holds the Solidity from `docs/prd.md` § API Specification, extracted exactly as it appears there, plus the tests that verify it. It exists so that Phase 0 starts from code that is known to compile and pass, not from a spec alone. TASK-004 to TASK-007 in `docs/product-roadmap.md` migrate it into `packages/contracts` and `packages/protocol`.

| Folder | Becomes | What it contains |
|---|---|---|
| `contracts/` | `packages/contracts` | The MUD World: `mud.config.ts` (PRD § Data Model > 3.1), the four systems (`CharacterSystem`, `MovementSystem`, `FounderSystem`, `AdminSystem`), the `FounderAttestation` type and the `IAlmaAnchorRegistry` interface (PRD § 4.1). |
| `protocol/` | `packages/protocol` | Pure Foundry, no MUD: `AlmaAnchorRegistry`, `AtlasRegistry` and `AldeaCouncilExecutor` (PRD § 4.2–4.4). |

If the PRD and this folder ever disagree, fix the PRD first and re-extract; the two must stay identical.

## Verified results

Verified on 2026-09-27 with MUD 2.2.23, solc 0.8.24 (via-IR), Foundry 1.5.1, forge-std 1.16.2 (commit `ba4733c3`) and OpenZeppelin Contracts 5.6.1.

**World (`contracts/`, `mud test`): 6 tests pass.**

| Test | What it proves |
|---|---|
| `test_fullBirthFlow` | Two-step birth: `requestBirth` stores the player (not the World) as owner, then `completeBirth` draws the tribe from `blockhash(targetBlock)` and updates the census. Archer (index 0) is a normal class. |
| `test_onePersonOneCharacter` | 1 person = 1 character: a second birth reverts for the same account (`CharacterSystem_AlreadyHasCharacter`) and for the same soul (`CharacterSystem_SoulAlreadyHasCharacter`). A soul the sender does not control is rejected. |
| `test_expiredBlockhashReschedules` | If more than 256 blocks pass, `blockhash` is zero and the birth is rescheduled instead of drawing from a zero seed. |
| `test_enterBuilding` | Entering requires a born character, closed buildings revert, leaving clears the location, and after a controller rotation the character follows the soul. |
| `test_founderAndGenesis` | During Genesis Week only Founders are born. The EIP-712 attestation works once, one stake credential seals one soul, the minimum balance applies and only the attested owner can submit it. |
| `test_adminOnlyNamespaceOwner` | Only the namespace owner can pause, and a paused world rejects births. |

**Protocol (`protocol/`, `forge test`): 4 tests pass.**

| Test | What it proves |
|---|---|
| `test_versionIsCandidateAndSafeCanSetOfficial` | Every registered version starts as `Candidate`; only the governor (the Safe) can make it official. |
| `test_genesisCharterFlowWithDelayAndVeto` | Genesis Charter: the relayer can queue the tally only after the vote closes and only for the proposal's version; execution waits for the 24 h delay and anyone can trigger it. A later season proposal vetoed by the guardian cannot be executed, and the official version stays. |
| `test_forkByCommunityAndClients` | A community member anchors her soul and an org, registers ALDEA Nocturna as a fork of ALDEA World with its own version and an https-only client, and cannot register versions in ALDEA's world. An account without a human soul cannot self-anchor an org. |
| `test_almaIdValidationAndRevocation` | Malformed identifiers and the wrong subject type are rejected (`alma:main:human:<local-id>`, lowercase `[a-z0-9-]`), one account anchors at most one human soul, and revoking a soul removes its controller. |

**Gas (`contracts/test/Gas.t.sol`, execution gas, first and second character):**

| Operation | First character | Later characters |
|---|---|---|
| `anchorHuman` | 102,392 | 102,392 |
| `requestBirth` | 244,462 | 198,062 |
| `completeBirth` | 189,894 | 119,462 |
| `enterBuilding` | 109,663 | 91,163 |

## How to run

Requirements: Node 22, pnpm (or npm) and Foundry (`forge` and `anvil` on the PATH).

```bash
# 1. Protocol contracts (pure Foundry)
cd reference/protocol
forge install foundry-rs/forge-std@ba4733c33497dd0c0983dcc033d7645576cc46e5 --no-git   # forge-std 1.16.2
forge test -vv

# 2. MUD World
cd ../contracts
pnpm install
cp .env.example .env        # paste anvil's default account (0) private key
pnpm mud build              # tablegen + worldgen + forge build
pnpm mud test               # starts anvil, deploys the World and runs forge test against it
pnpm mud test --forgeOptions='-vv --match-test test_gas'   # prints the gas table above
```

The World tests deploy the real `AlmaAnchorRegistry` from `../protocol/src` through the `@aldea/protocol/` remapping, so keep both folders side by side, as `packages/contracts` and `packages/protocol` are in the monorepo.

## Conventions these files already follow

These are the traps we hit while verifying; the PRD's integration patterns require them too.

- **Custom errors carry the system name as a prefix** (`CharacterSystem_WorldPaused`, `MovementSystem_NotBorn`, …). MUD's worldgen copies every system error into `IWorld`, so two systems declaring `WorldPaused` would not compile.
- **Shared structs live in `src/types/`**, outside `src/systems/`, so worldgen can import them into `IWorld`.
- **`_msgSender()` everywhere, never `msg.sender`**, inside systems. This fixes woldr's critical bug, where `Character.owner` stored the World's address.
- **Systems are stateless.** All state lives in MUD tables; woldr kept storage variables in a system.
- **A recent forge-std is required.** woldr's pinned forge-std predates `vm.setBlockhash`, which the birth tests need.
- **`AdminSystem` is registered with `openAccess: false`**, so only the namespace owner (the Safe, after `PostDeploy`) can call it.
