import { Type } from "@sinclair/typebox";
import type { GrammarDefinition } from "@effectstream/node-sdk/concise";

/**
 * Inputs of the state machine. Every EVM event payload carries the decoded event arguments (bigints as decimal
 * strings) plus `txHash`, `logIndex` and `blockNumber` appended by AldeaEvmEventPrimitive.
 */
const logCoordinates = [
  ["txHash", Type.String()],
  ["logIndex", Type.Number()],
  ["blockNumber", Type.Number()],
] as const;

export const birthRequestedGrammar = [
  ["characterId", Type.Number()],
  ["owner", Type.String()],
  ["almaIdHash", Type.String()],
  ["characterClass", Type.Number()],
  ["targetBlock", Type.String()],
  ...logCoordinates,
] as const;

/** BirthRescheduled(uint32 indexed characterId, uint64 newTargetBlock) */
export const birthRescheduledGrammar = [["characterId", Type.Number()], ["newTargetBlock", Type.String()], ...logCoordinates] as const;

/** CharacterBorn(uint32 indexed characterId, bytes32 indexed almaIdHash, CharacterClass characterClass, Tribe tribe) */
export const birthCompletedGrammar = [
  ["characterId", Type.Number()],
  ["almaIdHash", Type.String()],
  ["characterClass", Type.Number()],
  ["tribe", Type.Number()],
  ...logCoordinates,
] as const;

/** SubjectAnchored(bytes32 indexed almaIdHash, string almaId, SubjectType subjectType, address indexed controller, bytes32 ownerIdHash, bytes32 docHash) */
export const soulAnchoredGrammar = [
  ["almaIdHash", Type.String()],
  ["almaId", Type.String()],
  ["subjectType", Type.Number()],
  ["controller", Type.String()],
  ["ownerIdHash", Type.String()],
  ["docHash", Type.String()],
  ...logCoordinates,
] as const;

/** BuildingEntered(uint32 indexed characterId, bytes32 indexed buildingId, bytes32 indexed almaIdHash) */
export const buildingEnteredGrammar = [["characterId", Type.Number()], ["buildingId", Type.String()], ["almaIdHash", Type.String()], ...logCoordinates] as const;

/** BuildingLeft(uint32 indexed characterId, bytes32 indexed buildingId) */
export const buildingLeftGrammar = [["characterId", Type.Number()], ["buildingId", Type.String()], ...logCoordinates] as const;

/** WorldRegistered(bytes32 indexed worldId, bytes32 indexed almaOrgIdHash, bytes32 indexed parentWorldId, address governor, Visibility visibility, string name, string metadataURI) */
export const atlasWorldRegisteredGrammar = [
  ["worldId", Type.String()],
  ["almaOrgIdHash", Type.String()],
  ["parentWorldId", Type.String()],
  ["governor", Type.String()],
  ["visibility", Type.Number()],
  ["name", Type.String()],
  ["metadataURI", Type.String()],
  ...logCoordinates,
] as const;

/** VersionRegistered(bytes32 indexed versionId, bytes32 indexed worldId, bytes32 indexed parentVersionId, VersionInput version, address registeredBy) */
export const atlasVersionRegisteredGrammar = [
  ["versionId", Type.String()],
  ["worldId", Type.String()],
  ["parentVersionId", Type.String()],
  [
    "version",
    Type.Object({
      parentVersionId: Type.String(),
      chainId: Type.String(),
      worldAddress: Type.String(),
      gitCommit: Type.String(),
      engine: Type.String(),
      semver: Type.String(),
      clientCid: Type.String(),
    }),
  ],
  ["registeredBy", Type.String()],
  ...logCoordinates,
] as const;

/** ClientRegistered(bytes32 indexed clientId, bytes32 indexed versionId, bytes32 indexed operatorAlmaIdHash, ClientKind kind, string url) */
export const atlasClientRegisteredGrammar = [
  ["clientId", Type.String()],
  ["versionId", Type.String()],
  ["operatorAlmaIdHash", Type.String()],
  ["kind", Type.Number()],
  ["url", Type.String()],
  ...logCoordinates,
] as const;

/** ClientDeactivated(bytes32 indexed clientId) */
export const atlasClientDeactivatedGrammar = [["clientId", Type.String()], ...logCoordinates] as const;

/** OfficialVersionSet(bytes32 indexed worldId, bytes32 indexed versionId, bytes32 previousVersionId, address by) */
export const atlasOfficialVersionSetGrammar = [
  ["worldId", Type.String()],
  ["versionId", Type.String()],
  ["previousVersionId", Type.String()],
  ["by", Type.String()],
  ...logCoordinates,
] as const;

/** VersionWithdrawn(bytes32 indexed versionId) */
export const atlasVersionWithdrawnGrammar = [["versionId", Type.String()], ...logCoordinates] as const;

/** GovernorChanged(bytes32 indexed worldId, address previousGovernor, address newGovernor) */
export const atlasGovernorChangedGrammar = [["worldId", Type.String()], ["previousGovernor", Type.String()], ["newGovernor", Type.String()], ...logCoordinates] as const;

/** VisibilityChanged(bytes32 indexed worldId, Visibility visibility) */
export const atlasVisibilityChangedGrammar = [["worldId", Type.String()], ["visibility", Type.Number()], ...logCoordinates] as const;

