// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { Character, World, WorldData } from "../codegen/index.sol";
import { ResourceId, ResourceIdLib } from "@latticexyz/store/src/ResourceId.sol";
import { RESOURCE_TABLE } from "@latticexyz/store/src/storeResourceTypes.sol";

contract CharacterSystem is System {

  enum Classes {
    Archer,
    Alchemist,
    Artisan,
    Blacksmith,
    Chef,
    Magician,
    Merchant,
    Priest,
    Tailor,
    Rebel,
    Warrior
  }

  enum Tribes {
    Amazonians,
    Himalayans,
    Poseidons,
    Raes,
    Tropicals
  }

  uint classesAmount = uint(type(Classes).max) + 1;
  uint tribesAmount = uint(type(Tribes).max) + 1;

  function random(uint between) private view returns (uint) {
    uint randomHash = uint(keccak256(abi.encodePacked(block.prevrandao, block.timestamp)));
    return randomHash % between;
  } 

  function createCharacter(uint32 class) public returns (uint32) {
    
    // Get actual world status
    WorldData memory world = World.get();

    // Determine new character id based on current world population
    uint32 newCharacterId = world.totalPopulation + 1;
    
    // Pick a random class if selected
    if (class == 0) {
      class = uint32(random(classesAmount));
    }

    // Save new character
    Character.set(newCharacterId, msg.sender, class);
    
    // Update class population
    uint32[11] memory newCharacterPopulation = world.characterPopulation;
    newCharacterPopulation[class] = newCharacterPopulation[class] + 1;
    World.setCharacterPopulation(newCharacterPopulation);

    // Pick random tribe
    uint32 tribe = uint32(random(tribesAmount));

    // Update tribe population
    uint32[5] memory newTribePopulation = world.tribePopulation;
    newTribePopulation[tribe] = newTribePopulation[tribe] + 1;
    World.setTribePopulation(newTribePopulation);

    // Update world population
    World.setTotalPopulation(newCharacterId);
    
    return newCharacterId;

  }

}
