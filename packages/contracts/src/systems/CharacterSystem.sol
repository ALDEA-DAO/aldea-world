// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { Config, ConfigData, Census, Character, CharacterData, CharacterOf, SoulCharacter, Founder } from "../codegen/index.sol";
import { CharacterClass, Tribe, BirthStatus } from "../codegen/common.sol";
import { IAlmaAnchorRegistry } from "../interfaces/IAlmaAnchorRegistry.sol";

contract CharacterSystem is System {
  uint8 internal constant SUBJECT_HUMAN = 1;
  uint256 internal constant TRIBE_COUNT = 5;

  error CharacterSystem_WorldPaused();
  error CharacterSystem_AlreadyHasCharacter(uint32 characterId);
  error CharacterSystem_SoulAlreadyHasCharacter(uint32 characterId);
  error CharacterSystem_NotSoulController(bytes32 almaIdHash);
  error CharacterSystem_NotHumanSoul(bytes32 almaIdHash);
  error CharacterSystem_GenesisFoundersOnly();
  error CharacterSystem_NotGestating(uint32 characterId);
  error CharacterSystem_BirthNotReady(uint64 targetBlock);

  event CharacterBirthRequested(
    uint32 indexed characterId,
    address indexed owner,
    bytes32 indexed almaIdHash,
    CharacterClass characterClass,
    uint64 targetBlock
  );
  event BirthRescheduled(uint32 indexed characterId, uint64 newTargetBlock);
  event CharacterBorn(uint32 indexed characterId, bytes32 indexed almaIdHash, CharacterClass characterClass, Tribe tribe);

  /// Requests the birth. The tribe is drawn later, using the hash of a future block.
  function requestBirth(CharacterClass characterClass, bytes32 almaIdHash) public returns (uint32 characterId) {
    ConfigData memory cfg = Config.get();
    if (cfg.paused) revert CharacterSystem_WorldPaused();

    address owner = _msgSender();
    uint32 existing = CharacterOf.get(owner);
    if (existing != 0) revert CharacterSystem_AlreadyHasCharacter(existing);
    uint32 soulExisting = SoulCharacter.get(almaIdHash);
    if (soulExisting != 0) revert CharacterSystem_SoulAlreadyHasCharacter(soulExisting);

    IAlmaAnchorRegistry alma = IAlmaAnchorRegistry(cfg.almaRegistry);
    if (!alma.isController(almaIdHash, owner)) revert CharacterSystem_NotSoulController(almaIdHash);
    if (alma.subjectTypeOf(almaIdHash) != SUBJECT_HUMAN) revert CharacterSystem_NotHumanSoul(almaIdHash);
    if (block.timestamp < cfg.genesisEndsAt && Founder.getClaimedAt(almaIdHash) == 0) revert CharacterSystem_GenesisFoundersOnly();

    characterId = Census.getLastCharacterId() + 1;
    Census.setLastCharacterId(characterId);
    Census.setGestating(Census.getGestating() + 1);

    uint64 targetBlock = uint64(block.number) + cfg.birthDelayBlocks;
    Character.set(
      characterId,
      CharacterData({
        owner: owner,
        almaIdHash: almaIdHash,
        characterClass: characterClass,
        tribe: Tribe.Amazonians, // provisional: not valid until status == Born
        status: BirthStatus.Gestating,
        targetBlock: targetBlock,
        requestedAt: uint64(block.timestamp),
        bornAt: 0
      })
    );
    CharacterOf.set(owner, characterId);
    SoulCharacter.set(almaIdHash, characterId);

    emit CharacterBirthRequested(characterId, owner, almaIdHash, characterClass, targetBlock);
  }

  /// Completes the birth. It is permissionless: the outcome depends only on blockhash(targetBlock).
  function completeBirth(uint32 characterId) public {
    CharacterData memory c = Character.get(characterId);
    if (c.status != BirthStatus.Gestating) revert CharacterSystem_NotGestating(characterId);
    if (block.number <= c.targetBlock) revert CharacterSystem_BirthNotReady(c.targetBlock);

    bytes32 seed = blockhash(c.targetBlock);
    if (seed == bytes32(0)) {
      // More than 256 blocks have passed: it is rescheduled with a new future block.
      uint64 newTarget = uint64(block.number) + Config.getBirthDelayBlocks();
      Character.setTargetBlock(characterId, newTarget);
      emit BirthRescheduled(characterId, newTarget);
      return;
    }

    // By design (FR-009, PRD § Out of Scope "VRF for the draw"): nobody knows blockhash(targetBlock) when the birth is
    // requested, which is enough for a cosmetic assignment. Uniformity is tested in Invariants.t.sol.
    // slither-disable-next-line weak-prng
    Tribe tribe = Tribe(uint8(uint256(keccak256(abi.encode(seed, characterId, c.almaIdHash))) % TRIBE_COUNT));
    Character.setTribe(characterId, tribe);
    Character.setStatus(characterId, BirthStatus.Born);
    Character.setBornAt(characterId, uint64(block.timestamp));

    uint32[11] memory byClass = Census.getClassPopulation();
    byClass[uint8(c.characterClass)] += 1;
    Census.setClassPopulation(byClass);
    uint32[5] memory byTribe = Census.getTribePopulation();
    byTribe[uint8(tribe)] += 1;
    Census.setTribePopulation(byTribe);
    Census.setTotalPopulation(Census.getTotalPopulation() + 1);
    Census.setGestating(Census.getGestating() - 1);

    emit CharacterBorn(characterId, c.almaIdHash, c.characterClass, tribe);
  }
}