/** MetadataChanged(bytes32 indexed worldId, string metadataURI) */
export const atlasMetadataChangedGrammar = [["worldId", Type.String()], ["metadataURI", Type.String()], ...logCoordinates] as const;

/** VerifiedChanged(bytes32 indexed worldId, bool verified) */
export const atlasVerifiedChangedGrammar = [["worldId", Type.String()], ["verified", Type.Boolean()], ...logCoordinates] as const;

/** FounderClaimed(bytes32 indexed almaIdHash, bytes28 indexed cardanoStakeCredential, uint128 aldeaBalance, uint64 snapshotSlot) */
export const founderClaimedGrammar = [
  ["almaIdHash", Type.String()],
  ["cardanoStakeCredential", Type.String()],
  ["aldeaBalance", Type.String()],
  ["snapshotSlot", Type.String()],
  ...logCoordinates,
] as const;

/**
 * A UTxO of the $ALDEA asset created or spent on Cardano, as Effectstream's delayed-asset primitive reports it:
 * `amount` is the quantity for a new output and "" for a spent one (`txId`/`outputIndex` then name the spent output).
 */
export const aldeaUtxoGrammar = [
  ["address", Type.String()],
  ["txId", Type.String()],
  ["outputIndex", Type.String()],
  ["cip14Fingerprint", Type.String()],
  ["amount", Type.String()],
  ["policyId", Type.String()],
  ["assetName", Type.String()],
] as const;

/** ProposalOpened(bytes32 indexed proposalId, ProposalKind kind, bytes32 indexed worldId, bytes32 indexed versionId, uint64 snapshotAt, uint64 startsAt, uint64 endsAt, string paramsURI) */
export const councilOpenedGrammar = [
  ["proposalId", Type.String()],
  ["kind", Type.Number()],
  ["worldId", Type.String()],
  ["versionId", Type.String()],
  ["snapshotAt", Type.String()],
  ["startsAt", Type.String()],
  ["endsAt", Type.String()],
  ["paramsURI", Type.String()],
  ...logCoordinates,
] as const;

/** ProposalQueued(bytes32 indexed proposalId, bytes32 indexed versionId, bytes32 tallyHash, string tallyURI, uint64 eta) */
export const councilQueuedGrammar = [
  ["proposalId", Type.String()],
  ["versionId", Type.String()],
  ["tallyHash", Type.String()],
  ["tallyURI", Type.String()],
  ["eta", Type.String()],
  ...logCoordinates,
] as const;

/** ProposalVetoed(bytes32 indexed proposalId, address indexed by, string reason) */
export const councilVetoedGrammar = [["proposalId", Type.String()], ["by", Type.String()], ["reason", Type.String()], ...logCoordinates] as const;

/** ProposalExecuted(bytes32 indexed proposalId, bytes32 indexed worldId, bytes32 indexed versionId) */
export const councilExecutedGrammar = [["proposalId", Type.String()], ["worldId", Type.String()], ["versionId", Type.String()], ...logCoordinates] as const;

/**
 * Inputs published in CouncilInputs, as JSON arrays (`["cv","0x…","s"]`).
 *
 * - `cv`: a Founder's vote on a proposal, `s` to sign and `o` to object, signed with their Cardano wallet (CIP-8).
 * - `cp`: a proposal's rules (the JSON at its paramsURI, which the state machine cannot fetch), posted by the guardian.
 */
export const voteGrammar = [
  ["proposalId", Type.String()],
  ["choice", Type.Union([Type.Literal("s"), Type.Literal("o")])],
] as const;
export const councilParamsGrammar = [
  ["proposalId", Type.String()],
  ["params", Type.String()],
] as const;

/** The Council's clock: inputs the state machine schedules for itself at a proposal's snapshot, opening and close. */
export const councilTimerGrammar = [["proposalId", Type.String()]] as const;

export const grammar = {
  birthRequested: birthRequestedGrammar,
  birthRescheduled: birthRescheduledGrammar,
  birthCompleted: birthCompletedGrammar,
  soulAnchored: soulAnchoredGrammar,
  buildingEntered: buildingEnteredGrammar,
  buildingLeft: buildingLeftGrammar,
  atlasWorldRegistered: atlasWorldRegisteredGrammar,
  atlasVersionRegistered: atlasVersionRegisteredGrammar,
  atlasClientRegistered: atlasClientRegisteredGrammar,
  atlasClientDeactivated: atlasClientDeactivatedGrammar,
  atlasOfficialVersionSet: atlasOfficialVersionSetGrammar,
  atlasVersionWithdrawn: atlasVersionWithdrawnGrammar,
  atlasGovernorChanged: atlasGovernorChangedGrammar,
  atlasVisibilityChanged: atlasVisibilityChangedGrammar,
  atlasMetadataChanged: atlasMetadataChangedGrammar,
  atlasVerifiedChanged: atlasVerifiedChangedGrammar,
  aldeaUtxo: aldeaUtxoGrammar,
  founderClaimed: founderClaimedGrammar,
  councilOpened: councilOpenedGrammar,
  councilQueued: councilQueuedGrammar,
  councilVetoed: councilVetoedGrammar,
  councilExecuted: councilExecutedGrammar,
  cv: voteGrammar,
  cp: councilParamsGrammar,
  councilSnapshot: councilTimerGrammar,
  councilOpen: councilTimerGrammar,
  councilClose: councilTimerGrammar,
} as const satisfies GrammarDefinition;
