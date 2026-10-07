// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import { CouncilInputs } from "../src/CouncilInputs.sol";

contract CouncilInputsTest is Test {
  event EffectstreamGameInteraction(address indexed userAddress, bytes data, uint256 value);

  CouncilInputs inputs = new CouncilInputs();

  function test_anyonePublishesAnInputAndItStaysInTheLogs() public {
    bytes memory data = bytes('["cv","0x01","s"]');
    vm.expectEmit(true, false, false, true, address(inputs));
    emit EffectstreamGameInteraction(address(0xB0B), data, 0);
    vm.prank(address(0xB0B));
    inputs.effectstreamSubmitGameInput(data);
  }

  function test_takesNoValue() public {
    vm.deal(address(this), 1 ether);
    (bool ok, ) = address(inputs).call{ value: 1 }(abi.encodeCall(CouncilInputs.effectstreamSubmitGameInput, (bytes("x"))));
    assertFalse(ok);
    assertEq(address(inputs).balance, 0);
  }

  function test_selectorAndTopicAreTheOnesEffectstreamReads() public pure {
    assertEq(CouncilInputs.effectstreamSubmitGameInput.selector, bytes4(0x4411cb52));
    assertEq(CouncilInputs.EffectstreamGameInteraction.selector, 0x85842d0f9eec16c853cbb64381cc694bb85ee6019b87ef15366d9b05826541d1);
  }
}
