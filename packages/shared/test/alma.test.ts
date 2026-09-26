import { describe, expect, it } from "vitest";
import {
  almaIdHash,
  buildCoreDoc,
  canonicalDoc,
  docHash,
  HUMAN_ALMA_ID_RE,
  isAlmaId,
  newHumanAlmaId,
  parseAlmaId,
} from "../src/alma";

describe("almaIdHash", () => {
  it("matches keccak256(bytes(almaId)) computed by Solidity", () => {
    // Soul used by reference test_fullBirthFlow; value from `cast keccak` / AlmaAnchorRegistry.anchorHuman
    expect(almaIdHash("alma:main:human:5f3c9a1e7b2d4c80a1f6e2b9d4c7a310")).toBe(
      "0xa18dbb7e2302fca4282a78f3ee593d1f679303032fd9cbf26f39f45be875906e",
    );
    // Org anchored by Deploy.s.sol (written to deployments/<chainId>.json by vm.serializeBytes32)
    expect(almaIdHash("alma:main:org:tribu-poseidones")).toBe(
      "0xc5c38ebc31f22ff65fa2a5a01521d4ca333a51d348a07949ef8c19f3814c8167",
    );
  });
});

describe("newHumanAlmaId", () => {
  it("issues 16 random bytes as 32 lowercase hex characters", () => {
    const a = newHumanAlmaId();
    const b = newHumanAlmaId();
    expect(a).toMatch(HUMAN_ALMA_ID_RE);
    expect(a).not.toBe(b);
    expect(isAlmaId(a, "human")).toBe(true);
  });
});

describe("identifier validation", () => {
  it("follows the on-chain rules of AlmaAnchorRegistry", () => {
    expect(isAlmaId("alma:main:org:tribu-raes", "org")).toBe(true);
    expect(isAlmaId("alma:main:org:tribu-raes", "human")).toBe(false);
    expect(isAlmaId("alma:main:human:ABC")).toBe(false); // uppercase is rejected on-chain
    expect(isAlmaId("alma:main:human:")).toBe(false);
    expect(isAlmaId(`alma:main:org:${"a".repeat(65)}`)).toBe(false);
    expect(isAlmaId("alma:test:human:abc")).toBe(false);
    expect(parseAlmaId("alma:main:org:aldea-world")).toEqual({ network: "main", type: "org", localId: "aldea-world" });
  });
});

describe("docHash", () => {
  const orgDoc = buildCoreDoc({
    id: "alma:main:org:tribu-raes",
    type: "org",
    createdAt: "2026-09-27T00:00:00Z",
    chainId: 84532,
    controller: "0x0000000000000000000000000000000000005afe",
  });

  it("canonicalizes with JCS exactly like Deploy.s.sol builds the org document", () => {
    expect(canonicalDoc(orgDoc)).toBe(
      '{"@context":"https://alma.adasouls.io/ns/v1","controllers":[{"id":"did:pkh:eip155:84532:0x0000000000000000000000000000000000005aFE","kind":"evm","primary":true}],"createdAt":"2026-09-27T00:00:00Z","id":"alma:main:org:tribu-raes","type":"org"}',
    );
  });

  it("matches Deploy.orgDocHash computed in Solidity", () => {
    // forge script script/Deploy.s.sol --sig 'orgDocHash(string,address,string)' alma:main:org:tribu-raes 0x…5AFE 2026-09-27T00:00:00Z --chain-id 84532
    expect(docHash(orgDoc)).toBe("0x17185c8522f2fee597ea18671133f018c205a5b9d19566cb0bc950f34e826ce3");
  });

  it("does not depend on key order", () => {
    const reordered = { type: orgDoc.type, id: orgDoc.id, controllers: orgDoc.controllers, createdAt: orgDoc.createdAt, "@context": orgDoc["@context"] };
    expect(docHash(reordered)).toBe(docHash(orgDoc));
  });
});
