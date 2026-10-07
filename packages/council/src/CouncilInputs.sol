// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CouncilInputs
/// @notice Where the Council's inputs are published: Founders' signed votes (posted in batches by a relayer that
///         pays the gas) and the rules of each proposal (posted by the guardian). The contract keeps no state and
///         judges nothing: every input stays in Base's logs as public evidence, and the read model decides which
///         ones count by who signed them.
/// @dev The function and the event are the ones Effectstream's L2 primitive and batcher expect.
contract CouncilInputs {
  event EffectstreamGameInteraction(address indexed userAddress, bytes data, uint256 value);

  error NoValue();

  function effectstreamSubmitGameInput(bytes calldata data) external payable {
    // Nothing is charged, and nothing sent here could ever be taken out
    if (msg.value != 0) revert NoValue();
    emit EffectstreamGameInteraction(msg.sender, data, 0);
  }
}
