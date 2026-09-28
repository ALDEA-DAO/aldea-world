// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import "forge-std/Test.sol";
import { MudTest } from "@latticexyz/world/test/MudTest.t.sol";
import { StoreSwitch } from "@latticexyz/store/src/StoreSwitch.sol";
import { IWorld } from "../src/codegen/world/IWorld.sol";
import { Census, Character, CharacterData, CharacterOf, SoulCharacter } from "../src/codegen/index.sol";
import { CharacterClass, BirthStatus } from "../src/codegen/common.sol";
import { AlmaAnchorRegistry } from "@aldea/protocol/AlmaAnchorRegistry.sol";

/// Drives random births, completions and block advances against the World.
contract BirthHandler is Test {
  IWorld public immutable world;
  AlmaAnchorRegistry public immutable alma;

  uint256 public constant ACTORS = 12;
  address[] public actors;
  bytes32[] public souls;

  uint256 public requested;
  uint256 public completed;
  uint256 public rescheduled;

  constructor(IWorld world_, AlmaAnchorRegistry alma_) {
    world = world_;
    alma = alma_;
    StoreSwitch.setStoreAddress(address(world_));
    for (uint256 i = 0; i < ACTORS; i++) {
      address actor = address(uint160(0xA000 + i));
      actors.push(actor);
      vm.prank(actor);
      souls.push(alma.anchorHuman(string.concat("alma:main:human:", vm.toString(i + 1)), keccak256("doc")));
    }
  }

  /// Actors are mostly born with their own soul, but also try souls they do not control.
  function requestBirth(uint256 actorSeed, uint256 soulSeed, uint8 classSeed, bool useOwnSoul) external {
    uint256 actorIndex = actorSeed % ACTORS;
    address actor = actors[actorIndex];
    bytes32 soul = useOwnSoul ? souls[actorIndex] : souls[soulSeed % ACTORS];
    CharacterClass c = CharacterClass(classSeed % 11);
    vm.prank(actor);
    try world.aldea__requestBirth(c, soul) returns (uint32) {
      requested++;
    } catch {}
  }

  /// Anyone (the Midwife, the player or a stranger) completes a pending birth.
  function completeBirth(uint256 idSeed, bytes32 blockHashSeed, bool letItExpire) external {
    uint32 last = Census.getLastCharacterId();
    if (last == 0) return;
    uint32 id = uint32(bound(idSeed, 1, last));
    CharacterData memory c = Character.get(id);
    if (c.status != BirthStatus.Gestating) return;

    if (letItExpire) {
      // More than 256 blocks later blockhash(targetBlock) is zero and the birth must be rescheduled.
      uint256 expiredAt = uint256(c.targetBlock) + 300;
      if (block.number < expiredAt) vm.roll(expiredAt);
    } else {
      if (block.number <= c.targetBlock) vm.roll(uint256(c.targetBlock) + 1);
      vm.setBlockhash(c.targetBlock, keccak256(abi.encode(blockHashSeed, id)));
    }
    world.aldea__completeBirth(id);
    if (Character.getStatus(id) == BirthStatus.Born) completed++;
    else rescheduled++;
  }

  function advanceBlocks(uint16 n) external {
    vm.roll(block.number + bound(n, 1, 20));
  }
}

