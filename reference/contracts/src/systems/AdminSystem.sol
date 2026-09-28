// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { Config, Building, TribeInfo } from "../codegen/index.sol";
import { BuildingKind, Tribe } from "../codegen/common.sol";

contract AdminSystem is System {
  error AdminSystem_InvalidConfig();

  function setConfig(
    address almaRegistry,
    address founderAttestor,
    uint128 minFounderBalance,
    uint64 genesisEndsAt,
    uint16 birthDelayBlocks
  ) public {
    if (almaRegistry == address(0) || founderAttestor == address(0)) revert AdminSystem_InvalidConfig();
    if (birthDelayBlocks == 0 || birthDelayBlocks > 64) revert AdminSystem_InvalidConfig();
    Config.setAlmaRegistry(almaRegistry);
    Config.setFounderAttestor(founderAttestor);
    Config.setMinFounderBalance(minFounderBalance);
    Config.setGenesisEndsAt(genesisEndsAt);
    Config.setBirthDelayBlocks(birthDelayBlocks);
  }

  function setPaused(bool paused) public {
    Config.setPaused(paused);
  }

  function setBuilding(
    bytes32 id,
    BuildingKind kind,
    int32 x,
    int32 y,
    bool isOpen,
    bool underConstruction,
    string calldata name
  ) public {
    Building.set(id, kind, x, y, isOpen, underConstruction, name);
  }

  function setTribeInfo(Tribe tribe, bytes32 almaOrgIdHash, string calldata name) public {
    TribeInfo.set(tribe, almaOrgIdHash, name);
  }
}
