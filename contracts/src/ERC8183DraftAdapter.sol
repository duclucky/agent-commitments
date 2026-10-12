// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BudgetVault} from "./BudgetVault.sol";
import {IAgenticCommerceDraft} from "./interfaces/IAgenticCommerceDraft.sol";

interface IPaymentTokenEscrow {
    function paymentToken() external view returns (address);
}

/// @notice Adapter pinned to the ERC-8183 draft interface reviewed on 2026-10-12.
/// @dev Kept separate from ERC8183Adapter, which is pinned to the older Arc Testnet reference ABI.
contract ERC8183DraftAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error InvalidAddress();
    error AlreadyDispatched();
    error NotDispatched();
    error NotTerminal();
    error BindingMismatch();
    error NewObligationsPaused();
    error GrantInactive();

    BudgetVault public immutable vault;
    IAgenticCommerceDraft public immutable escrow;
    IERC20 public immutable token;
    mapping(bytes32 => uint256) public jobs;

    event Dispatched(bytes32 indexed commitmentId, uint256 indexed jobId, uint256 amount);
    event Funded(bytes32 indexed commitmentId, uint256 indexed jobId, uint256 amount);
    event Reconciled(bytes32 indexed commitmentId, uint256 indexed jobId, IAgenticCommerceDraft.Status status);

    constructor(address vaultAddress, address escrowAddress, address tokenAddress) {
        if (vaultAddress == address(0) || escrowAddress == address(0) || tokenAddress == address(0)) {
            revert InvalidAddress();
        }
        vault = BudgetVault(vaultAddress);
        escrow = IAgenticCommerceDraft(escrowAddress);
        token = IERC20(tokenAddress);
        if (
            address(BudgetVault(vaultAddress).token()) != tokenAddress
                || IPaymentTokenEscrow(escrowAddress).paymentToken() != tokenAddress
        ) revert BindingMismatch();
    }

    function dispatch(bytes32 commitmentId) external nonReentrant returns (uint256 jobId) {
        if (jobs[commitmentId] != 0) revert AlreadyDispatched();
        if (vault.paused()) revert NewObligationsPaused();
        BudgetVault.Reservation memory reservation = vault.reservations(commitmentId);
        if (reservation.status != vault.STATUS_RESERVED()) revert BindingMismatch();

        _requireActiveGrantAncestry(reservation.grantId);
        if (block.timestamp >= reservation.jobExpiresAt) revert GrantInactive();

        jobId = escrow.createJob(
            reservation.provider,
            reservation.evaluator,
            reservation.jobExpiresAt,
            _toHex(reservation.termsHash),
            address(0)
        );
        IAgenticCommerceDraft.Job memory job = escrow.getJob(jobId);
        if (
            jobId == 0 || job.id != jobId || job.client != address(this) || job.provider != reservation.provider
                || job.evaluator != reservation.evaluator || job.budget != 0
                || job.expiredAt != reservation.jobExpiresAt || job.status != IAgenticCommerceDraft.Status.Open
                || job.hook != address(0)
        ) revert BindingMismatch();
        jobs[commitmentId] = jobId;
        emit Dispatched(commitmentId, jobId, reservation.amount);
    }

    function fund(bytes32 commitmentId) external nonReentrant {
        if (vault.paused()) revert NewObligationsPaused();
        uint256 jobId = jobs[commitmentId];
        if (jobId == 0) revert NotDispatched();
        BudgetVault.Reservation memory reservation = vault.reservations(commitmentId);
        if (reservation.status != vault.STATUS_RESERVED()) revert BindingMismatch();
        IAgenticCommerceDraft.Job memory job = escrow.getJob(jobId);
        if (
            job.id != jobId || job.client != address(this) || job.provider != reservation.provider
                || job.evaluator != reservation.evaluator || job.budget != reservation.amount
                || job.expiredAt != reservation.jobExpiresAt || job.status != IAgenticCommerceDraft.Status.Open
                || job.hook != address(0)
        ) revert BindingMismatch();

        (address provider, address evaluator, uint256 amount, uint256 expiredAt, bytes32 workHash, bytes32 termsHash) =
            vault.consumeReservation(commitmentId);
        if (
            provider != reservation.provider || evaluator != reservation.evaluator || amount != reservation.amount
                || expiredAt != reservation.jobExpiresAt || workHash != reservation.workHash
                || termsHash != reservation.termsHash
        ) revert BindingMismatch();
        token.forceApprove(address(escrow), amount);
        escrow.fund(jobId, amount, "");
        token.forceApprove(address(escrow), 0);

        job = escrow.getJob(jobId);
        if (
            job.id != jobId || job.client != address(this) || job.provider != provider || job.evaluator != evaluator
                || job.budget != amount || job.expiredAt != expiredAt
                || job.status != IAgenticCommerceDraft.Status.Funded || job.hook != address(0)
        ) revert BindingMismatch();
        emit Funded(commitmentId, jobId, amount);
    }

    function reconcile(bytes32 commitmentId) external nonReentrant {
        uint256 jobId = jobs[commitmentId];
        if (jobId == 0) revert NotDispatched();
        IAgenticCommerceDraft.Job memory job = escrow.getJob(jobId);
        BudgetVault.Reservation memory reservation = vault.reservations(commitmentId);
        if (
            job.id != jobId || job.client != address(this) || job.provider != reservation.provider
                || job.evaluator != reservation.evaluator || job.budget != reservation.amount
                || job.expiredAt != reservation.jobExpiresAt || job.hook != address(0)
        ) revert BindingMismatch();

        if (job.status == IAgenticCommerceDraft.Status.Completed) {
            vault.reconcileCompleted(commitmentId);
        } else if (
            job.status == IAgenticCommerceDraft.Status.Rejected || job.status == IAgenticCommerceDraft.Status.Expired
        ) {
            token.forceApprove(address(vault), reservation.amount);
            vault.recordRefund(commitmentId);
            token.forceApprove(address(vault), 0);
        } else {
            revert NotTerminal();
        }
        emit Reconciled(commitmentId, jobId, job.status);
    }

    function _toHex(bytes32 value) private pure returns (string memory) {
        bytes16 symbols = "0123456789abcdef";
        bytes memory output = new bytes(66);
        output[0] = "0";
        output[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(value[i]);
            output[2 + i * 2] = symbols[b >> 4];
            output[3 + i * 2] = symbols[b & 0x0f];
        }
        return string(output);
    }

    function _requireActiveGrantAncestry(bytes32 grantId) private view {
        bytes32 current = grantId;
        while (current != bytes32(0)) {
            BudgetVault.Grant memory grant = vault.grants(current);
            if (!grant.exists || grant.revoked || block.timestamp >= grant.expiresAt) revert GrantInactive();
            current = grant.parentId;
        }
    }
}
