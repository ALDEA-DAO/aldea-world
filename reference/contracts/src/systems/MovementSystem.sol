// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { Config, Character, SoulCharacter, Building, BuildingData, Location } from "../codegen/index.sol";
import { BirthStatus } from "../codegen/common.sol";
import { IAlmaAnchorRegistry } from "../interfaces/IAlmaAnchorRegistry.sol";

contract MovementSystem is System {
  error MovementSystem_WorldPaused();
  error MovementSystem_NoSoul();
  error MovementSystem_NoCharacter();
  error MovementSystem_NotBorn(uint32 characterId);
  error MovementSystem_UnknownBuilding(bytes32 buildingId);
  error MovementSystem_BuildingClosed(bytes32 buildingId);

  event BuildingEntered(uint32 indexed characterId, bytes32 indexed buildingId, bytes32 indexed almaIdHash);
  event BuildingLeft(uint32 indexed characterId, bytes32 indexed buildingId);

  function enterBuilding(bytes32 buildingId) public {
    if (Config.getPaused()) revert MovementSystem_WorldPaused();
    (uint32 characterId, bytes32 soul) = _bornCharacterOfSender();
    BuildingData memory b = Building.get(buildingId);
    if (bytes(b.name).length == 0) revert MovementSystem_UnknownBuilding(buildingId);
    if (!b.isOpen) revert MovementSystem_BuildingClosed(buildingId);
    Location.set(characterId, buildingId, uint64(block.timestamp));
    emit BuildingEntered(characterId, buildingId, soul);
  }

  function leaveBuilding() public {
    (uint32 characterId, ) = _bornCharacterOfSender();
    bytes32 current = Location.getBuildingId(characterId);
    if (current == bytes32(0)) return;
    Location.set(characterId, bytes32(0), uint64(block.timestamp));
    emit BuildingLeft(characterId, current);
  }

  /// The character is resolved through the soul (not the address): if the soul rotates to a new controller, the character follows it.
  function _bornCharacterOfSender() internal view returns (uint32 characterId, bytes32 soul) {
    address sender = _msgSender();
    IAlmaAnchorRegistry alma = IAlmaAnchorRegistry(Config.getAlmaRegistry());
    soul = alma.humanOf(sender);
    if (soul == bytes32(0) || !alma.isController(soul, sender)) revert MovementSystem_NoSoul();
    characterId = SoulCharacter.get(soul);
    if (characterId == 0) revert MovementSystem_NoCharacter();
    if (Character.getStatus(characterId) != BirthStatus.Born) revert MovementSystem_NotBorn(characterId);
  }
}
