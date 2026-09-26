// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { AlmaAnchorRegistry } from "../src/AlmaAnchorRegistry.sol";
import { AtlasRegistry, IAlmaAnchors } from "../src/AtlasRegistry.sol";
import { AldeaCouncilExecutor, IAtlasGovernable } from "../src/AldeaCouncilExecutor.sol";

/// @notice Deploys the protocol contracts, anchors the world's ALMA organizations and hands every role to the Safe.
/// @dev Environment:
///      - PRIVATE_KEY (required): deployer only, never the Safe's key.
///      - ALDEA_SAFE_ADDRESS (default: deployer): controller of the orgs, issuer, admin, curator and guardian.
///      - RELAYER_ADDRESS (default: deployer): the only account allowed to queue Council results.
///      - COUNCIL_DELAY (default: 86400): 86,400 s in production, 600 s in staging.
///      - ORG_DOCS_CREATED_AT (default: 2026-09-27T00:00:00Z): createdAt of the org ALMA documents.
///      - DEPLOYMENTS_DIR (default: packages/shared/src/deployments): where <chainId>.json is written.
contract Deploy is Script {
  string internal constant ALMA_CONTEXT = "https://alma.adasouls.io/ns/v1";

  struct Deployment {
    address deployer;
    address safe;
    address relayer;
    uint64 councilDelay;
    string orgDocsCreatedAt;
    AlmaAnchorRegistry alma;
    AtlasRegistry atlas;
    AldeaCouncilExecutor council;
    uint256 deployBlock;
  }

  function orgIds() public pure returns (string[6] memory) {
    return [
      "alma:main:org:tribu-amazonicos",
      "alma:main:org:tribu-himalayos",
      "alma:main:org:tribu-poseidones",
      "alma:main:org:tribu-raes",
      "alma:main:org:tribu-tropicales",
      "alma:main:org:aldea-world"
    ];
  }

  function run() external returns (Deployment memory d) {
    uint256 pk = vm.envUint("PRIVATE_KEY");
    d.deployer = vm.addr(pk);
    d.safe = vm.envOr("ALDEA_SAFE_ADDRESS", d.deployer);
    d.relayer = vm.envOr("RELAYER_ADDRESS", d.deployer);
    d.councilDelay = uint64(vm.envOr("COUNCIL_DELAY", uint256(86_400)));
    d.orgDocsCreatedAt = vm.envOr("ORG_DOCS_CREATED_AT", string("2026-09-27T00:00:00Z"));
    d.deployBlock = block.number;

    string[6] memory ids = orgIds();

    vm.startBroadcast(pk);
    // 1–2. ALMA registry, with the deployer as a temporary issuer
    d.alma = new AlmaAnchorRegistry(d.deployer);
    d.alma.setIssuer(d.deployer, true);
    // 3. The 5 tribes and aldea-world, controlled by the Safe
    for (uint256 i = 0; i < ids.length; i++) {
      d.alma.anchorOrgFor(ids[i], d.safe, orgDocHash(ids[i], d.safe, d.orgDocsCreatedAt));
    }
    // 4. Atlas (curator = Safe)
    d.atlas = new AtlasRegistry(IAlmaAnchors(address(d.alma)), d.deployer, d.safe);
    // 5. Council executor (guardian = Safe)
    d.council = new AldeaCouncilExecutor(IAtlasGovernable(address(d.atlas)), d.relayer, d.safe, d.councilDelay);
    // 6. Hand the roles to the Safe
    d.alma.setIssuer(d.deployer, false);
    d.alma.setIssuer(d.safe, true);
    d.alma.transferAdmin(d.safe);
    d.atlas.transferAdmin(d.safe);
    vm.stopBroadcast();

    _writeDeployment(d, ids);
  }

  /// JCS (RFC 8785) serialization of the org's AlmaCoreDoc. Keys are already in canonical order and the values
  /// contain no characters that need escaping, so this string is byte-identical to `canonicalize(doc)` in
  /// packages/shared/src/alma.ts (cross-checked by a Vitest test).
  function orgDocJcs(string memory almaId, address controller, string memory createdAt) public view returns (string memory) {
    return string.concat(
      '{"@context":"',
      ALMA_CONTEXT,
      '","controllers":[{"id":"did:pkh:eip155:',
      vm.toString(block.chainid),
      ":",
      vm.toString(controller),
      '","kind":"evm","primary":true}],"createdAt":"',
      createdAt,
      '","id":"',
      almaId,
      '","type":"org"}'
    );
  }

  function orgDocHash(string memory almaId, address controller, string memory createdAt) public view returns (bytes32) {
    return keccak256(bytes(orgDocJcs(almaId, controller, createdAt)));
  }

  function _writeDeployment(Deployment memory d, string[6] memory ids) internal {
    string memory orgs = "orgs";
    string memory orgsJson;
    for (uint256 i = 0; i < ids.length; i++) {
      string memory key = ids[i];
      string memory entry = vm.serializeBytes32(key, "almaIdHash", keccak256(bytes(ids[i])));
      entry = vm.serializeBytes32(key, "docHash", orgDocHash(ids[i], d.safe, d.orgDocsCreatedAt));
      orgsJson = vm.serializeString(orgs, ids[i], entry);
    }

    string memory protocol = "protocol";
    vm.serializeAddress(protocol, "almaAnchorRegistry", address(d.alma));
    vm.serializeAddress(protocol, "atlasRegistry", address(d.atlas));
    vm.serializeAddress(protocol, "aldeaCouncilExecutor", address(d.council));
    // Head before the first broadcast: a safe lower bound for indexers that sync from the deploy block.
    string memory protocolJson = vm.serializeUint(protocol, "deployBlock", d.deployBlock);

    string memory root = "root";
    vm.serializeUint(root, "chainId", block.chainid);
    vm.serializeAddress(root, "safe", d.safe);
    vm.serializeAddress(root, "relayer", d.relayer);
    vm.serializeUint(root, "councilDelay", d.councilDelay);
    vm.serializeString(root, "orgDocsCreatedAt", d.orgDocsCreatedAt);
    vm.serializeString(root, "orgs", orgsJson);
    string memory json = vm.serializeString(root, "protocol", protocolJson);

    string memory dir = vm.envOr("DEPLOYMENTS_DIR", string.concat(vm.projectRoot(), "/../shared/src/deployments"));
    string memory path = string.concat(dir, "/", vm.toString(block.chainid), ".json");
    vm.writeJson(json, path);
    console2.log("Deployment written to", path);
  }
}
