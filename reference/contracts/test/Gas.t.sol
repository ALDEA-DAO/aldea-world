// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;
import "forge-std/Test.sol";
import { MudTest } from "@latticexyz/world/test/MudTest.t.sol";
import { StoreSwitch } from "@latticexyz/store/src/StoreSwitch.sol";
import { IWorld } from "../src/codegen/world/IWorld.sol";
import { Character } from "../src/codegen/index.sol";
import { CharacterClass, BuildingKind } from "../src/codegen/common.sol";
import { AlmaAnchorRegistry } from "@aldea/protocol/AlmaAnchorRegistry.sol";

contract GasTest is MudTest {
  function test_gas() public {
    IWorld world = IWorld(worldAddress);
    StoreSwitch.setStoreAddress(worldAddress);
    address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
    AlmaAnchorRegistry alma = new AlmaAnchorRegistry(deployer);
    bytes32 town = keccak256("aldea.building.town-center");
    vm.startPrank(deployer);
    world.aldea__setConfig(address(alma), address(0xBEEF), 1e9, 0, 3);
    world.aldea__setBuilding(town, BuildingKind.TownCenter, 20, 20, true, false, "Centro Urbano");
    vm.stopPrank();
    // warm-up: first character ever (initializes census slots)
    for (uint i = 0; i < 2; i++) {
      address p = address(uint160(0x1000 + i));
      vm.startPrank(p);
      uint256 g0 = gasleft();
      bytes32 soul = alma.anchorHuman(string(abi.encodePacked("alma:main:human:", vm.toString(i))), keccak256("d"));
      uint256 g1 = gasleft();
      uint32 id = world.aldea__requestBirth(CharacterClass.Merchant, soul);
      uint256 g2 = gasleft();
      vm.stopPrank();
      uint64 t = Character.getTargetBlock(id);
      vm.roll(t + 1); vm.setBlockhash(t, keccak256(abi.encode(i)));
      uint256 g3 = gasleft();
      world.aldea__completeBirth(id);
      uint256 g4 = gasleft();
      vm.prank(p);
      world.aldea__enterBuilding(town);
      uint256 g5 = gasleft();
      console.log("run", i);
      console.log(" anchorHuman   ", g0 - g1);
      console.log(" requestBirth  ", g1 - g2);
      console.log(" completeBirth ", g3 - g4);
      console.log(" enterBuilding ", g4 - g5);
    }
  }
}
