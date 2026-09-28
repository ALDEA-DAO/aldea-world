// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAtlasGovernable {
  function setOfficialVersion(bytes32 worldId, bytes32 versionId) external;
}

/// @title AldeaCouncilExecutor
/// @notice Executes the ALDEA Council's result on the Atlas (tallied by Effectstream), with a delay and a guardian veto.
contract AldeaCouncilExecutor {
  enum ProposalKind { GenesisRatification, SeasonElection }
  enum ProposalState { None, Open, Queued, Vetoed, Executed }

  struct Proposal {
    ProposalKind kind;
    ProposalState state;
    bytes32 worldId;
    bytes32 versionId;
    bytes32 tallyHash;
    uint64 snapshotAt;
    uint64 startsAt;
    uint64 endsAt;
    uint64 eta;
    string paramsURI;
    string tallyURI;
  }

  IAtlasGovernable public immutable atlas;
  uint64 public immutable delay;
  address public relayer;
  address public guardian;
  mapping(bytes32 => Proposal) private _proposals;

  event ProposalOpened(bytes32 indexed proposalId, ProposalKind kind, bytes32 indexed worldId, bytes32 indexed versionId, uint64 snapshotAt, uint64 startsAt, uint64 endsAt, string paramsURI);
  event ProposalQueued(bytes32 indexed proposalId, bytes32 indexed versionId, bytes32 tallyHash, string tallyURI, uint64 eta);
  event ProposalVetoed(bytes32 indexed proposalId, address indexed by, string reason);
  event ProposalExecuted(bytes32 indexed proposalId, bytes32 indexed worldId, bytes32 indexed versionId);
  event RelayerChanged(address previousRelayer, address newRelayer);
  event GuardianChanged(address previousGuardian, address newGuardian);

  error NotRelayer();
  error NotGuardian();
  error InvalidState(bytes32 proposalId);
  error InvalidSchedule();
  error TooEarly(uint64 availableAt);
  error VersionMismatch(bytes32 expected, bytes32 got);
  error InvalidAddress();

  constructor(IAtlasGovernable atlas_, address relayer_, address guardian_, uint64 delay_) {
    if (address(atlas_) == address(0) || relayer_ == address(0) || guardian_ == address(0)) revert InvalidAddress();
    atlas = atlas_;
    relayer = relayer_;
    guardian = guardian_;
    delay = delay_; // 86400 (24 h) in production
  }

  modifier onlyRelayer() {
    if (msg.sender != relayer) revert NotRelayer();
    _;
  }

  modifier onlyGuardian() {
    if (msg.sender != guardian) revert NotGuardian();
    _;
  }

  /// The Genesis Charter is opened with versionId = v0; in a season, versionId = 0 and the candidate versions go in paramsURI.
  function openProposal(
    bytes32 proposalId,
    ProposalKind kind,
    bytes32 worldId,
    bytes32 versionId,
    uint64 snapshotAt,
    uint64 startsAt,
    uint64 endsAt,
    string calldata paramsURI
  ) external onlyGuardian {
    Proposal storage p = _proposals[proposalId];
    if (p.state != ProposalState.None) revert InvalidState(proposalId);
    if (!(snapshotAt <= startsAt && startsAt < endsAt && endsAt > block.timestamp)) revert InvalidSchedule();
    p.kind = kind;
    p.state = ProposalState.Open;
    p.worldId = worldId;
    p.versionId = versionId;
    p.snapshotAt = snapshotAt;
    p.startsAt = startsAt;
    p.endsAt = endsAt;
    p.paramsURI = paramsURI;
    emit ProposalOpened(proposalId, kind, worldId, versionId, snapshotAt, startsAt, endsAt, paramsURI);
  }

  /// The relayer queues only approved results; the full tally is stored at tallyURI and its hash on-chain.
  function queue(bytes32 proposalId, bytes32 versionId, bytes32 tallyHash, string calldata tallyURI) external onlyRelayer {
    Proposal storage p = _proposals[proposalId];
    if (p.state != ProposalState.Open) revert InvalidState(proposalId);
    if (block.timestamp < p.endsAt) revert TooEarly(p.endsAt);
    if (p.kind == ProposalKind.GenesisRatification && versionId != p.versionId) revert VersionMismatch(p.versionId, versionId);
    p.versionId = versionId;
    p.tallyHash = tallyHash;
    p.tallyURI = tallyURI;
    p.eta = uint64(block.timestamp) + delay;
    p.state = ProposalState.Queued;
    emit ProposalQueued(proposalId, versionId, tallyHash, tallyURI, p.eta);
  }

  function veto(bytes32 proposalId, string calldata reason) external onlyGuardian {
    Proposal storage p = _proposals[proposalId];
    if (p.state != ProposalState.Open && p.state != ProposalState.Queued) revert InvalidState(proposalId);
    p.state = ProposalState.Vetoed;
    emit ProposalVetoed(proposalId, msg.sender, reason);
  }

  function execute(bytes32 proposalId) external {
    Proposal storage p = _proposals[proposalId];
    if (p.state != ProposalState.Queued) revert InvalidState(proposalId);
    if (block.timestamp < p.eta) revert TooEarly(p.eta);
    p.state = ProposalState.Executed;
    atlas.setOfficialVersion(p.worldId, p.versionId);
    emit ProposalExecuted(proposalId, p.worldId, p.versionId);
  }

  function setRelayer(address newRelayer) external onlyGuardian {
    if (newRelayer == address(0)) revert InvalidAddress();
    emit RelayerChanged(relayer, newRelayer);
    relayer = newRelayer;
  }

  function setGuardian(address newGuardian) external onlyGuardian {
    if (newGuardian == address(0)) revert InvalidAddress();
    emit GuardianChanged(guardian, newGuardian);
    guardian = newGuardian;
  }

  function getProposal(bytes32 proposalId) external view returns (Proposal memory) {
    return _proposals[proposalId];
  }
}
