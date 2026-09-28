// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import { AlmaAnchorRegistry } from "@adasouls/protocol/AlmaAnchorRegistry.sol";
import { AtlasRegistry, IAlmaAnchors } from "@adasouls/protocol/AtlasRegistry.sol";
import { AldeaCouncilExecutor, IAtlasGovernable } from "../src/AldeaCouncilExecutor.sol";

contract CouncilTest is Test {
  AlmaAnchorRegistry alma; AtlasRegistry atlas; AldeaCouncilExecutor council;
  address safe = address(0x5AFE); address ci = address(0xC1); address relayer = address(0x7E1A);
  bytes32 aldeaOrg; bytes32 worldId; bytes32 v0;

  function setUp() public {
    alma = new AlmaAnchorRegistry(safe);
    atlas = new AtlasRegistry(IAlmaAnchors(address(alma)), safe, safe);
    council = new AldeaCouncilExecutor(IAtlasGovernable(address(atlas)), relayer, safe, 1 days);
    vm.startPrank(safe);
    alma.setIssuer(safe, true);
    aldeaOrg = alma.anchorOrgFor("alma:main:org:aldea-world", safe, keccak256("doc"));
    worldId = atlas.registerWorld("ALDEA World", aldeaOrg, bytes32(0), AtlasRegistry.Visibility.Public, "ipfs://meta", address(0));
    atlas.setMaintainer(worldId, ci, true);
    vm.stopPrank();
    vm.prank(ci);
    v0 = atlas.registerVersion(worldId, AtlasRegistry.VersionInput(bytes32(0), 84532, address(0xA0), bytes20(uint160(0xC0FFEE)), "mud@2.2.23", "0.1.0", "bafybeigenesis"));
  }

  function test_genesisCharterFlowWithDelayAndVeto() public {
    vm.prank(safe); atlas.setGovernor(worldId, address(council));
    bytes32 pid = keccak256("genesis-charter");
    uint64 start = uint64(block.timestamp + 1 hours); uint64 end = start + 7 days;
    vm.prank(safe);
    council.openProposal(pid, AldeaCouncilExecutor.ProposalKind.GenesisRatification, worldId, v0, start, start, end, "ipfs://params");
    vm.prank(relayer);
    vm.expectRevert(abi.encodeWithSelector(AldeaCouncilExecutor.TooEarly.selector, end));
    council.queue(pid, v0, keccak256("tally"), "ipfs://tally");
    vm.warp(end);
    vm.prank(relayer);
    vm.expectRevert(abi.encodeWithSelector(AldeaCouncilExecutor.VersionMismatch.selector, v0, bytes32(uint256(1))));
    council.queue(pid, bytes32(uint256(1)), keccak256("tally"), "ipfs://tally");
    vm.prank(relayer);
    council.queue(pid, v0, keccak256("tally"), "ipfs://tally");
    vm.expectRevert(abi.encodeWithSelector(AldeaCouncilExecutor.TooEarly.selector, uint64(block.timestamp + 1 days)));
    council.execute(pid);
    vm.warp(block.timestamp + 1 days);
    council.execute(pid); // anyone
    (bytes32 off,) = atlas.officialVersionOf(worldId);
    assertEq(off, v0);
    // a second proposal, vetoed by the guardian
    vm.prank(ci);
    bytes32 v1 = atlas.registerVersion(worldId, AtlasRegistry.VersionInput(v0, 84532, address(0xA1), bytes20(uint160(0xBEEF)), "mud@2.2.23", "0.2.0", "bafybeiv1"));
    bytes32 pid2 = keccak256("season-1");
    uint64 s2 = uint64(block.timestamp + 1); uint64 e2 = s2 + 7 days;
    vm.prank(safe);
    council.openProposal(pid2, AldeaCouncilExecutor.ProposalKind.SeasonElection, worldId, bytes32(0), s2, s2, e2, "ipfs://p2");
    vm.warp(e2);
    vm.prank(relayer); council.queue(pid2, v1, keccak256("t2"), "ipfs://t2");
    vm.prank(safe); council.veto(pid2, "tally mismatch");
    vm.warp(block.timestamp + 2 days);
    vm.expectRevert(abi.encodeWithSelector(AldeaCouncilExecutor.InvalidState.selector, pid2));
    council.execute(pid2);
    (off,) = atlas.officialVersionOf(worldId);
    assertEq(off, v0);
  }
}
