// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import "forge-std/Test.sol";
import { MudTest } from "@latticexyz/world/test/MudTest.t.sol";
import { StoreSwitch } from "@latticexyz/store/src/StoreSwitch.sol";
import { IWorld } from "../src/codegen/world/IWorld.sol";
import { Config, Census, Character, CharacterData, CharacterOf, SoulCharacter, Location, Founder } from "../src/codegen/index.sol";
import { CharacterClass, Tribe, BirthStatus, BuildingKind } from "../src/codegen/common.sol";
import { AlmaAnchorRegistry } from "@adasouls/protocol/AlmaAnchorRegistry.sol";
import { FounderAttestation } from "../src/types/FounderAttestation.sol";
import { CharacterSystem } from "../src/systems/CharacterSystem.sol";
import { MovementSystem } from "../src/systems/MovementSystem.sol";
import { FounderSystem } from "../src/systems/FounderSystem.sol";

contract AldeaTest is MudTest {
  IWorld world;
  AlmaAnchorRegistry alma;
  address deployer;
  address alice = address(0xA11CE);
  address bob = address(0xB0B);
  uint256 attestorPk = 0xA77E57;
  address attestor;
  bytes32 constant TOWN = keccak256("aldea.building.town-center");
  bytes32 constant FORGE = keccak256("aldea.building.npc-forge");

  function setUp() public override {
    super.setUp();
    world = IWorld(worldAddress);
    StoreSwitch.setStoreAddress(worldAddress);
    deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
    attestor = vm.addr(attestorPk);
    alma = new AlmaAnchorRegistry(deployer);
    vm.startPrank(deployer);
    world.aldea__setConfig(address(alma), attestor, 1_000 * 1e6, 0, 3);
    world.aldea__setBuilding(TOWN, BuildingKind.TownCenter, 20, 20, true, false, "Centro Urbano");
    world.aldea__setBuilding(FORGE, BuildingKind.NpcForge, 28, 26, false, true, "Forja de NPCs");
    vm.stopPrank();
  }

  function _anchor(address who, string memory id) internal returns (bytes32 h) {
    vm.prank(who);
    h = alma.anchorHuman(id, keccak256("doc"));
  }

  function _birth(address who, bytes32 soul, CharacterClass c) internal returns (uint32 id) {
    vm.prank(who);
    id = world.aldea__requestBirth(c, soul);
  }

  function test_fullBirthFlow() public {
    bytes32 soul = _anchor(alice, "alma:main:human:5f3c9a1e7b2d4c80a1f6e2b9d4c7a310");
    uint32 id = _birth(alice, soul, CharacterClass.Archer); // Archer (0) is a selectable class now (woldr used index 0 as the random sentinel)
    CharacterData memory c = Character.get(id);
    assertEq(uint8(c.status), uint8(BirthStatus.Gestating));
    assertEq(c.owner, alice, "owner must be the player, not the World");
    assertEq(uint8(c.characterClass), uint8(CharacterClass.Archer));
    assertEq(c.targetBlock, block.number + 3);
    assertEq(Census.getGestating(), 1);

    vm.expectRevert(abi.encodeWithSelector(CharacterSystem.CharacterSystem_BirthNotReady.selector, c.targetBlock));
    world.aldea__completeBirth(id);

    vm.roll(c.targetBlock + 1);
    vm.setBlockhash(c.targetBlock, keccak256("seed"));
    world.aldea__completeBirth(id); // permissionless: the test plays the Midwife
    c = Character.get(id);
    assertEq(uint8(c.status), uint8(BirthStatus.Born));
    assertLt(uint8(c.tribe), 5);
    assertEq(Census.getTotalPopulation(), 1);
    assertEq(Census.getGestating(), 0);
    uint32[5] memory byTribe = Census.getTribePopulation();
    assertEq(byTribe[uint8(c.tribe)], 1);
    uint32[11] memory byClass = Census.getClassPopulation();
    assertEq(byClass[0], 1);

    vm.expectRevert(abi.encodeWithSelector(CharacterSystem.CharacterSystem_NotGestating.selector, id));
    world.aldea__completeBirth(id);
  }

  function test_onePersonOneCharacter() public {
    bytes32 soul = _anchor(alice, "alma:main:human:aaaa");
    uint32 id = _birth(alice, soul, CharacterClass.Chef);
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(CharacterSystem.CharacterSystem_AlreadyHasCharacter.selector, id));
    world.aldea__requestBirth(CharacterClass.Warrior, soul);
    // bob cannot use alice's soul
    vm.prank(bob);
    vm.expectRevert(abi.encodeWithSelector(CharacterSystem.CharacterSystem_SoulAlreadyHasCharacter.selector, id));
    world.aldea__requestBirth(CharacterClass.Warrior, soul);
    // bob with a soul he does not control (a non-existent soul)
    vm.prank(bob);
    vm.expectRevert(abi.encodeWithSelector(CharacterSystem.CharacterSystem_NotSoulController.selector, keccak256("x")));
    world.aldea__requestBirth(CharacterClass.Warrior, keccak256("x"));
  }

  function test_expiredBlockhashReschedules() public {
    bytes32 soul = _anchor(alice, "alma:main:human:bbbb");
    uint32 id = _birth(alice, soul, CharacterClass.Magician);
    uint64 target = Character.getTargetBlock(id);
    vm.roll(target + 300); // > 256 blocks: blockhash == 0
    world.aldea__completeBirth(id);
    assertEq(uint8(Character.getStatus(id)), uint8(BirthStatus.Gestating));
    assertEq(Character.getTargetBlock(id), block.number + 3);
  }

  function test_enterBuilding() public {
    bytes32 soul = _anchor(alice, "alma:main:human:cccc");
    uint32 id = _birth(alice, soul, CharacterClass.Tailor);
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(MovementSystem.MovementSystem_NotBorn.selector, id));
    world.aldea__enterBuilding(TOWN);
    uint64 target = Character.getTargetBlock(id);
    vm.roll(target + 1);
    vm.setBlockhash(target, keccak256("s2"));
    world.aldea__completeBirth(id);
    vm.prank(alice);
    world.aldea__enterBuilding(TOWN);
    assertEq(Location.getBuildingId(id), TOWN);
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(MovementSystem.MovementSystem_BuildingClosed.selector, FORGE));
    world.aldea__enterBuilding(FORGE);
    vm.prank(alice);
    world.aldea__leaveBuilding();
    assertEq(Location.getBuildingId(id), bytes32(0));
    // controller rotation: the character follows the soul
    address alice2 = address(0xA11CE2);
    vm.prank(alice);
    alma.rotateController(soul, alice2, keccak256("doc2"));
    vm.prank(alice2);
    world.aldea__enterBuilding(TOWN);
    assertEq(Location.getBuildingId(id), TOWN);
    vm.prank(alice);
    vm.expectRevert(MovementSystem.MovementSystem_NoSoul.selector);
    world.aldea__enterBuilding(TOWN);
  }

  function _attest(address owner, bytes32 soul, bytes28 cred, uint128 bal) internal view returns (FounderAttestation memory a, bytes memory sig) {
    a = FounderAttestation(owner, soul, cred, bal, 123456, uint64(block.timestamp + 900), keccak256(abi.encode(owner, cred)));
    bytes32 domainSeparator = keccak256(abi.encode(
      keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
      keccak256("ALDEA World"), keccak256("1"), block.chainid, worldAddress));
    bytes32 structHash = keccak256(abi.encode(
      keccak256("FounderAttestation(address owner,bytes32 almaIdHash,bytes28 cardanoStakeCredential,uint128 aldeaBalance,uint64 snapshotSlot,uint64 deadline,bytes32 nonce)"),
      a.owner, a.almaIdHash, a.cardanoStakeCredential, a.aldeaBalance, a.snapshotSlot, a.deadline, a.nonce));
    bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
    sig = abi.encodePacked(r, s, v);
  }

  function test_founderAndGenesis() public {
    vm.prank(deployer);
    world.aldea__setConfig(address(alma), attestor, 1_000 * 1e6, uint64(block.timestamp + 7 days), 3);
    bytes32 soulA = _anchor(alice, "alma:main:human:dddd");
    bytes32 soulB = _anchor(bob, "alma:main:human:eeee");
    // bob is not a Founder: he cannot be born during Genesis Week
    vm.prank(bob);
    vm.expectRevert(CharacterSystem.CharacterSystem_GenesisFoundersOnly.selector);
    world.aldea__requestBirth(CharacterClass.Rebel, soulB);
    // alice submits her attestation
    bytes28 cred = bytes28(keccak256("stake-alice"));
    (FounderAttestation memory a, bytes memory sig) = _attest(alice, soulA, cred, 5_000 * 1e6);
    vm.prank(alice);
    world.aldea__claimFounder(a, sig);
    assertGt(Founder.getClaimedAt(soulA), 0);
    // it cannot be reused
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(FounderSystem.FounderSystem_AlreadyFounder.selector, soulA));
    world.aldea__claimFounder(a, sig);
    // the same stake credential cannot seal another soul
    (FounderAttestation memory b, bytes memory sigB) = _attest(bob, soulB, cred, 5_000 * 1e6);
    vm.prank(bob);
    vm.expectRevert(abi.encodeWithSelector(FounderSystem.FounderSystem_StakeCredentialAlreadyClaimed.selector, cred));
    world.aldea__claimFounder(b, sigB);
    // below the minimum balance
    (FounderAttestation memory c, bytes memory sigC) = _attest(bob, soulB, bytes28(keccak256("stake-bob")), 10 * 1e6);
    vm.prank(bob);
    vm.expectRevert(abi.encodeWithSelector(FounderSystem.FounderSystem_BelowMinimumBalance.selector, uint128(10 * 1e6), uint128(1_000 * 1e6)));
    world.aldea__claimFounder(c, sigC);
    // attestation submitted by a different account
    vm.prank(bob);
    vm.expectRevert(FounderSystem.FounderSystem_AttestationOwnerMismatch.selector);
    world.aldea__claimFounder(a, sig);
    // alice (a Founder) can be born during Genesis Week
    _birth(alice, soulA, CharacterClass.Priest);
  }

  function test_adminOnlyNamespaceOwner() public {
    vm.prank(alice);
    vm.expectRevert();
    world.aldea__setPaused(true);
    vm.prank(deployer);
    world.aldea__setPaused(true);
    bytes32 soul = _anchor(alice, "alma:main:human:ffff");
    vm.prank(alice);
    vm.expectRevert(CharacterSystem.CharacterSystem_WorldPaused.selector);
    world.aldea__requestBirth(CharacterClass.Chef, soul);
  }
}
