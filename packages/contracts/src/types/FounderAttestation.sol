// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

struct FounderAttestation {
  address owner;                  // smart account that will submit the attestation
  bytes32 almaIdHash;             // human soul to be sealed
  bytes28 cardanoStakeCredential; // stake credential verified by the Resolver (CIP-8)
  uint128 aldeaBalance;           // $ALDEA balance in base units
  uint64 snapshotSlot;            // Cardano slot of the balance
  uint64 deadline;                // unix seconds; +15 min from issuance
  bytes32 nonce;                  // random
}
