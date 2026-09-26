// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

interface IAlmaAnchorRegistry {
  function isController(bytes32 almaIdHash, address account) external view returns (bool);
  function subjectTypeOf(bytes32 almaIdHash) external view returns (uint8); // 1 human, 2 org, 3 agent
  function humanOf(address controller) external view returns (bytes32);
}
