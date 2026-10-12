// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract BudgetVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error Unauthorized();
    error InvalidAmount();
    error InvalidGrant();
    error InvalidDelegation();
    error GrantExpired();
    error GrantIsRevoked();
    error CapExceeded();
    error InsufficientAvailable();
    error InvalidQuote();
    error InvalidDeadline();
    error CommitmentConflict();
    error InvalidCommitmentState();
    error AdapterAlreadySet();
    error Paused();
    error InvalidToken();
    error DepositCapExceeded();
    error CommitmentAmountExceeded();
    error ConcurrentCommitmentLimitExceeded();
    error ProviderNotAllowed();
    error EvaluatorNotAllowed();

    struct Ledger {
        uint256 deposited;
        uint256 available;
        uint256 reserved;
        uint256 inEscrow;
        uint256 settled;
        uint256 withdrawn;
    }

    struct Grant {
        bytes32 parentId;
        address grantee;
        uint256 cap;
        uint256 expiresAt;
        uint256 reserved;
        uint256 inEscrow;
        uint256 grossSpent;
        bool revoked;
        bool exists;
        uint8 depth;
        bool providerRestricted;
        bool evaluatorRestricted;
    }

    struct ReservationInput {
        bytes32 grantId;
        bytes32 operationId;
        address provider;
        address evaluator;
        address token;
        address adapter;
        uint256 amount;
        uint256 quoteExpiresAt;
        uint256 jobExpiresAt;
        bytes32 workHash;
        bytes32 nonce;
    }

    struct Reservation {
        bytes32 grantId;
        address provider;
        address evaluator;
        uint256 amount;
        uint256 jobExpiresAt;
        bytes32 workHash;
        bytes32 termsHash;
        uint8 status;
    }

    uint8 public constant STATUS_RESERVED = 1;
    uint8 public constant STATUS_FUNDED = 2;
    uint8 public constant STATUS_SETTLED = 3;
    uint8 public constant STATUS_REFUNDED = 4;
    uint8 public constant STATUS_CANCELLED = 5;
    uint8 public constant MAX_GRANT_DEPTH = 2;
    bytes32 public constant ROOT_GRANT_ID = keccak256("AGENT_COMMITMENTS_ROOT");
    bytes32 private constant QUOTE_TYPEHASH = keccak256(
        "Quote(bytes32 grantId,bytes32 operationId,address provider,address evaluator,address token,address adapter,uint256 amount,uint256 quoteExpiresAt,uint256 jobExpiresAt,bytes32 workHash,bytes32 nonce)"
    );

    IERC20 public immutable token;
    address public immutable owner;
    uint256 public immutable depositCap;
    uint256 public immutable maxCommitmentAmount;
    uint256 public immutable maxConcurrentCommitments;
    address public adapter;
    bool public paused;
    uint256 public activeCommitments;
    Ledger private _ledger;
    mapping(bytes32 => Grant) private _grants;
    mapping(bytes32 => Reservation) private _reservations;
    mapping(bytes32 => mapping(address => bool)) private _allowedProviders;
    mapping(bytes32 => mapping(address => bool)) private _allowedEvaluators;

    event Deposited(address indexed sender, uint256 amount);
    event GrantCreated(
        bytes32 indexed grantId,
        bytes32 indexed parentId,
        address indexed grantee,
        uint256 cap,
        uint256 expiresAt,
        bytes32 providerAllowlistHash,
        bytes32 evaluatorAllowlistHash
    );
    event GrantRevoked(bytes32 indexed grantId);
    event Reserved(bytes32 indexed commitmentId, bytes32 indexed grantId, bytes32 indexed operationId, uint256 amount);
    event ReservationCancelled(bytes32 indexed commitmentId);
    event ReservationFunded(bytes32 indexed commitmentId, uint256 amount);
    event CommitmentSettled(bytes32 indexed commitmentId, uint256 amount);
    event CommitmentRefunded(bytes32 indexed commitmentId, uint256 amount);
    event Withdrawn(address indexed recipient, uint256 amount);
    event PauseChanged(bool paused);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
    modifier onlyAdapter() {
        if (msg.sender != adapter || adapter == address(0)) revert Unauthorized();
        _;
    }

    constructor(
        address tokenAddress,
        address ownerAddress,
        uint256 rootExpiresAt,
        uint256 depositCapValue,
        uint256 maxCommitmentAmountValue,
        uint256 maxConcurrentCommitmentsValue
    ) EIP712("AgentCommitments", "1") {
        if (tokenAddress == address(0) || ownerAddress == address(0) || rootExpiresAt <= block.timestamp) {
            revert InvalidGrant();
        }
        if (
            depositCapValue == 0 || maxCommitmentAmountValue == 0 || maxCommitmentAmountValue > depositCapValue
                || maxConcurrentCommitmentsValue == 0
        ) revert InvalidAmount();
        if (IERC20Metadata(tokenAddress).decimals() != 6) revert InvalidToken();
        token = IERC20(tokenAddress);
        owner = ownerAddress;
        depositCap = depositCapValue;
        maxCommitmentAmount = maxCommitmentAmountValue;
        maxConcurrentCommitments = maxConcurrentCommitmentsValue;
        _grants[ROOT_GRANT_ID] =
            Grant(bytes32(0), ownerAddress, depositCapValue, rootExpiresAt, 0, 0, 0, false, true, 0, false, false);
    }

    function setAdapter(address adapterAddress) external onlyOwner {
        if (adapterAddress == address(0)) revert Unauthorized();
        if (adapter != address(0)) revert AdapterAlreadySet();
        adapter = adapterAddress;
    }

    function createGrant(
        bytes32 grantId,
        bytes32 parentId,
        address grantee,
        uint256 cap,
        uint256 expiresAt,
        address[] calldata providers,
        address[] calldata evaluators
    ) external onlyOwner {
        if (grantId == bytes32(0) || grantee == address(0) || cap == 0 || _grants[grantId].exists) {
            revert InvalidGrant();
        }
        Grant storage parent = _grants[parentId];
        if (!parent.exists || parent.revoked || parent.depth >= MAX_GRANT_DEPTH) revert InvalidDelegation();
        if (cap > parent.cap || expiresAt > parent.expiresAt || expiresAt <= block.timestamp) {
            revert InvalidDelegation();
        }
        if (
            (parent.providerRestricted && providers.length == 0)
                || (parent.evaluatorRestricted && evaluators.length == 0)
        ) {
            revert InvalidDelegation();
        }
        _grants[grantId] = Grant(
            parentId,
            grantee,
            cap,
            expiresAt,
            0,
            0,
            0,
            false,
            true,
            parent.depth + 1,
            providers.length != 0,
            evaluators.length != 0
        );
        for (uint256 i; i < providers.length; ++i) {
            address provider = providers[i];
            if (provider == address(0) || (parent.providerRestricted && !_allowedProviders[parentId][provider])) {
                revert InvalidDelegation();
            }
            _allowedProviders[grantId][provider] = true;
        }
        for (uint256 i; i < evaluators.length; ++i) {
            address evaluator = evaluators[i];
            if (evaluator == address(0) || (parent.evaluatorRestricted && !_allowedEvaluators[parentId][evaluator])) {
                revert InvalidDelegation();
            }
            _allowedEvaluators[grantId][evaluator] = true;
        }
        emit GrantCreated(
            grantId,
            parentId,
            grantee,
            cap,
            expiresAt,
            keccak256(abi.encode(providers)),
            keccak256(abi.encode(evaluators))
        );
    }

    function revokeGrant(bytes32 grantId) external onlyOwner {
        Grant storage grant = _requireGrant(grantId);
        if (grantId == ROOT_GRANT_ID) revert InvalidGrant();
        grant.revoked = true;
        emit GrantRevoked(grantId);
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (_ledger.deposited + amount > depositCap) revert DepositCapExceeded();
        token.safeTransferFrom(msg.sender, address(this), amount);
        _ledger.deposited += amount;
        _ledger.available += amount;
        emit Deposited(msg.sender, amount);
    }

    function reserve(ReservationInput calldata input, bytes calldata providerSignature)
        external
        nonReentrant
        returns (bytes32 id)
    {
        Grant storage leaf = _requireGrant(input.grantId);
        if (msg.sender != leaf.grantee) revert Unauthorized();
        id = commitmentId(input.grantId, input.operationId);
        bytes32 termsHash = keccak256(abi.encode(input));
        Reservation storage existing = _reservations[id];
        if (existing.status != 0) {
            if (existing.termsHash != termsHash) revert CommitmentConflict();
            return id;
        }
        if (paused) revert Paused();
        if (input.amount == 0 || input.provider == address(0) || input.evaluator == address(0)) revert InvalidAmount();
        if (input.token != address(token)) revert InvalidToken();
        if (adapter == address(0) || input.adapter != adapter) revert InvalidQuote();
        if (input.amount > maxCommitmentAmount) revert CommitmentAmountExceeded();
        if (activeCommitments >= maxConcurrentCommitments) revert ConcurrentCommitmentLimitExceeded();
        if (input.quoteExpiresAt <= block.timestamp || input.jobExpiresAt <= input.quoteExpiresAt) {
            revert InvalidDeadline();
        }
        if (ECDSA.recover(quoteDigest(input), providerSignature) != input.provider) revert InvalidQuote();
        if (_ledger.available < input.amount) revert InsufficientAvailable();
        _applyReserve(input.grantId, input.provider, input.evaluator, input.amount);
        _ledger.available -= input.amount;
        _ledger.reserved += input.amount;
        activeCommitments += 1;
        _reservations[id] = Reservation(
            input.grantId,
            input.provider,
            input.evaluator,
            input.amount,
            input.jobExpiresAt,
            input.workHash,
            termsHash,
            STATUS_RESERVED
        );
        emit Reserved(id, input.grantId, input.operationId, input.amount);
    }

    function cancelReservation(bytes32 id) external nonReentrant {
        Reservation storage reservation = _reservations[id];
        if (reservation.status != STATUS_RESERVED) revert InvalidCommitmentState();
        Grant storage leaf = _grants[reservation.grantId];
        if (msg.sender != owner && msg.sender != leaf.grantee && block.timestamp < reservation.jobExpiresAt) {
            revert Unauthorized();
        }
        _applyCancel(reservation.grantId, reservation.amount);
        _ledger.reserved -= reservation.amount;
        _ledger.available += reservation.amount;
        reservation.status = STATUS_CANCELLED;
        activeCommitments -= 1;
        emit ReservationCancelled(id);
    }

    function consumeReservation(bytes32 id)
        external
        onlyAdapter
        nonReentrant
        returns (
            address provider,
            address evaluator,
            uint256 amount,
            uint256 jobExpiresAt,
            bytes32 workHash,
            bytes32 termsHash
        )
    {
        if (paused) revert Paused();
        Reservation storage reservation = _reservations[id];
        if (reservation.status != STATUS_RESERVED) revert InvalidCommitmentState();
        Grant storage leaf = _grants[reservation.grantId];
        if (leaf.revoked) revert GrantIsRevoked();
        if (block.timestamp >= leaf.expiresAt || block.timestamp >= reservation.jobExpiresAt) revert GrantExpired();
        _applyFund(reservation.grantId, reservation.amount);
        _ledger.reserved -= reservation.amount;
        _ledger.inEscrow += reservation.amount;
        reservation.status = STATUS_FUNDED;
        token.safeTransfer(msg.sender, reservation.amount);
        emit ReservationFunded(id, reservation.amount);
        return (
            reservation.provider,
            reservation.evaluator,
            reservation.amount,
            reservation.jobExpiresAt,
            reservation.workHash,
            reservation.termsHash
        );
    }

    function reconcileCompleted(bytes32 id) external onlyAdapter {
        Reservation storage reservation = _reservations[id];
        if (reservation.status != STATUS_FUNDED) revert InvalidCommitmentState();
        _applySettle(reservation.grantId, reservation.amount);
        _ledger.inEscrow -= reservation.amount;
        _ledger.settled += reservation.amount;
        reservation.status = STATUS_SETTLED;
        activeCommitments -= 1;
        emit CommitmentSettled(id, reservation.amount);
    }

    function recordRefund(bytes32 id) external onlyAdapter nonReentrant {
        Reservation storage reservation = _reservations[id];
        if (reservation.status != STATUS_FUNDED) revert InvalidCommitmentState();
        token.safeTransferFrom(msg.sender, address(this), reservation.amount);
        _applyRefund(reservation.grantId, reservation.amount);
        _ledger.inEscrow -= reservation.amount;
        _ledger.available += reservation.amount;
        reservation.status = STATUS_REFUNDED;
        activeCommitments -= 1;
        emit CommitmentRefunded(id, reservation.amount);
    }

    function withdrawAvailable(address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0) || amount == 0) revert InvalidAmount();
        if (_ledger.available < amount) revert InsufficientAvailable();
        _ledger.available -= amount;
        _ledger.withdrawn += amount;
        token.safeTransfer(recipient, amount);
        emit Withdrawn(recipient, amount);
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PauseChanged(value);
    }

    function ledger() external view returns (Ledger memory) {
        return _ledger;
    }

    function grants(bytes32 id) external view returns (Grant memory) {
        return _grants[id];
    }

    function reservations(bytes32 id) external view returns (Reservation memory) {
        return _reservations[id];
    }

    function isProviderAllowed(bytes32 grantId, address provider) external view returns (bool) {
        return _isAllowed(grantId, provider, true);
    }

    function isEvaluatorAllowed(bytes32 grantId, address evaluator) external view returns (bool) {
        return _isAllowed(grantId, evaluator, false);
    }

    function commitmentId(bytes32 grantId, bytes32 operationId) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), grantId, operationId));
    }

    function quoteDigest(ReservationInput calldata input) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    QUOTE_TYPEHASH,
                    input.grantId,
                    input.operationId,
                    input.provider,
                    input.evaluator,
                    input.token,
                    input.adapter,
                    input.amount,
                    input.quoteExpiresAt,
                    input.jobExpiresAt,
                    input.workHash,
                    input.nonce
                )
            )
        );
    }

    function _applyReserve(bytes32 grantId, address provider, address evaluator, uint256 amount) private {
        bytes32 current = grantId;
        while (current != bytes32(0)) {
            Grant storage grant = _requireGrant(current);
            if (grant.revoked) revert GrantIsRevoked();
            if (block.timestamp >= grant.expiresAt) revert GrantExpired();
            if (grant.providerRestricted && !_allowedProviders[current][provider]) revert ProviderNotAllowed();
            if (grant.evaluatorRestricted && !_allowedEvaluators[current][evaluator]) revert EvaluatorNotAllowed();
            if (grant.reserved + grant.inEscrow + grant.grossSpent + amount > grant.cap) revert CapExceeded();
            grant.reserved += amount;
            current = grant.parentId;
        }
    }

    function _applyCancel(bytes32 grantId, uint256 amount) private {
        bytes32 current = grantId;
        while (current != bytes32(0)) {
            Grant storage grant = _grants[current];
            grant.reserved -= amount;
            current = grant.parentId;
        }
    }

    function _applyFund(bytes32 grantId, uint256 amount) private {
        bytes32 current = grantId;
        while (current != bytes32(0)) {
            Grant storage grant = _grants[current];
            if (grant.revoked) revert GrantIsRevoked();
            if (block.timestamp >= grant.expiresAt) revert GrantExpired();
            grant.reserved -= amount;
            grant.inEscrow += amount;
            current = grant.parentId;
        }
    }

    function _applySettle(bytes32 grantId, uint256 amount) private {
        bytes32 current = grantId;
        while (current != bytes32(0)) {
            Grant storage grant = _grants[current];
            grant.inEscrow -= amount;
            grant.grossSpent += amount;
            current = grant.parentId;
        }
    }

    function _applyRefund(bytes32 grantId, uint256 amount) private {
        bytes32 current = grantId;
        while (current != bytes32(0)) {
            Grant storage grant = _grants[current];
            grant.inEscrow -= amount;
            current = grant.parentId;
        }
    }

    function _requireGrant(bytes32 id) private view returns (Grant storage grant) {
        grant = _grants[id];
        if (!grant.exists) revert InvalidGrant();
    }

    function _isAllowed(bytes32 grantId, address account, bool providerPolicy) private view returns (bool) {
        bytes32 current = grantId;
        while (current != bytes32(0)) {
            Grant storage grant = _grants[current];
            if (!grant.exists) return false;
            if (providerPolicy) {
                if (grant.providerRestricted && !_allowedProviders[current][account]) return false;
            } else if (grant.evaluatorRestricted && !_allowedEvaluators[current][account]) {
                return false;
            }
            current = grant.parentId;
        }
        return true;
    }
}
