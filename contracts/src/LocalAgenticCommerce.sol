// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAgenticCommerce} from "./interfaces/IAgenticCommerce.sol";

/// @notice Local reference used to exercise the ERC-8183 lifecycle without a network deployment.
/// @dev Implements only the subset consumed by the adapter; this is not an audit or conformance claim.
contract LocalAgenticCommerce is IAgenticCommerce, ReentrancyGuard {
    using SafeERC20 for IERC20;
    error Unauthorized();
    error InvalidState();
    error InvalidJob();
    error InvalidBudget();

    IERC20 public immutable token;
    uint256 public nextJobId = 1;
    mapping(uint256 => Job) private _jobs;
    mapping(uint256 => bytes32) public deliverables;

    constructor(address tokenAddress) {
        token = IERC20(tokenAddress);
    }

    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256 jobId) {
        if (provider == address(0) || evaluator == address(0) || expiredAt <= block.timestamp || hook != address(0)) revert InvalidJob();
        jobId = nextJobId++;
        _jobs[jobId] = Job(jobId, msg.sender, provider, evaluator, description, 0, expiredAt, Status.Open, hook);
    }

    function setBudget(uint256 jobId, uint256 amount, bytes calldata) external {
        Job storage job = _job(jobId);
        if (job.status != Status.Open) revert InvalidState();
        if (msg.sender != job.provider) revert Unauthorized();
        if (amount == 0) revert InvalidBudget();
        job.budget = amount;
    }

    function fund(uint256 jobId, bytes calldata) external nonReentrant {
        Job storage job = _job(jobId);
        if (job.status != Status.Open || msg.sender != job.client) revert InvalidState();
        if (job.budget == 0) revert InvalidBudget();
        token.safeTransferFrom(msg.sender, address(this), job.budget);
        job.status = Status.Funded;
    }

    function submit(uint256 jobId, bytes32 deliverable, bytes calldata) external {
        Job storage job = _job(jobId);
        if (job.status != Status.Funded || msg.sender != job.provider) revert InvalidState();
        deliverables[jobId] = deliverable;
        job.status = Status.Submitted;
    }

    function complete(uint256 jobId, bytes32, bytes calldata) external nonReentrant {
        Job storage job = _job(jobId);
        if (job.status != Status.Submitted || msg.sender != job.evaluator) revert InvalidState();
        job.status = Status.Completed;
        token.safeTransfer(job.provider, job.budget);
    }

    function reject(uint256 jobId, bytes32, bytes calldata) external nonReentrant {
        Job storage job = _job(jobId);
        if (job.status == Status.Open) {
            if (msg.sender != job.client) revert Unauthorized();
            job.status = Status.Rejected;
            return;
        }
        if ((job.status != Status.Funded && job.status != Status.Submitted) || msg.sender != job.evaluator) {
            revert InvalidState();
        }
        job.status = Status.Rejected;
        token.safeTransfer(job.client, job.budget);
    }

    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        if ((job.status != Status.Funded && job.status != Status.Submitted) || block.timestamp < job.expiredAt) {
            revert InvalidState();
        }
        job.status = Status.Expired;
        token.safeTransfer(job.client, job.budget);
    }

    function getJob(uint256 jobId) external view returns (Job memory job) {
        return _job(jobId);
    }

    function _job(uint256 jobId) private view returns (Job storage job) {
        job = _jobs[jobId];
        if (job.client == address(0)) revert InvalidJob();
    }
}
