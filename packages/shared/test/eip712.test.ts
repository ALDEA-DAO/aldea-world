import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { founderAttestationTypes, FOUNDER_ATTESTATION_DOMAIN_NAME, FOUNDER_ATTESTATION_DOMAIN_VERSION } from "../src/eip712";

const founderSystem = readFileSync(join(__dirname, "../../contracts/src/systems/FounderSystem.sol"), "utf8");

describe("FounderAttestation EIP-712", () => {
  it("encodes the same type string as FounderSystem.FOUNDER_TYPEHASH", () => {
    const fields = founderAttestationTypes.FounderAttestation.map((f) => `${f.type} ${f.name}`).join(",");
    expect(founderSystem).toContain(`"FounderAttestation(${fields})"`);
  });

  it("uses the same domain name and version", () => {
    expect(founderSystem).toContain(`NAME_HASH = keccak256("${FOUNDER_ATTESTATION_DOMAIN_NAME}")`);
    expect(founderSystem).toContain(`VERSION_HASH = keccak256("${FOUNDER_ATTESTATION_DOMAIN_VERSION}")`);
  });
});
