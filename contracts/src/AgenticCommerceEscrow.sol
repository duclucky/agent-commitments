// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAgenticCommerceDraft} from "./interfaces/IAgenticCommerceDraft.sol";

/// @notice Non-upgradeable, zero-fee, non-hooked escrow candidate pinned to the 2026-10-12 ERC-8183 draft.
/// @dev Only six-decimal payment tokens are accepted. Direct token transfers are excess, never job credit.
contract AgenticCommerceEscrow is IAgenticCommerceDraft, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error InvalidAddress();
    error InvalidToken();
    error InvalidJob();
    error InvalidState();
    error InvalidAmount();
    error Unauthorized();
    error BudgetMismatch();
    error UnsupportedHook();
    error NewObligationsPaused();
    error InsufficientExcess();

    IERC20 public immutable paymentToken;
    address public immutable owner;
    uint256 public nextJobId = 1;
    uint256 public totalEscrowed;
    bool public paused;

    mapping(uint256 => Job) private _jobs;
    mapping(uint256 => bytes32) public deliverables;

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        uint256 expiredAt,
        address hook
    );
    event ProviderSet(uint256 indexed jobId, address indexed provider);
    event BudgetSet(uint256 indexed jobId, uint256 amount);
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable);
    event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
    event JobExpired(uint256 indexed jobId);
    event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event PauseChanged(bool paused);
    event ExcessWithdrawn(address indexed recipient, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier whenAcceptingNewObligations() {
        if (paused) revert NewObligationsPaused();
        _;
    }

    constructor(address paymentTokenAddress, address ownerAddress) {
        if (paymentTokenAddress == address(0) || ownerAddress == address(0)) revert InvalidAddress();
        if (IERC20Metadata(paymentTokenAddress).decimals() != 6) revert InvalidToken();
        paymentToken = IERC20(paymentTokenAddress);
        owner = ownerAddress;
    }

    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external whenAcceptingNewObligations returns (uint256 jobId) {
        if (evaluator == address(0) || expiredAt <= block.timestamp) revert InvalidJob();
        if (hook != address(0)) revert UnsupportedHook();
        jobId = nextJobId++;
        _jobs[jobId] = Job(jobId, msg.sender, provider, evaluator, description, 0, expiredAt, Status.Open, address(0));
        emit JobCreated(jobId, msg.sender, provider, evaluator, expiredAt, address(0));
    }

    function setProvider(uint256 jobId, address provider, bytes calldata) external whenAcceptingNewObligations {
        Job storage job = _job(jobId);
        if (job.status != Status.Open || job.provider != address(0)) revert InvalidState();
        if (msg.sender != job.client) revert Unauthorized();
        if (provider == address(0)) revert InvalidAddress();
        job.provider = provider;
        emit ProviderSet(jobId, provider);
    }

    function setBudget(uint256 jobId, uint256 amount, bytes calldata) external whenAcceptingNewObligations {
        Job storage job = _job(jobId);
        if (job.status != Status.Open || block.timestamp >= job.expiredAt) revert InvalidState();
        if (msg.sender != job.client && msg.sender != job.provider) revert Unauthorized();
        if (amount == 0) revert InvalidAmount();
        job.budget = amount;
        emit BudgetSet(jobId, amount);
    }

    function fund(uint256 jobId, uint256 expectedBudget, bytes calldata)
        external
        nonReentrant
        whenAcceptingNewObligations
    {
        Job storage job = _job(jobId);
        if (job.status != Status.Open || block.timestamp >= job.expiredAt) revert InvalidState();
        if (msg.sender != job.client) revert Unauthorized();
        if (job.provider == address(0) || job.budget == 0) revert InvalidJob();
        if (job.budget != expectedBudget) revert BudgetMismatch();
        uint256 balanceBefore = paymentToken.balanceOf(address(this));
        job.status = Status.Funded;
        totalEscrowed += expectedBudget;
        paymentToken.safeTransferFrom(job.client, address(this), expectedBudget);
        if (paymentToken.balanceOf(address(this)) != balanceBefore + expectedBudget) revert InvalidAmount();
        emit JobFunded(jobId, job.client, expectedBudget);
    }

    function submit(uint256 jobId, bytes32 deliverable, bytes calldata) external {
        Job storage job = _job(jobId);
        if (job.status != Status.Funded) revert InvalidState();
        if (msg.sender != job.provider) revert Unauthorized();
        deliverables[jobId] = deliverable;
        job.status = Status.Submitted;
        emit JobSubmitted(jobId, job.provider, deliverable);
    }

    function complete(uint256 jobId, bytes32 reason, bytes calldata) external nonReentrant {
        Job storage job = _job(jobId);
        if (job.status != Status.Submitted) revert InvalidState();
        if (msg.sender != job.evaluator) revert Unauthorized();
        uint256 amount = job.budget;
        job.status = Status.Completed;
        totalEscrowed -= amount;
        paymentToken.safeTransfer(job.provider, amount);
        emit JobCompleted(jobId, job.evaluator, reason);
        emit PaymentReleased(jobId, job.provider, amount);
    }

    function reject(uint256 jobId, bytes32 reason, bytes calldata) external nonReentrant {
        Job storage job = _job(jobId);
        Status previous = job.status;
        if (previous == Status.Open) {
            if (msg.sender != job.client) revert Unauthorized();
        } else if (previous == Status.Funded || previous == Status.Submitted) {
            if (msg.sender != job.evaluator) revert Unauthorized();
        } else {
            revert InvalidState();
        }
        job.status = Status.Rejected;
        if (previous == Status.Funded || previous == Status.Submitted) {
            totalEscrowed -= job.budget;
            paymentToken.safeTransfer(job.client, job.budget);
            emit Refunded(jobId, job.client, job.budget);
        }
        emit JobRejected(jobId, msg.sender, reason);
    }

    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        if ((job.status != Status.Funded && job.status != Status.Submitted) || block.timestamp < job.expiredAt) {
            revert InvalidState();
        }
        job.status = Status.Expired;
        totalEscrowed -= job.budget;
        paymentToken.safeTransfer(job.client, job.budget);
        emit Refunded(jobId, job.client, job.budget);
        emit JobExpired(jobId);
    }

    function getJob(uint256 jobId) external view returns (Job memory job) {
        return _job(jobId);
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PauseChanged(value);
    }

    /// @notice Recovers only tokens that were sent directly and are not backing funded jobs.
    function withdrawExcess(address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0) || amount == 0) revert InvalidAmount();
        uint256 balance = paymentToken.balanceOf(address(this));
        if (balance < totalEscrowed || amount > balance - totalEscrowed) revert InsufficientExcess();
        paymentToken.safeTransfer(recipient, amount);
        emit ExcessWithdrawn(recipient, amount);
    }

    function _job(uint256 jobId) private view returns (Job storage job) {
        job = _jobs[jobId];
        if (job.id == 0) revert InvalidJob();
    }
}
