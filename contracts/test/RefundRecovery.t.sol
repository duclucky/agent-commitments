// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {BudgetVault} from "../src/BudgetVault.sol";
import {AgenticCommerceEscrow} from "../src/AgenticCommerceEscrow.sol";
import {ERC8183DraftAdapter} from "../src/ERC8183DraftAdapter.sol";
import {IAgenticCommerceDraft} from "../src/interfaces/IAgenticCommerceDraft.sol";
import {MockUSDC, Assertions, Sig} from "./TestSupport.sol";

contract ToggleBlockedUSDC is MockUSDC {
    mapping(address => bool) public blocked;

    function setBlocked(address account, bool value) external {
        blocked[account] = value;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(!blocked[msg.sender] && !blocked[to], "blocked");
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(!blocked[from] && !blocked[to], "blocked");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }
}

/// @notice Local-only refund recovery regression tests; never used on a shared chain.
/// @notice A local-only ERC-1271 fixture; current vault deliberately uses ECDSA recovery instead.
contract Local1271Provider {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }
}

contract RefundRecoveryTest is Assertions {
    ToggleBlockedUSDC private token;
    BudgetVault private vault;
    AgenticCommerceEscrow private escrow;
    ERC8183DraftAdapter private adapter;
    uint256 private providerKey = 0xB0B;
    address private provider;
    address private evaluator = address(0xE1);

    function setUp() public {
        provider = vm.addr(providerKey);
        token = new ToggleBlockedUSDC();
        vault = new BudgetVault(address(token), address(this), block.timestamp + 30 days, 100e6, 100e6, 4);
        escrow = new AgenticCommerceEscrow(address(token), address(this));
        adapter = new ERC8183DraftAdapter(address(vault), address(escrow), address(token));
        vault.setAdapter(address(adapter));
        token.mint(address(this), 110e6);
        token.approve(address(vault), 100e6);
        vault.deposit(100e6);
    }

    function testOrphanRemainsOpenAfterExpiryAndCannotFund() public {
        bytes32 id = _reserve();
        uint256 jobId = adapter.dispatch(id);
        vault.cancelReservation(id);
        vm.prank(provider);
        escrow.setBudget(jobId, 10e6, "");
        (bool fundOk,) = address(adapter).call(abi.encodeCall(adapter.fund, (id)));
        assertTrue(!fundOk, "cancelled reservation cannot fund even after provider sets price");
        vm.warp(escrow.getJob(jobId).expiredAt);
        (bool refundOk,) = address(escrow).call(abi.encodeCall(escrow.claimRefund, (jobId)));
        assertTrue(!refundOk, "claimRefund does not expire unfunded Open jobs");
        assertEq(
            uint256(escrow.getJob(jobId).status), uint256(IAgenticCommerceDraft.Status.Open), "Open state persists"
        );
        assertEq(vault.ledger().available, 100e6, "available restored");
        assertEq(token.balanceOf(address(escrow)), 0, "no funds locked in orphan");
    }

    function testBlocklistRetainsObligationAndRecoveryResumesAfterUnblock() public {
        bytes32 id = _reserve();
        uint256 jobId = adapter.dispatch(id);
        vm.prank(provider);
        escrow.setBudget(jobId, 10e6, "");
        adapter.fund(id);
        vm.prank(evaluator);
        escrow.reject(jobId, bytes32(0), "");
        token.setBlocked(address(adapter), true);
        (bool ok,) = address(adapter).call(abi.encodeCall(adapter.reconcile, (id)));
        assertTrue(!ok, "blocked token transfer prevents reconcile");
        assertEq(vault.ledger().inEscrow, 10e6, "failed reconcile preserves obligation");
        assertEq(token.balanceOf(address(adapter)), 10e6, "returned funds retained at adapter");
        token.setBlocked(address(adapter), false);
        adapter.reconcile(id);
        assertEq(vault.ledger().available, 100e6, "recovery restores available after issuer unblock");
        assertEq(vault.ledger().inEscrow, 0, "obligation reconciled");
        (bool repeated,) = address(adapter).call(abi.encodeCall(adapter.reconcile, (id)));
        assertTrue(!repeated, "retry cannot refund twice");
    }

    function testDirectTransferRemainsAfterAllAvailableWithdrawn() public {
        token.transfer(address(vault), 5e6);
        vault.withdrawAvailable(address(this), 100e6);
        assertEq(vault.ledger().available, 0, "only deposit-based available can be withdrawn");
        assertEq(token.balanceOf(address(vault)), 5e6, "direct transfer remains unassigned");
        (bool excessOk,) = address(vault).call(abi.encodeCall(vault.withdrawAvailable, (address(this), 1)));
        assertTrue(!excessOk, "cannot recover direct donation through withdrawAvailable");
    }

    function testDifferentNonceForSameOperationConflictsRatherThanCreatingSecondReservation() public {
        bytes32 first = _reserve();
        BudgetVault.ReservationInput memory changed = _input();
        changed.nonce = keccak256("different-nonce");
        bytes memory signature = Sig.sign(vm, providerKey, vault.quoteDigest(changed));
        (bool ok,) = address(vault).call(abi.encodeCall(vault.reserve, (changed, signature)));
        assertTrue(!ok, "same operation with changed nonce conflicts");
        assertEq(vault.activeCommitments(), 1, "no second reservation");
        assertEq(vault.ledger().reserved, 10e6, "money reserved once");
        assertEq(
            uint256(vault.reservations(first).status), uint256(vault.STATUS_RESERVED()), "original remains reserved"
        );
    }

    function testBlockedEscrowRefundRollsBackAndKeepsCommitmentActive() public {
        bytes32 id = _reserve();
        uint256 jobId = adapter.dispatch(id);
        vm.prank(provider);
        escrow.setBudget(jobId, 10e6, "");
        adapter.fund(id);
        token.setBlocked(address(escrow), true);
        vm.prank(evaluator);
        (bool rejected,) = address(escrow).call(abi.encodeCall(escrow.reject, (jobId, bytes32(0), "")));
        assertTrue(!rejected, "blocked refund cannot finalize rejection");
        assertEq(
            uint256(escrow.getJob(jobId).status), uint256(IAgenticCommerceDraft.Status.Funded), "status rolls back"
        );
        assertEq(escrow.totalEscrowed(), 10e6, "escrow obligation retained");
        assertEq(token.balanceOf(address(escrow)), 10e6, "funds remain physically in escrow");
        assertEq(vault.ledger().inEscrow, 10e6, "vault obligation retained");
        assertEq(vault.activeCommitments(), 1, "active slot remains occupied");
        (bool cancelled,) = address(vault).call(abi.encodeCall(vault.cancelReservation, (id)));
        assertTrue(!cancelled, "funded obligation cannot be released through cancel");
        token.setBlocked(address(escrow), false);
        vm.prank(evaluator);
        escrow.reject(jobId, bytes32(0), "");
        adapter.reconcile(id);
        vault.withdrawAvailable(address(this), 100e6);
        assertEq(vault.ledger().withdrawn, 100e6, "full backing withdrawn after real refund");
        assertEq(token.balanceOf(address(vault)), 0, "no recorded funds left in vault");
        assertEq(vault.activeCommitments(), 0, "recovery releases active slot once");
    }

    function testSettlementAndWithdrawRemainAvailableAfterBothPauses() public {
        bytes32 id = _reserve();
        uint256 jobId = adapter.dispatch(id);
        vm.prank(provider);
        escrow.setBudget(jobId, 10e6, "");
        adapter.fund(id);
        vault.setPaused(true);
        escrow.setPaused(true);
        vm.prank(provider);
        escrow.submit(jobId, keccak256("output"), "");
        vm.prank(evaluator);
        escrow.complete(jobId, keccak256("accepted"), "");
        adapter.reconcile(id);
        vault.withdrawAvailable(address(this), 90e6);
        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.settled, 10e6, "provider obligation completed");
        assertEq(value.withdrawn, 90e6, "owner recovers only available funds");
        assertEq(value.deposited, value.settled + value.withdrawn, "conserved after complete and withdraw");
        assertEq(token.balanceOf(provider), 10e6, "provider paid once");
        (bool twice,) = address(adapter).call(abi.encodeCall(adapter.reconcile, (id)));
        assertTrue(!twice, "settlement cannot be recorded twice");
    }

    function testContractProvider1271SignatureIsNotSupportedByCurrentVault() public {
        Local1271Provider contractProvider = new Local1271Provider();
        BudgetVault.ReservationInput memory input = _input();
        input.provider = address(contractProvider);
        bytes memory signature = Sig.sign(vm, providerKey, vault.quoteDigest(input));
        assertEq(
            uint256(uint32(contractProvider.isValidSignature(vault.quoteDigest(input), signature))),
            uint256(uint32(bytes4(0x1626ba7e))),
            "fixture reports ERC-1271 validity"
        );
        (bool reserved,) = address(vault).call(abi.encodeCall(vault.reserve, (input, signature)));
        assertTrue(!reserved, "ECDSA provider signature does not admit a contract wallet");
        assertEq(vault.activeCommitments(), 0, "no unsupported commitment created");
        assertEq(vault.ledger().available, 100e6, "funds remain available");
    }

    function _reserve() private returns (bytes32) {
        BudgetVault.ReservationInput memory input = _input();
        return vault.reserve(input, Sig.sign(vm, providerKey, vault.quoteDigest(input)));
    }

    function _input() private view returns (BudgetVault.ReservationInput memory) {
        return BudgetVault.ReservationInput({
            grantId: vault.ROOT_GRANT_ID(),
            operationId: keccak256("studio-triage"),
            provider: provider,
            evaluator: evaluator,
            token: address(token),
            adapter: address(adapter),
            amount: 10e6,
            quoteExpiresAt: block.timestamp + 1 days,
            jobExpiresAt: block.timestamp + 7 days,
            workHash: keccak256("triage-work"),
            nonce: keccak256("triage-nonce")
        });
    }
}
