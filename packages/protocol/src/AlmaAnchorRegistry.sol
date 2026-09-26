// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AlmaAnchorRegistry
/// @notice Public anchors of ALMA identities on an EVM chain. The full document lives in the ALMA Resolver;
///         only the commitment (docHash), the current controller and the revocation are kept here.
contract AlmaAnchorRegistry {
  enum SubjectType { None, Human, Org, Agent }

  struct Anchor {
    SubjectType subjectType;
    address controller;
    bytes32 docHash;
    bytes32 ownerIdHash; // Org: owning human soul (0 if an issuer anchored it). Agent: principal.
    uint64 anchoredAt;
    bool revoked;
  }

  mapping(bytes32 => Anchor) private _anchors;
  mapping(address => bytes32) public humanOf;
  mapping(address => bool) public issuers;
  address public admin;

  bytes private constant HUMAN_PREFIX = "alma:main:human:";
  bytes private constant ORG_PREFIX = "alma:main:org:";
  bytes private constant AGENT_PREFIX = "alma:main:agent:";

  event SubjectAnchored(
    bytes32 indexed almaIdHash, string almaId, SubjectType subjectType, address indexed controller, bytes32 ownerIdHash, bytes32 docHash
  );
  event ControllerRotated(bytes32 indexed almaIdHash, address indexed previousController, address indexed newController, bytes32 docHash);
  event DocHashUpdated(bytes32 indexed almaIdHash, bytes32 docHash);
  event SubjectRevoked(bytes32 indexed almaIdHash, address indexed by, string reason);
  event IssuerSet(address indexed issuer, bool allowed);
  event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

  error NotAdmin();
  error NotIssuer();
  error NotController(bytes32 almaIdHash);
  error AlreadyAnchored(bytes32 almaIdHash);
  error AlreadyHasHuman(bytes32 existing);
  error NoHumanSoul();
  error InvalidAlmaId();
  error InvalidAddress();
  error SubjectRevokedError(bytes32 almaIdHash);

  constructor(address admin_) {
    if (admin_ == address(0)) revert InvalidAddress();
    admin = admin_;
    emit AdminTransferred(address(0), admin_);
  }

  modifier onlyAdmin() {
    if (msg.sender != admin) revert NotAdmin();
    _;
  }

  modifier onlyController(bytes32 almaIdHash) {
    Anchor storage a = _anchors[almaIdHash];
    if (a.revoked) revert SubjectRevokedError(almaIdHash);
    if (a.subjectType == SubjectType.None || a.controller != msg.sender) revert NotController(almaIdHash);
    _;
  }

  /// One human soul per controller ("1 person = 1 soul" within each controller).
  function anchorHuman(string calldata almaId, bytes32 docHash) external returns (bytes32 almaIdHash) {
    bytes32 existing = humanOf[msg.sender];
    if (existing != bytes32(0)) revert AlreadyHasHuman(existing);
    _requireAlmaId(bytes(almaId), HUMAN_PREFIX);
    almaIdHash = _anchor(almaId, SubjectType.Human, msg.sender, bytes32(0), docHash);
    humanOf[msg.sender] = almaIdHash;
  }

  /// Self-service: an organization always has an owning human soul ("Human owns Organization").
  function anchorOrg(string calldata almaId, bytes32 docHash) external returns (bytes32 almaIdHash) {
    bytes32 ownerHuman = humanOf[msg.sender];
    if (ownerHuman == bytes32(0) || _anchors[ownerHuman].revoked) revert NoHumanSoul();
    _requireAlmaId(bytes(almaId), ORG_PREFIX);
    almaIdHash = _anchor(almaId, SubjectType.Org, msg.sender, ownerHuman, docHash);
  }

  /// Organizations operated by an issuer (tribes, aldea-world and brand worlds managed by AdaSouls).
  function anchorOrgFor(string calldata almaId, address controller, bytes32 docHash) external returns (bytes32 almaIdHash) {
    if (!issuers[msg.sender]) revert NotIssuer();
    if (controller == address(0)) revert InvalidAddress();
    _requireAlmaId(bytes(almaId), ORG_PREFIX);
    almaIdHash = _anchor(almaId, SubjectType.Org, controller, bytes32(0), docHash);
  }

  /// Phase 6 (Soul Registry for agents): an agent always represents a principal.
  function anchorAgent(string calldata almaId, bytes32 principalIdHash, address controller, bytes32 docHash)
    external
    onlyController(principalIdHash)
    returns (bytes32 almaIdHash)
  {
    if (controller == address(0)) revert InvalidAddress();
    _requireAlmaId(bytes(almaId), AGENT_PREFIX);
    almaIdHash = _anchor(almaId, SubjectType.Agent, controller, principalIdHash, docHash);
  }

  function rotateController(bytes32 almaIdHash, address newController, bytes32 newDocHash) external onlyController(almaIdHash) {
    if (newController == address(0)) revert InvalidAddress();
    Anchor storage a = _anchors[almaIdHash];
    if (a.subjectType == SubjectType.Human) {
      bytes32 other = humanOf[newController];
      if (other != bytes32(0)) revert AlreadyHasHuman(other);
      delete humanOf[msg.sender];
      humanOf[newController] = almaIdHash;
    }
    address previous = a.controller;
    a.controller = newController;
    a.docHash = newDocHash;
    emit ControllerRotated(almaIdHash, previous, newController, newDocHash);
  }

  function updateDocHash(bytes32 almaIdHash, bytes32 docHash) external onlyController(almaIdHash) {
    _anchors[almaIdHash].docHash = docHash;
    emit DocHashUpdated(almaIdHash, docHash);
  }

  /// Immediate, attributed and non-retroactive revocation.
  function revoke(bytes32 almaIdHash, string calldata reason) external onlyController(almaIdHash) {
    Anchor storage a = _anchors[almaIdHash];
    a.revoked = true;
    if (a.subjectType == SubjectType.Human) delete humanOf[msg.sender];
    emit SubjectRevoked(almaIdHash, msg.sender, reason);
  }

  function setIssuer(address issuer, bool allowed) external onlyAdmin {
    issuers[issuer] = allowed;
    emit IssuerSet(issuer, allowed);
  }

  function transferAdmin(address newAdmin) external onlyAdmin {
    if (newAdmin == address(0)) revert InvalidAddress();
    emit AdminTransferred(admin, newAdmin);
    admin = newAdmin;
  }

  function isController(bytes32 almaIdHash, address account) external view returns (bool) {
    Anchor storage a = _anchors[almaIdHash];
    return !a.revoked && a.subjectType != SubjectType.None && a.controller == account;
  }

  function subjectTypeOf(bytes32 almaIdHash) external view returns (uint8) {
    return uint8(_anchors[almaIdHash].subjectType);
  }

  function getAnchor(bytes32 almaIdHash) external view returns (Anchor memory) {
    return _anchors[almaIdHash];
  }

  function _anchor(string calldata almaId, SubjectType t, address controller, bytes32 ownerIdHash, bytes32 docHash)
    private
    returns (bytes32 almaIdHash)
  {
    almaIdHash = keccak256(bytes(almaId));
    if (_anchors[almaIdHash].subjectType != SubjectType.None) revert AlreadyAnchored(almaIdHash);
    _anchors[almaIdHash] = Anchor(t, controller, docHash, ownerIdHash, uint64(block.timestamp), false);
    emit SubjectAnchored(almaIdHash, almaId, t, controller, ownerIdHash, docHash);
  }

  /// Exact prefix + local-id in [a-z0-9-], 1..64 characters.
  function _requireAlmaId(bytes memory id, bytes memory prefix) private pure {
    if (id.length <= prefix.length || id.length > prefix.length + 64) revert InvalidAlmaId();
    for (uint256 i = 0; i < prefix.length; i++) {
      if (id[i] != prefix[i]) revert InvalidAlmaId();
    }
    for (uint256 i = prefix.length; i < id.length; i++) {
      bytes1 ch = id[i];
      bool ok = (ch >= 0x30 && ch <= 0x39) || (ch >= 0x61 && ch <= 0x7a) || ch == 0x2d;
      if (!ok) revert InvalidAlmaId();
    }
  }
}
