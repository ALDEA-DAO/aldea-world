// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { StoreSwitch } from "@latticexyz/store/src/StoreSwitch.sol";
import { ResourceId, WorldResourceIdLib } from "@latticexyz/world/src/WorldResourceId.sol";
import { ROOT_NAMESPACE_ID } from "@latticexyz/world/src/constants.sol";
import { IWorld } from "../src/codegen/world/IWorld.sol";
import { BuildingKind, Tribe } from "../src/codegen/common.sol";

/// @notice Seeds Config, the 5 tribes and the 6 buildings (PRD § 4.1 PostDeploy and § 3.2), then hands the
///         `aldea` and root namespaces to the Safe.
/// @dev `mud deploy` and `mud test` run this script automatically. Environment:
///      - PRIVATE_KEY (required)
///      - ALMA_REGISTRY_ADDRESS: AlmaAnchorRegistry from packages/protocol. When empty, Config is not seeded
///        (this is the case under `mud test`, whose tests configure their own registry).
///      - FOUNDER_ATTESTOR_ADDRESS (default: deployer)
///      - GENESIS_ENDS_AT (default: 0 = no Genesis Week)
///      - ALDEA_SAFE_ADDRESS: new owner of the namespaces. When empty (local development) ownership stays with
///        the deployer.
contract PostDeploy is Script {
  uint128 internal constant MIN_FOUNDER_BALANCE = 1_000 * 1e6; // 1,000 $ALDEA (6 decimals)
  uint16 internal constant BIRTH_DELAY_BLOCKS = 3;

  function run(address worldAddress) external {
    StoreSwitch.setStoreAddress(worldAddress);
    IWorld world = IWorld(worldAddress);

    uint256 pk = vm.envUint("PRIVATE_KEY");
    address deployer = vm.addr(pk);
    address almaRegistry = vm.envOr("ALMA_REGISTRY_ADDRESS", address(0));
    address attestor = vm.envOr("FOUNDER_ATTESTOR_ADDRESS", deployer);
    uint64 genesisEndsAt = uint64(vm.envOr("GENESIS_ENDS_AT", uint256(0)));
    address safe = vm.envOr("ALDEA_SAFE_ADDRESS", address(0));

    vm.startBroadcast(pk);

    if (almaRegistry != address(0)) {
      world.aldea__setConfig(almaRegistry, attestor, MIN_FOUNDER_BALANCE, genesisEndsAt, BIRTH_DELAY_BLOCKS);
    } else {
      console.log("ALMA_REGISTRY_ADDRESS not set: Config left empty (births revert until aldea__setConfig)");
    }

    world.aldea__setTribeInfo(Tribe.Amazonians, keccak256(bytes("alma:main:org:tribu-amazonicos")), unicode"Amazónicos");
    world.aldea__setTribeInfo(Tribe.Himalayans, keccak256(bytes("alma:main:org:tribu-himalayos")), unicode"Himalayos");
    world.aldea__setTribeInfo(Tribe.Poseidons, keccak256(bytes("alma:main:org:tribu-poseidones")), unicode"Poseidones");
    world.aldea__setTribeInfo(Tribe.Raes, keccak256(bytes("alma:main:org:tribu-raes")), unicode"Raes");
    world.aldea__setTribeInfo(Tribe.Tropicals, keccak256(bytes("alma:main:org:tribu-tropicales")), unicode"Tropicales");

    world.aldea__setBuilding(buildingId("town-center"), BuildingKind.TownCenter, 20, 20, true, false, "Centro Urbano");
    world.aldea__setBuilding(buildingId("portal"), BuildingKind.Portal, 27, 15, true, false, "Portal de los Mundos");
    world.aldea__setBuilding(buildingId("soul-registry"), BuildingKind.SoulRegistry, 13, 15, true, false, "Registro de Almas");
    world.aldea__setBuilding(buildingId("council"), BuildingKind.Council, 20, 11, true, false, "Consejo");
    world.aldea__setBuilding(buildingId("velum-archive"), BuildingKind.VelumArchive, 12, 26, true, true, "Archivo Velum");
    world.aldea__setBuilding(buildingId("npc-forge"), BuildingKind.NpcForge, 28, 26, true, true, "Forja de NPCs");

    if (safe != address(0) && safe != deployer) {
      world.transferOwnership(WorldResourceIdLib.encodeNamespace("aldea"), safe);
      world.transferOwnership(ROOT_NAMESPACE_ID, safe);
    } else {
      console.log("ALDEA_SAFE_ADDRESS not set: the deployer keeps the aldea and root namespaces");
    }

    vm.stopBroadcast();
  }

  function buildingId(string memory slug) public pure returns (bytes32) {
    return keccak256(bytes(string.concat("aldea.building.", slug)));
  }
}
