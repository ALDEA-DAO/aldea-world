// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import "forge-std/Test.sol";
import { MudTest } from "@latticexyz/world/test/MudTest.t.sol";
import { StoreSwitch } from "@latticexyz/store/src/StoreSwitch.sol";
import { WorldResourceIdLib } from "@latticexyz/world/src/WorldResourceId.sol";
import { ROOT_NAMESPACE_ID } from "@latticexyz/world/src/constants.sol";
import { NamespaceOwner } from "@latticexyz/world/src/codegen/tables/NamespaceOwner.sol";
import { IWorld } from "../src/codegen/world/IWorld.sol";
import { Config, ConfigData, TribeInfo, Building, BuildingData } from "../src/codegen/index.sol";
import { BuildingKind, Tribe } from "../src/codegen/common.sol";
import { AlmaAnchorRegistry } from "@aldea/protocol/AlmaAnchorRegistry.sol";
import { PostDeploy } from "../script/PostDeploy.s.sol";

contract PostDeployTest is MudTest {
  address constant SAFE = address(0x5AFE);
  address constant ATTESTOR = address(0xA77E);

  function test_seedsTablesAndTransfersOwnershipToTheSafe() public {
    StoreSwitch.setStoreAddress(worldAddress);
    address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
    AlmaAnchorRegistry alma = new AlmaAnchorRegistry(deployer);

    vm.setEnv("ALMA_REGISTRY_ADDRESS", vm.toString(address(alma)));
    vm.setEnv("FOUNDER_ATTESTOR_ADDRESS", vm.toString(ATTESTOR));
    vm.setEnv("GENESIS_ENDS_AT", "1790000000");
    vm.setEnv("ALDEA_SAFE_ADDRESS", vm.toString(SAFE));
    PostDeploy script = new PostDeploy();
    script.run(worldAddress);

    ConfigData memory cfg = Config.get();
    assertEq(cfg.almaRegistry, address(alma));
    assertEq(cfg.founderAttestor, ATTESTOR);
    assertEq(cfg.minFounderBalance, 1_000 * 1e6);
    assertEq(cfg.genesisEndsAt, 1790000000);
    assertEq(cfg.birthDelayBlocks, 3);
    assertFalse(cfg.paused);

    assertEq(TribeInfo.getAlmaOrgIdHash(Tribe.Amazonians), keccak256("alma:main:org:tribu-amazonicos"));
    assertEq(TribeInfo.getName(Tribe.Amazonians), unicode"Amazónicos");
    assertEq(TribeInfo.getAlmaOrgIdHash(Tribe.Tropicals), keccak256("alma:main:org:tribu-tropicales"));
    assertEq(TribeInfo.getName(Tribe.Poseidons), "Poseidones");

    BuildingData memory town = Building.get(keccak256("aldea.building.town-center"));
    assertEq(uint8(town.kind), uint8(BuildingKind.TownCenter));
    assertEq(town.x, 20);
    assertEq(town.y, 20);
    assertTrue(town.isOpen);
    assertFalse(town.underConstruction);
    assertEq(town.name, "Centro Urbano");
    BuildingData memory forge = Building.get(keccak256("aldea.building.npc-forge"));
    assertEq(uint8(forge.kind), uint8(BuildingKind.NpcForge));
    assertEq(forge.x, 28);
    assertEq(forge.y, 26);
    assertTrue(forge.underConstruction);
    assertEq(Building.getName(keccak256("aldea.building.portal")), "Portal de los Mundos");

    assertEq(NamespaceOwner.get(WorldResourceIdLib.encodeNamespace("aldea")), SAFE);
    assertEq(NamespaceOwner.get(ROOT_NAMESPACE_ID), SAFE);

    // The deployer lost admin access; the Safe has it
    vm.prank(deployer);
    vm.expectRevert();
    IWorld(worldAddress).aldea__setPaused(true);
    vm.prank(SAFE);
    IWorld(worldAddress).aldea__setPaused(true);
    assertTrue(Config.getPaused());

    vm.setEnv("ALDEA_SAFE_ADDRESS", "");
  }
}
