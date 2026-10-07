// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import { Deploy } from "../script/Deploy.s.sol";
import { AlmaAnchorRegistry } from "@adasouls/protocol/AlmaAnchorRegistry.sol";

contract DeployTest is Test {
  uint256 constant DEPLOYER_PK = 0xD3B10E;
  address constant SAFE = address(0x5AFE);
  address constant RELAYER = address(0x7E1A);

  function test_deployAnchorsOrgsAndHandsRolesToTheSafe() public {
    vm.setEnv("PRIVATE_KEY", vm.toString(DEPLOYER_PK));
    vm.setEnv("ALDEA_SAFE_ADDRESS", vm.toString(SAFE));
    vm.setEnv("RELAYER_ADDRESS", vm.toString(RELAYER));
    vm.setEnv("COUNCIL_DELAY", "600");
    vm.setEnv("DEPLOYMENTS_DIR", string.concat(vm.projectRoot(), "/cache"));
    address deployer = vm.addr(DEPLOYER_PK);

    Deploy script = new Deploy();
    Deploy.Deployment memory d = script.run();

    // Roles: the deployer keeps nothing
    assertEq(d.alma.admin(), SAFE);
    assertTrue(d.alma.issuers(SAFE));
    assertFalse(d.alma.issuers(deployer));
    assertEq(d.atlas.admin(), SAFE);
    assertEq(d.atlas.curator(), SAFE);
    assertEq(d.council.guardian(), SAFE);
    assertEq(d.council.relayer(), RELAYER);
    assertEq(d.council.delay(), 600);

    // The 5 tribes and aldea-world are orgs controlled by the Safe, with the JCS doc hash
    string[6] memory ids = script.orgIds();
    for (uint256 i = 0; i < ids.length; i++) {
      bytes32 h = keccak256(bytes(ids[i]));
      AlmaAnchorRegistry.Anchor memory a = d.alma.getAnchor(h);
      assertEq(uint8(a.subjectType), uint8(AlmaAnchorRegistry.SubjectType.Org), ids[i]);
      assertEq(a.controller, SAFE, ids[i]);
      assertEq(a.docHash, script.orgDocHash(ids[i], SAFE, "2026-09-27T00:00:00Z"), ids[i]);
    }

    // The deployment file is written and parseable
    string memory json = vm.readFile(string.concat(vm.projectRoot(), "/cache/", vm.toString(block.chainid), ".json"));
    assertEq(vm.parseJsonAddress(json, ".protocol.almaAnchorRegistry"), address(d.alma));
    assertEq(vm.parseJsonAddress(json, ".protocol.councilInputs"), address(d.councilInputs));
    assertEq(vm.parseJsonAddress(json, ".safe"), SAFE);
  }

  function test_orgDocJcsIsCanonical() public {
    Deploy script = new Deploy();
    vm.chainId(84532);
    assertEq(
      script.orgDocJcs("alma:main:org:tribu-raes", address(0x5AFE), "2026-09-27T00:00:00Z"),
      '{"@context":"https://alma.adasouls.io/ns/v1","controllers":[{"id":"did:pkh:eip155:84532:0x0000000000000000000000000000000000005aFE","kind":"evm","primary":true}],"createdAt":"2026-09-27T00:00:00Z","id":"alma:main:org:tribu-raes","type":"org"}'
    );
  }
}
