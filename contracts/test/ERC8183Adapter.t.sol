// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {BudgetVault} from "../src/BudgetVault.sol";
import {ERC8183Adapter} from "../src/ERC8183Adapter.sol";
import {LocalAgenticCommerce} from "../src/LocalAgenticCommerce.sol";
import {IAgenticCommerce} from "../src/interfaces/IAgenticCommerce.sol";
import {MockUSDC, Assertions, Sig} from "./TestSupport.sol";

contract ERC8183AdapterTest is Assertions {
    MockUSDC token;
    BudgetVault vault;
    LocalAgenticCommerce escrow;
    ERC8183Adapter adapter;
    uint256 providerKey = 0xB0B;
    address provider;
    address evaluator = address(0xE1);
    bytes32 grantId = keccak256("agent");

    function setUp() public {
        provider = vm.addr(providerKey);
        token = new MockUSDC();
        vault = new BudgetVault(address(token), address(this), block.timestamp + 30 days, 100e6, 100e6, 4);
        escrow = new LocalAgenticCommerce(address(token));
        adapter = new ERC8183Adapter(address(vault), address(escrow), address(token));
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

    function testDispatchCompleteAndReconcile() public {
        bytes32 commitment = _reserve(keccak256("complete"), 40e6);
        uint256 jobId = adapter.dispatch(commitment);
        IAgenticCommerce.Job memory job = escrow.getJob(jobId);
        assertEq(job.id, jobId, "job id binding");
        assertTrue(job.provider == provider, "provider binding");
        assertTrue(job.evaluator == evaluator, "evaluator binding");
        assertEq(job.budget, 0, "provider has not set budget");
        assertEq(uint256(job.status), uint256(IAgenticCommerce.Status.Open), "open status");
        _setBudgetAndFund(commitment, jobId, 40e6);
        vm.prank(provider);
        escrow.submit(jobId, keccak256("deliverable"), "");
        vm.prank(evaluator);
        escrow.complete(jobId, keccak256("accepted"), "");
        adapter.reconcile(commitment);
        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.settled, 40e6, "settled");
        assertEq(token.balanceOf(provider), 40e6, "provider paid");
        assertEq(vault.activeCommitments(), 0, "settlement frees active slot");
        _assertConserved(value);
        (bool ok,) = address(adapter).call(abi.encodeCall(adapter.reconcile, (commitment)));
        assertTrue(!ok, "terminal reconcile exactly once");
    }

    function testRejectedJobRefundsAvailableEvenAfterGrantRevocation() public {
        bytes32 commitment = _reserve(keccak256("refund"), 30e6);
        uint256 jobId = adapter.dispatch(commitment);
        _setBudgetAndFund(commitment, jobId, 30e6);
        vault.revokeGrant(grantId);
        vm.prank(evaluator);
        escrow.reject(jobId, keccak256("rejected"), "");
        adapter.reconcile(commitment);
        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.available, 100e6, "refund available");
        assertEq(value.inEscrow, 0, "escrow cleared");
        assertEq(vault.activeCommitments(), 0, "refund frees active slot");
        _assertConserved(value);
    }

    function testCannotDispatchCommitmentTwice() public {
        bytes32 commitment = _reserve(keccak256("once"), 10e6);
        adapter.dispatch(commitment);
        (bool ok,) = address(adapter).call(abi.encodeCall(adapter.dispatch, (commitment)));
        assertTrue(!ok, "duplicate dispatch");
    }

    function testPauseBlocksNewObligationsButKeepsRecoveryOpen() public {
        bytes32 funded = _reserve(keccak256("already-funded"), 20e6);
        uint256 jobId = adapter.dispatch(funded);
        _setBudgetAndFund(funded, jobId, 20e6);
        bytes32 reserved = _reserve(keccak256("not-yet-funded"), 10e6);
        vault.setPaused(true);

        (bool dispatchOk,) = address(adapter).call(abi.encodeCall(adapter.dispatch, (reserved)));
        assertTrue(!dispatchOk, "pause must block dispatch");

        vm.prank(provider);
        escrow.submit(jobId, keccak256("deliverable"), "");
        vm.prank(evaluator);
        escrow.complete(jobId, keccak256("accepted"), "");
        adapter.reconcile(funded);
        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.settled, 20e6, "funded obligation still settles");
        assertEq(value.reserved, 10e6, "undispatched reservation remains reserved");
        assertEq(vault.activeCommitments(), 1, "only reserved obligation remains active");
        _assertConserved(value);
    }

    function testAdapterRejectsTokenDifferentFromVaultToken() public {
        MockUSDC other = new MockUSDC();
        try new ERC8183Adapter(address(vault), address(escrow), address(other)) returns (ERC8183Adapter) {
            revert("mismatched token accepted");
        } catch {}
    }

    function testArcReferenceAbiSelectorsArePinned() public pure {
        assertEq(
            uint256(uint32(IAgenticCommerce.fund.selector)),
            uint256(uint32(bytes4(keccak256("fund(uint256,bytes)")))),
            "Arc reference fund selector"
        );
        assertEq(
            uint256(uint32(IAgenticCommerce.getJob.selector)),
            uint256(uint32(bytes4(keccak256("getJob(uint256)")))),
            "Arc reference getJob selector"
        );
    }

    function testExpiredEscrowRefundsAndReconcilesExactlyOnce() public {
        bytes32 commitment = _reserve(keccak256("expired"), 12e6);
        uint256 jobId = adapter.dispatch(commitment);
        _setBudgetAndFund(commitment, jobId, 12e6);
        BudgetVault.Reservation memory reservation = vault.reservations(commitment);
        vm.warp(reservation.jobExpiresAt);
        escrow.claimRefund(jobId);
        adapter.reconcile(commitment);
        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.available, 100e6, "expired funds return to available");
        assertEq(value.inEscrow, 0, "expired escrow cleared");
        _assertConserved(value);
        (bool ok,) = address(adapter).call(abi.encodeCall(adapter.reconcile, (commitment)));
        assertTrue(!ok, "expired refund reconciles once");
    }

    function testOnlyProviderCanSetExactBudgetBeforeFunding() public {
        bytes32 commitment = _reserve(keccak256("provider-budget"), 10e6);
        uint256 jobId = adapter.dispatch(commitment);

        (bool earlyFundOk,) = address(adapter).call(abi.encodeCall(adapter.fund, (commitment)));
        assertTrue(!earlyFundOk, "zero budget cannot be funded");

        vm.prank(evaluator);
        (bool wrongCallerOk,) = address(escrow).call(abi.encodeCall(escrow.setBudget, (jobId, 10e6, "")));
        assertTrue(!wrongCallerOk, "only quoted provider sets budget");

        vm.prank(provider);
        escrow.setBudget(jobId, 9e6, "");
        (bool wrongBudgetOk,) = address(adapter).call(abi.encodeCall(adapter.fund, (commitment)));
        assertTrue(!wrongBudgetOk, "budget must match signed quote");

        vm.prank(provider);
        escrow.setBudget(jobId, 10e6, "");
        adapter.fund(commitment);
        assertEq(uint256(escrow.getJob(jobId).status), uint256(IAgenticCommerce.Status.Funded), "funded");
    }

    function _reserve(bytes32 operationId, uint256 amount) internal returns (bytes32) {
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
        bytes memory signature = Sig.sign(vm, providerKey, vault.quoteDigest(input));
        return vault.reserve(input, signature);
    }

    function _setBudgetAndFund(bytes32 commitment, uint256 jobId, uint256 amount) internal {
        vm.prank(provider);
        escrow.setBudget(jobId, amount, "");
        adapter.fund(commitment);
    }

    function _assertConserved(BudgetVault.Ledger memory value) internal pure {
        require(
            value.deposited == value.available + value.reserved + value.inEscrow + value.settled + value.withdrawn,
            "conservation"
        );
    }

    function _single(address value) internal pure returns (address[] memory values) {
        values = new address[](1);
        values[0] = value;
    }
}
