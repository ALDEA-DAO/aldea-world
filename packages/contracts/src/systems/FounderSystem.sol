// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { Config, ConfigData, Founder, FounderByStake, UsedAttestation } from "../codegen/index.sol";
import { IAlmaAnchorRegistry } from "../interfaces/IAlmaAnchorRegistry.sol";
import { FounderAttestation } from "../types/FounderAttestation.sol";

contract FounderSystem is System {
  bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
  bytes32 internal constant FOUNDER_TYPEHASH = keccak256(
    "FounderAttestation(address owner,bytes32 almaIdHash,bytes28 cardanoStakeCredential,uint128 aldeaBalance,uint64 snapshotSlot,uint64 deadline,bytes32 nonce)"
  );
  bytes32 internal constant NAME_HASH = keccak256("ALDEA World");
  bytes32 internal constant VERSION_HASH = keccak256("1");

  error FounderSystem_WorldPaused();
  error FounderSystem_AttestationOwnerMismatch();
  error FounderSystem_AttestationExpired(uint64 deadline);
  error FounderSystem_AttestationUsed(bytes32 digest);
  error FounderSystem_InvalidAttestationSigner(address recovered);
  error FounderSystem_BelowMinimumBalance(uint128 balance, uint128 minimum);
  error FounderSystem_NotSoulController(bytes32 almaIdHash);
  error FounderSystem_AlreadyFounder(bytes32 almaIdHash);
  error FounderSystem_StakeCredentialAlreadyClaimed(bytes28 cardanoStakeCredential);

  event FounderClaimed(bytes32 indexed almaIdHash, bytes28 indexed cardanoStakeCredential, uint128 aldeaBalance, uint64 snapshotSlot);

  function claimFounder(FounderAttestation calldata a, bytes calldata signature) public {
    ConfigData memory cfg = Config.get();
    if (cfg.paused) revert FounderSystem_WorldPaused();
    if (a.owner != _msgSender()) revert FounderSystem_AttestationOwnerMismatch();
    if (block.timestamp > a.deadline) revert FounderSystem_AttestationExpired(a.deadline);
    if (!IAlmaAnchorRegistry(cfg.almaRegistry).isController(a.almaIdHash, a.owner)) revert FounderSystem_NotSoulController(a.almaIdHash);
    if (Founder.getClaimedAt(a.almaIdHash) != 0) revert FounderSystem_AlreadyFounder(a.almaIdHash);
    if (FounderByStake.get(a.cardanoStakeCredential) != bytes32(0)) revert FounderSystem_StakeCredentialAlreadyClaimed(a.cardanoStakeCredential);
    if (a.aldeaBalance < cfg.minFounderBalance) revert FounderSystem_BelowMinimumBalance(a.aldeaBalance, cfg.minFounderBalance);

    bytes32 digest = _digest(a);
    if (UsedAttestation.get(digest)) revert FounderSystem_AttestationUsed(digest);
    address recovered = ECDSA.recover(digest, signature);
    if (recovered != cfg.founderAttestor) revert FounderSystem_InvalidAttestationSigner(recovered);

    UsedAttestation.set(digest, true);
    Founder.set(a.almaIdHash, a.cardanoStakeCredential, a.aldeaBalance, a.snapshotSlot, uint64(block.timestamp));
    FounderByStake.set(a.cardanoStakeCredential, a.almaIdHash);
    emit FounderClaimed(a.almaIdHash, a.cardanoStakeCredential, a.aldeaBalance, a.snapshotSlot);
  }

  function _digest(FounderAttestation calldata a) internal view returns (bytes32) {
    bytes32 domainSeparator = keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, _world()));
    bytes32 structHash = keccak256(
      abi.encode(FOUNDER_TYPEHASH, a.owner, a.almaIdHash, a.cardanoStakeCredential, a.aldeaBalance, a.snapshotSlot, a.deadline, a.nonce)
    );
    return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
  }
}
