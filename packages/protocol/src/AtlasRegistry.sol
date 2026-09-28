// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAlmaAnchors {
  function isController(bytes32 almaIdHash, address account) external view returns (bool);
  function subjectTypeOf(bytes32 almaIdHash) external view returns (uint8);
}

/// @title AtlasRegistry
/// @notice Engine-agnostic registry: worlds, versions (with their client's CID), forks and clients.
contract AtlasRegistry {
  enum Visibility { Public, Unlisted, Private }
  enum VersionStatus { None, Candidate, Official, Superseded, Withdrawn }
  enum ClientKind { Web, Mobile, Desktop, Agent }

  struct WorldEntry {
    bytes32 almaOrgIdHash;
    bytes32 parentWorldId;
    bytes32 officialVersionId;
    address governor;
    Visibility visibility;
    bool verified;
    uint64 createdAt;
    string name;
    string metadataURI;
  }

  struct VersionEntry {
    bytes32 worldId;
    bytes32 parentVersionId;
    uint256 chainId;
    address worldAddress;
    bytes20 gitCommit;
    VersionStatus status;
    uint64 registeredAt;
    address registeredBy;
    string engine;
    string semver;
    string clientCid;
  }

  struct VersionInput {
    bytes32 parentVersionId;
    uint256 chainId;
    address worldAddress;
    bytes20 gitCommit;
    string engine;
    string semver;
    string clientCid;
  }

  struct ClientEntry {
    bytes32 versionId;
    bytes32 operatorAlmaIdHash;
    ClientKind kind;
    bool active;
    uint64 registeredAt;
    string url;
  }

  uint8 private constant SUBJECT_ORG = 2;

  IAlmaAnchors public immutable alma;
  address public admin;
  address public curator;
  uint256 public worldNonce;

  mapping(bytes32 => WorldEntry) private _worlds;
  mapping(bytes32 => VersionEntry) private _versions;
  mapping(bytes32 => ClientEntry) private _clients;
  mapping(bytes32 => mapping(address => bool)) public maintainers;

  event WorldRegistered(bytes32 indexed worldId, bytes32 indexed almaOrgIdHash, bytes32 indexed parentWorldId, address governor, Visibility visibility, string name, string metadataURI);
  event VersionRegistered(bytes32 indexed versionId, bytes32 indexed worldId, bytes32 indexed parentVersionId, VersionInput version, address registeredBy);
  event ClientRegistered(bytes32 indexed clientId, bytes32 indexed versionId, bytes32 indexed operatorAlmaIdHash, ClientKind kind, string url);
  event ClientDeactivated(bytes32 indexed clientId);
  event OfficialVersionSet(bytes32 indexed worldId, bytes32 indexed versionId, bytes32 previousVersionId, address by);
  event VersionWithdrawn(bytes32 indexed versionId);
  event GovernorChanged(bytes32 indexed worldId, address previousGovernor, address newGovernor);
  event VisibilityChanged(bytes32 indexed worldId, Visibility visibility);
  event MetadataChanged(bytes32 indexed worldId, string metadataURI);
  event VerifiedChanged(bytes32 indexed worldId, bool verified);
  event MaintainerSet(bytes32 indexed worldId, address indexed maintainer, bool allowed);
  event CuratorChanged(address previousCurator, address newCurator);
  event AdminTransferred(address previousAdmin, address newAdmin);

  error NotAdmin();
  error NotCurator();
  error NotGovernor(bytes32 worldId);
  error NotWorldOwner(bytes32 worldId);
  error NotOrgController(bytes32 almaOrgIdHash);
  error NotOperator(bytes32 operatorAlmaIdHash);
  error UnknownWorld(bytes32 worldId);
  error UnknownVersion(bytes32 versionId);
  error UnknownClient(bytes32 clientId);
  error VersionExists(bytes32 versionId);
  error ClientExists(bytes32 clientId);
  error WrongWorld(bytes32 versionId, bytes32 worldId);
  error InvalidStatus(bytes32 versionId);
  error InvalidInput();

  constructor(IAlmaAnchors alma_, address admin_, address curator_) {
    if (address(alma_) == address(0) || admin_ == address(0)) revert InvalidInput();
    alma = alma_;
    admin = admin_;
    curator = curator_;
  }

  modifier onlyAdmin() {
    if (msg.sender != admin) revert NotAdmin();
    _;
  }

  modifier onlyGovernor(bytes32 worldId) {
    WorldEntry storage w = _worlds[worldId];
    if (w.createdAt == 0) revert UnknownWorld(worldId);
    if (msg.sender != w.governor) revert NotGovernor(worldId);
    _;
  }

  modifier onlyWorldOwner(bytes32 worldId) {
    WorldEntry storage w = _worlds[worldId];
    if (w.createdAt == 0) revert UnknownWorld(worldId);
    if (!alma.isController(w.almaOrgIdHash, msg.sender)) revert NotWorldOwner(worldId);
    _;
  }

  // ------------------------------------------------------------------ worlds

  function registerWorld(
    string calldata name,
    bytes32 almaOrgIdHash,
    bytes32 parentWorldId,
    Visibility visibility,
    string calldata metadataURI,
    address governor
  ) external returns (bytes32 worldId) {
    if (bytes(name).length == 0 || bytes(name).length > 64 || bytes(metadataURI).length > 256) revert InvalidInput();
    if (alma.subjectTypeOf(almaOrgIdHash) != SUBJECT_ORG || !alma.isController(almaOrgIdHash, msg.sender)) {
      revert NotOrgController(almaOrgIdHash);
    }
    if (parentWorldId != bytes32(0) && _worlds[parentWorldId].createdAt == 0) revert UnknownWorld(parentWorldId);

    worldId = keccak256(abi.encode(block.chainid, address(this), ++worldNonce, almaOrgIdHash, name));
    WorldEntry storage w = _worlds[worldId];
    w.almaOrgIdHash = almaOrgIdHash;
    w.parentWorldId = parentWorldId;
    w.governor = governor == address(0) ? msg.sender : governor;
    w.visibility = visibility;
    w.createdAt = uint64(block.timestamp);
    w.name = name;
    w.metadataURI = metadataURI;
    emit WorldRegistered(worldId, almaOrgIdHash, parentWorldId, w.governor, visibility, name, metadataURI);
  }

  function setMaintainer(bytes32 worldId, address maintainer, bool allowed) external onlyWorldOwner(worldId) {
    maintainers[worldId][maintainer] = allowed;
    emit MaintainerSet(worldId, maintainer, allowed);
  }

  function setGovernor(bytes32 worldId, address newGovernor) external onlyGovernor(worldId) {
    if (newGovernor == address(0)) revert InvalidInput();
    emit GovernorChanged(worldId, _worlds[worldId].governor, newGovernor);
    _worlds[worldId].governor = newGovernor;
  }

  function setVisibility(bytes32 worldId, Visibility visibility) external onlyWorldOwner(worldId) {
    _worlds[worldId].visibility = visibility;
    emit VisibilityChanged(worldId, visibility);
  }

  function setMetadataURI(bytes32 worldId, string calldata metadataURI) external onlyWorldOwner(worldId) {
    if (bytes(metadataURI).length > 256) revert InvalidInput();
    _worlds[worldId].metadataURI = metadataURI;
    emit MetadataChanged(worldId, metadataURI);
  }

  function setVerified(bytes32 worldId, bool verified) external {
    if (msg.sender != curator) revert NotCurator();
    if (_worlds[worldId].createdAt == 0) revert UnknownWorld(worldId);
    _worlds[worldId].verified = verified;
    emit VerifiedChanged(worldId, verified);
  }

  // ---------------------------------------------------------------- versions

  function registerVersion(bytes32 worldId, VersionInput calldata v) external returns (bytes32 versionId) {
    WorldEntry storage w = _worlds[worldId];
    if (w.createdAt == 0) revert UnknownWorld(worldId);
    if (!alma.isController(w.almaOrgIdHash, msg.sender) && !maintainers[worldId][msg.sender]) revert NotWorldOwner(worldId);
    if (
      v.worldAddress == address(0) || v.chainId == 0 || bytes(v.clientCid).length == 0 || bytes(v.clientCid).length > 128
        || bytes(v.semver).length == 0 || bytes(v.semver).length > 32 || bytes(v.engine).length > 32
    ) revert InvalidInput();
    if (v.parentVersionId != bytes32(0) && _versions[v.parentVersionId].status == VersionStatus.None) {
      revert UnknownVersion(v.parentVersionId);
    }

    versionId = keccak256(abi.encode(worldId, v.chainId, v.worldAddress, v.gitCommit, v.clientCid));
    if (_versions[versionId].status != VersionStatus.None) revert VersionExists(versionId);
    VersionEntry storage e = _versions[versionId];
    e.worldId = worldId;
    e.parentVersionId = v.parentVersionId;
    e.chainId = v.chainId;
    e.worldAddress = v.worldAddress;
    e.gitCommit = v.gitCommit;
    e.status = VersionStatus.Candidate;
    e.registeredAt = uint64(block.timestamp);
    e.registeredBy = msg.sender;
    e.engine = v.engine;
    e.semver = v.semver;
    e.clientCid = v.clientCid;
    emit VersionRegistered(versionId, worldId, v.parentVersionId, v, msg.sender);
  }

  function withdrawVersion(bytes32 versionId) external {
    VersionEntry storage e = _versions[versionId];
    if (e.status == VersionStatus.None) revert UnknownVersion(versionId);
    if (!alma.isController(_worlds[e.worldId].almaOrgIdHash, msg.sender)) revert NotWorldOwner(e.worldId);
    if (e.status != VersionStatus.Candidate) revert InvalidStatus(versionId);
    e.status = VersionStatus.Withdrawn;
    emit VersionWithdrawn(versionId);
  }

  function setOfficialVersion(bytes32 worldId, bytes32 versionId) external onlyGovernor(worldId) {
    VersionEntry storage e = _versions[versionId];
    if (e.status == VersionStatus.None) revert UnknownVersion(versionId);
    if (e.worldId != worldId) revert WrongWorld(versionId, worldId);
    if (e.status != VersionStatus.Candidate && e.status != VersionStatus.Superseded) revert InvalidStatus(versionId);

    WorldEntry storage w = _worlds[worldId];
    bytes32 previous = w.officialVersionId;
    if (previous != bytes32(0)) _versions[previous].status = VersionStatus.Superseded;
    e.status = VersionStatus.Official;
    w.officialVersionId = versionId;
    emit OfficialVersionSet(worldId, versionId, previous, msg.sender);
  }

  // ----------------------------------------------------------------- clients

  function registerClient(bytes32 versionId, string calldata url, ClientKind kind, bytes32 operatorAlmaIdHash)
    external
    returns (bytes32 clientId)
  {
    VersionEntry storage e = _versions[versionId];
    if (e.status == VersionStatus.None || e.status == VersionStatus.Withdrawn) revert UnknownVersion(versionId);
    if (!alma.isController(operatorAlmaIdHash, msg.sender)) revert NotOperator(operatorAlmaIdHash);
    if (!_isHttpsUrl(bytes(url))) revert InvalidInput();

    clientId = keccak256(abi.encode(versionId, url));
    if (_clients[clientId].registeredAt != 0) revert ClientExists(clientId);
    _clients[clientId] = ClientEntry(versionId, operatorAlmaIdHash, kind, true, uint64(block.timestamp), url);
    emit ClientRegistered(clientId, versionId, operatorAlmaIdHash, kind, url);
  }

  function deactivateClient(bytes32 clientId) external {
    ClientEntry storage c = _clients[clientId];
    if (c.registeredAt == 0) revert UnknownClient(clientId);
    if (!alma.isController(c.operatorAlmaIdHash, msg.sender)) revert NotOperator(c.operatorAlmaIdHash);
    c.active = false;
    emit ClientDeactivated(clientId);
  }

  // ------------------------------------------------------------------ admin

  function setCurator(address newCurator) external onlyAdmin {
    emit CuratorChanged(curator, newCurator);
    curator = newCurator;
  }

  function transferAdmin(address newAdmin) external onlyAdmin {
    if (newAdmin == address(0)) revert InvalidInput();
    emit AdminTransferred(admin, newAdmin);
    admin = newAdmin;
  }

  // ---------------------------------------------------------------- reads

  function getWorld(bytes32 worldId) external view returns (WorldEntry memory) {
    return _worlds[worldId];
  }

  function getVersion(bytes32 versionId) external view returns (VersionEntry memory) {
    return _versions[versionId];
  }

  function getClient(bytes32 clientId) external view returns (ClientEntry memory) {
    return _clients[clientId];
  }

  function officialVersionOf(bytes32 worldId) external view returns (bytes32 versionId, VersionEntry memory version) {
    versionId = _worlds[worldId].officialVersionId;
    version = _versions[versionId];
  }

  function _isHttpsUrl(bytes memory url) private pure returns (bool) {
    bytes memory prefix = "https://";
    if (url.length <= prefix.length || url.length > 256) return false;
    for (uint256 i = 0; i < prefix.length; i++) {
      if (url[i] != prefix[i]) return false;
    }
    return true;
  }
}
