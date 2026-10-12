// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {BudgetVault} from "../src/BudgetVault.sol";
import {AgenticCommerceEscrow} from "../src/AgenticCommerceEscrow.sol";
import {ERC8183DraftAdapter} from "../src/ERC8183DraftAdapter.sol";
import {IAgenticCommerceDraft} from "../src/interfaces/IAgenticCommerceDraft.sol";
import {MockUSDC, Assertions, Sig} from "./TestSupport.sol";

contract ERC8183DraftAdapterTest is Assertions {
    MockUSDC private token;
    BudgetVault private vault;
    AgenticCommerceEscrow private escrow;
    ERC8183DraftAdapter private adapter;
    uint256 private providerKey = 0xB0B;
    address private provider;
    address private evaluator = address(0xE1);
    bytes32 private grantId = keccak256("draft-agent");

    function setUp() public {
        provider = vm.addr(providerKey);
        token = new MockUSDC();
        vault = new BudgetVault(address(token), address(this), block.timestamp + 30 days, 100e6, 100e6, 4);
        escrow = new AgenticCommerceEscrow(address(token), address(this));
        adapter = new ERC8183DraftAdapter(address(vault), address(escrow), address(token));
        vault.setAdapter(address(adapter));
        vault.createGrant(
            grantId,
            vault.ROOT_GRANT_ID(),
            address(this),
            100e6,
            block.timestamp + 20 days,
            _single(provider),
            _single(evaluator)
        );
        token.mint(address(this), 100e6);
        token.approve(address(vault), 100e6);
        vault.deposit(100e6);
    }

    function testDispatchFundCompleteAndReconcileAgainstDraftBudgetBinding() public {
        bytes32 commitment = _reserve(keccak256("draft-complete"), 25e6);
        uint256 jobId = adapter.dispatch(commitment);
        vm.prank(provider);
        escrow.setBudget(jobId, 25e6, "");
        adapter.fund(commitment);

        assertEq(uint256(escrow.getJob(jobId).status), uint256(IAgenticCommerceDraft.Status.Funded), "funded");
        assertEq(token.allowance(address(adapter), address(escrow)), 0, "allowance cleared");
        vm.prank(provider);
        escrow.submit(jobId, keccak256("deliverable"), "");
        vm.prank(evaluator);
        escrow.complete(jobId, keccak256("accepted"), "");
        adapter.reconcile(commitment);

        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.settled, 25e6, "settled");
        assertEq(value.inEscrow, 0, "escrow cleared");
        assertEq(token.balanceOf(provider), 25e6, "provider paid");
        _assertConserved(value);
    }

    function testRefundAfterPauseAndRevocationRemainsRecoverable() public {
        bytes32 commitment = _reserve(keccak256("draft-refund"), 20e6);
        uint256 jobId = adapter.dispatch(commitment);
        vm.prank(provider);
        escrow.setBudget(jobId, 20e6, "");
        adapter.fund(commitment);
        vault.revokeGrant(grantId);
        vault.setPaused(true);
        escrow.setPaused(true);

        vm.prank(evaluator);
        escrow.reject(jobId, keccak256("rejected"), "");
        adapter.reconcile(commitment);

        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.available, 100e6, "refund available");
        assertEq(value.inEscrow, 0, "escrow cleared");
        assertEq(vault.activeCommitments(), 0, "slot released");
        _assertConserved(value);
    }

    function testDraftSelectorsArePinned() public pure {
        assertEq(
            uint256(uint32(IAgenticCommerceDraft.fund.selector)),
            uint256(uint32(bytes4(keccak256("fund(uint256,uint256,bytes)")))),
            "draft fund selector"
        );
        assertEq(
            uint256(uint32(IAgenticCommerceDraft.setProvider.selector)),
            uint256(uint32(bytes4(keccak256("setProvider(uint256,address,bytes)")))),
            "draft provider selector"
        );
    }

    function testPauseBetweenDispatchAndFundKeepsReservationRecoverable() public {
        bytes32 commitment = _reserve(keccak256("pause-before-fund"), 10e6);
        uint256 jobId = adapter.dispatch(commitment);
        vm.prank(provider);
        escrow.setBudget(jobId, 10e6, "");
        vault.setPaused(true);

        (bool funded,) = address(adapter).call(abi.encodeCall(adapter.fund, (commitment)));
        assertTrue(!funded, "vault pause blocks funding");
        BudgetVault.Reservation memory reservation = vault.reservations(commitment);
        assertEq(uint256(reservation.status), uint256(vault.STATUS_RESERVED()), "reservation remains reserved");
        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.reserved, 10e6, "reserved unchanged");
        assertEq(value.inEscrow, 0, "no external obligation");
    }

    function testConstructorRejectsEscrowWithDifferentToken() public {
        MockUSDC other = new MockUSDC();
        AgenticCommerceEscrow otherEscrow = new AgenticCommerceEscrow(address(other), address(this));
        try new ERC8183DraftAdapter(address(vault), address(otherEscrow), address(token)) returns (
            ERC8183DraftAdapter
        ) {
            revert("mismatched escrow token accepted");
        } catch {}
    }

    function testRevokedGrantCannotDispatchANewExternalJob() public {
        bytes32 commitment = _reserve(keccak256("revoked-dispatch"), 10e6);
        vault.revokeGrant(grantId);
        (bool ok,) = address(adapter).call(abi.encodeCall(adapter.dispatch, (commitment)));
        assertTrue(!ok, "revocation must block creating an external job");
        assertEq(escrow.nextJobId(), 1, "no external job created");
    }

    function testExpiredGrantCannotDispatchANewExternalJob() public {
        grantId = keccak256("short-lived-grant");
        vault.createGrant(
            grantId,
            vault.ROOT_GRANT_ID(),
            address(this),
            100e6,
            block.timestamp + 2 days,
            _single(provider),
            _single(evaluator)
        );
        bytes32 commitment = _reserve(keccak256("expired-grant-dispatch"), 10e6);
        vm.warp(vault.grants(grantId).expiresAt);
        (bool ok,) = address(adapter).call(abi.encodeCall(adapter.dispatch, (commitment)));
        assertTrue(!ok, "grant expiry must block creating an external job");
        assertEq(escrow.nextJobId(), 1, "no external job created");
    }

    function testRevokedAncestorCannotDispatchChildReservation() public {
        bytes32 parentId = grantId;
        grantId = keccak256("child-agent");
        vault.createGrant(
            grantId, parentId, address(this), 100e6, block.timestamp + 10 days, _single(provider), _single(evaluator)
        );
        bytes32 commitment = _reserve(keccak256("revoked-parent-dispatch"), 10e6);
        vault.revokeGrant(parentId);
        (bool ok,) = address(adapter).call(abi.encodeCall(adapter.dispatch, (commitment)));
        assertTrue(!ok, "ancestor revocation must block child dispatch");
        assertEq(escrow.nextJobId(), 1, "no external job created");
    }

    function _reserve(bytes32 operationId, uint256 amount) private returns (bytes32) {
        BudgetVault.ReservationInput memory input = BudgetVault.ReservationInput({
            grantId: grantId,
            operationId: operationId,
            provider: provider,
            evaluator: evaluator,
            token: address(token),
            adapter: address(adapter),
            amount: amount,
            quoteExpiresAt: block.timestamp + 1 days,
            jobExpiresAt: block.timestamp + 7 days,
            workHash: keccak256(abi.encode(operationId)),
            nonce: keccak256(abi.encodePacked(operationId, "nonce"))
        });
        return vault.reserve(input, Sig.sign(vm, providerKey, vault.quoteDigest(input)));
    }

    function testEscrowPauseRollsBackVaultConsumptionAndAllowance() public {
        bytes32 commitment = _reserve(keccak256("escrow-paused-fund"), 10e6);
        uint256 jobId = adapter.dispatch(commitment);
        vm.prank(provider);
        escrow.setBudget(jobId, 10e6, "");
        escrow.setPaused(true);
        (bool ok,) = address(adapter).call(abi.encodeCall(adapter.fund, (commitment)));
        assertTrue(!ok, "escrow pause rejects new funding");
        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.reserved, 10e6, "vault consumption rolls back");
        assertEq(value.inEscrow, 0, "no escrow accounting credited");
        assertEq(token.balanceOf(address(vault)), 100e6, "physical vault backing retained");
        assertEq(token.allowance(address(adapter), address(escrow)), 0, "allowance rolls back");
        _assertConserved(value);
    }

    function testWrongQuotePriceCannotFundAndRetryCannotDuplicateEffects() public {
        bytes32 commitment = _reserve(keccak256("wrong-price"), 10e6);
        uint256 jobId = adapter.dispatch(commitment);
        vm.prank(provider);
        escrow.setBudget(jobId, 9e6, "");
        (bool priceOk,) = address(adapter).call(abi.encodeCall(adapter.fund, (commitment)));
        assertTrue(!priceOk, "escrow price must match signed quote");
        vm.prank(provider);
        escrow.setBudget(jobId, 10e6, "");
        adapter.fund(commitment);
        (bool duplicateFund,) = address(adapter).call(abi.encodeCall(adapter.fund, (commitment)));
        assertTrue(!duplicateFund, "funding exactly once");
        vm.prank(evaluator);
        escrow.reject(jobId, bytes32(0), "");
        adapter.reconcile(commitment);
        (bool duplicateRefund,) = address(adapter).call(abi.encodeCall(adapter.reconcile, (commitment)));
        assertTrue(!duplicateRefund, "refund exactly once");
        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.available, 100e6, "refund exactly restores available");
        assertEq(value.deposited, 100e6, "refund is not a deposit");
        _assertConserved(value);
    }

    function _assertConserved(BudgetVault.Ledger memory value) private pure {
        require(
            value.deposited == value.available + value.reserved + value.inEscrow + value.settled + value.withdrawn,
            "conservation"
        );
    }

    function _single(address value) private pure returns (address[] memory values) {
        values = new address[](1);
        values[0] = value;
    }
}
