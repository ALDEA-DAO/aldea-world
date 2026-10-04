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
} as const satisfies GrammarDefinition;
