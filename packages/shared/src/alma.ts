import canonicalize from "canonicalize";
import { bytesToHex, getAddress, keccak256, toBytes, type Address, type Hex } from "viem";

/** ALMA document types (PRD § Data Model 3.6). */

export type AlmaSubjectType = "human" | "org" | "agent";

export interface AlmaController {
  id: string; // "did:pkh:eip155:8453:0xAbC…" | "cardano:stake:<hex>" | "lnurl:<hex>"
  kind: "evm" | "cardano" | "lightning";
  primary: boolean;
}

export const ALMA_CONTEXT = "https://alma.adasouls.io/ns/v1";

/** Core that is anchored on-chain: docHash = keccak256(utf8(JCS(core))) */
export interface AlmaCoreDoc {
  "@context": typeof ALMA_CONTEXT;
  id: string; // "alma:main:human:<32 hex>" | "alma:main:org:<slug>"
  type: AlmaSubjectType;
  createdAt: string; // ISO 8601 UTC
  controllers: AlmaController[]; // in the MVP: the primary EVM controller
}

export type RelationshipType =
  | "owns"
  | "represents"
  | "delegates"
  | "operates"
  | "member_of"
  | "hired"
  | "paid"
  | "transacted_with";

export interface Evidence {
  chainId: number;
  txHash: Hex;
  logIndex?: number;
  event?: string;
}

/** Full view returned by the Resolver (not anchored in full) */
export interface AlmaDocument extends AlmaCoreDoc {
  bindings: { type: string; value: string; visibility: "public" | "private"; evidence?: Evidence }[];
  relationships: { type: RelationshipType; to: string; evidence: Evidence }[];
  status: "prepared" | "anchored" | "active" | "revoked";
}

/**
 * Identifier rules, mirroring AlmaAnchorRegistry._requireAlmaId: `alma:main:<type>:` followed by 1–64 characters
 * of `[a-z0-9-]`. Human souls issued by the Resolver use 32 lowercase hex characters (16 random bytes).
 */
export const ALMA_NETWORK = "main";
export const ALMA_ID_RE = /^alma:main:(human|org|agent):[a-z0-9-]{1,64}$/;
export const HUMAN_ALMA_ID_RE = /^alma:main:human:[0-9a-f]{32}$/;

export function isAlmaId(id: string, type?: AlmaSubjectType): boolean {
  const m = ALMA_ID_RE.exec(id);
  return m !== null && (type === undefined || m[1] === type);
}

export function parseAlmaId(id: string): { network: typeof ALMA_NETWORK; type: AlmaSubjectType; localId: string } {
  const m = ALMA_ID_RE.exec(id);
  if (!m) throw new Error(`Invalid ALMA identifier: ${id}`);
  return { network: ALMA_NETWORK, type: m[1] as AlmaSubjectType, localId: id.slice(`alma:main:${m[1]}:`.length) };
}

/** A new human soul identifier: 16 random bytes as 32 lowercase hex characters. */
export function newHumanAlmaId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `alma:main:human:${bytesToHex(bytes).slice(2)}`;
}

/** keccak256(utf8(almaId)), the on-chain key of a soul. */
export function almaIdHash(almaId: string): Hex {
  return keccak256(toBytes(almaId));
}

/** JCS (RFC 8785) serialization of a core document. */
export function canonicalDoc(doc: AlmaCoreDoc): string {
  const json = canonicalize(doc);
  if (json === undefined) throw new Error("Document cannot be canonicalized");
  return json;
}

/** keccak256(utf8(JCS(core))), the docHash anchored on-chain. */
export function docHash(doc: AlmaCoreDoc): Hex {
  return keccak256(toBytes(canonicalDoc(doc)));
}

/** CAIP-10 DID for an EVM controller: did:pkh:eip155:<chainId>:<EIP-55 address>. */
export function evmControllerId(chainId: number, address: Address): string {
  return `did:pkh:eip155:${chainId}:${getAddress(address)}`;
}

export function buildCoreDoc(params: {
  id: string;
  type: AlmaSubjectType;
  createdAt: string;
  chainId: number;
  controller: Address;
}): AlmaCoreDoc {
  return {
    "@context": ALMA_CONTEXT,
    id: params.id,
    type: params.type,
    createdAt: params.createdAt,
    controllers: [{ id: evmControllerId(params.chainId, params.controller), kind: "evm", primary: true }],
  };
}