contract InvariantsTest is MudTest {
  IWorld world;
  AlmaAnchorRegistry alma;
  BirthHandler handler;

  function setUp() public override {
    super.setUp();
    world = IWorld(worldAddress);
    StoreSwitch.setStoreAddress(worldAddress);
    address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
    alma = new AlmaAnchorRegistry(deployer);
    vm.prank(deployer);
    world.aldea__setConfig(address(alma), address(0xBEEF), 1_000 * 1e6, 0, 3);

    handler = new BirthHandler(world, alma);
    targetContract(address(handler));
    bytes4[] memory selectors = new bytes4[](3);
    selectors[0] = BirthHandler.requestBirth.selector;
    selectors[1] = BirthHandler.completeBirth.selector;
    selectors[2] = BirthHandler.advanceBlocks.selector;
    targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
  }

  function invariant_populationIsConserved() public view {
    uint32 total = Census.getTotalPopulation();
    uint32[5] memory byTribe = Census.getTribePopulation();
    uint32[11] memory byClass = Census.getClassPopulation();
    uint256 tribeSum;
    uint256 classSum;
    for (uint256 i = 0; i < 5; i++) tribeSum += byTribe[i];
    for (uint256 i = 0; i < 11; i++) classSum += byClass[i];
    assertEq(tribeSum, total, "sum(tribePopulation) != totalPopulation");
    assertEq(classSum, total, "sum(classPopulation) != totalPopulation");
  }

  function invariant_idsAreBornOrGestating() public view {
    assertEq(
      uint256(Census.getLastCharacterId()),
      uint256(Census.getTotalPopulation()) + Census.getGestating(),
      "lastCharacterId != totalPopulation + gestating"
    );
  }

  /// 1 person = 1 character, per account and per soul, and the on-chain indexes point back to the character.
  function invariant_onePersonOneCharacter() public view {
    uint32 last = Census.getLastCharacterId();
    for (uint32 i = 1; i <= last; i++) {
      CharacterData memory a = Character.get(i);
      assertEq(CharacterOf.get(a.owner), i, "CharacterOf does not point back");
      assertEq(SoulCharacter.get(a.almaIdHash), i, "SoulCharacter does not point back");
      assertTrue(alma.isController(a.almaIdHash, a.owner), "owner does not control the soul");
      for (uint32 j = i + 1; j <= last; j++) {
        CharacterData memory b = Character.get(j);
        assertTrue(a.owner != b.owner, "an owner has two characters");
        assertTrue(a.almaIdHash != b.almaIdHash, "a soul has two characters");
      }
    }
  }

  /// Stateless fuzzing of the two-step birth with any class, block hash and delay.
  function testFuzz_requestAndCompleteBirth(uint8 classSeed, bytes32 blockHash, uint16 extraBlocks) public {
    address player = address(0xF00D);
    vm.prank(player);
    bytes32 soul = alma.anchorHuman("alma:main:human:f00d", keccak256("doc"));
    CharacterClass c = CharacterClass(classSeed % 11);
    vm.prank(player);
    uint32 id = world.aldea__requestBirth(c, soul);
    uint64 target = Character.getTargetBlock(id);

    uint256 completeAt = uint256(target) + 1 + bound(extraBlocks, 0, 255);
    vm.roll(completeAt);
    vm.assume(blockHash != bytes32(0));
    vm.setBlockhash(target, blockHash);
    world.aldea__completeBirth(id);

    CharacterData memory born = Character.get(id);
    assertEq(uint8(born.status), uint8(BirthStatus.Born));
    assertEq(uint8(born.characterClass), uint8(c));
    uint8 expectedTribe = uint8(uint256(keccak256(abi.encode(blockHash, id, soul))) % 5);
    assertEq(uint8(born.tribe), expectedTribe, "tribe does not follow the FR-009 formula");
    assertEq(Census.getClassPopulation()[uint8(c)], 1);
    assertEq(Census.getTribePopulation()[expectedTribe], 1);
  }
}

/// FR-009: the tribe draw `keccak256(abi.encode(blockhash(targetBlock), characterId, almaIdHash)) % 5` is uniform.
contract TribeDrawTest is Test {
  function test_tribeDrawIsUniform() public pure {
    uint256 births = 10_000;
    uint256[5] memory observed;
    for (uint256 i = 0; i < births; i++) {
      bytes32 blockHash = keccak256(abi.encode("block", i));
      uint32 characterId = uint32(i + 1);
      bytes32 almaIdHash = keccak256(abi.encode("alma:main:human:", i));
      observed[uint256(keccak256(abi.encode(blockHash, characterId, almaIdHash))) % 5]++;
    }
    // χ² with 4 degrees of freedom must stay below 13.277 (p > 0.01): Σ(observed − 2,000)² / 2,000 < 13.277
    uint256 expected = births / 5;
    uint256 sumSquares;
    for (uint256 t = 0; t < 5; t++) {
      uint256 d = observed[t] > expected ? observed[t] - expected : expected - observed[t];
      sumSquares += d * d;
    }
    assertLt(sumSquares, 26_554, "tribe draw is not uniform (chi-squared >= 13.277)");
  }
}
