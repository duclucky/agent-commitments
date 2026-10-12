// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {BudgetVault} from "../src/BudgetVault.sol";
import {MockUSDC, MockWrongDecimals, MockFailingUSDC, Actor, Assertions, Sig, Vm} from "./TestSupport.sol";

contract BudgetVaultTest is Assertions {
    MockUSDC token;
    BudgetVault vault;
    Actor ownerActor;
    address provider;
    uint256 providerKey = 0xB0B;
    bytes32 coordinator = keccak256("coordinator");
    bytes32 agentA = keccak256("agent-a");
    bytes32 agentB = keccak256("agent-b");
    address agentAAddress = address(0xA11CE);
    address agentBAddress = address(0xB11CE);

    function setUp() public {
        token = new MockUSDC();
        ownerActor = new Actor();
        provider = vm.addr(providerKey);
        vault = new BudgetVault(address(token), address(ownerActor), block.timestamp + 30 days, 100e6, 80e6, 2);
        ownerActor.callTarget(address(vault), abi.encodeCall(vault.setAdapter, (address(this))));
        ownerActor.callTarget(
            address(vault),
            abi.encodeCall(
                vault.createGrant,
                (
                    coordinator,
                    vault.ROOT_GRANT_ID(),
                    address(0xC0),
                    100e6,
                    block.timestamp + 20 days,
                    _single(provider),
                    _single(address(0xE1))
                )
            )
        );
        ownerActor.callTarget(
            address(vault),
            abi.encodeCall(
                vault.createGrant,
                (
                    agentA,
                    coordinator,
                    agentAAddress,
                    80e6,
                    block.timestamp + 10 days,
                    _single(provider),
                    _single(address(0xE1))
                )
            )
        );
        ownerActor.callTarget(
            address(vault),
            abi.encodeCall(
                vault.createGrant,
                (
                    agentB,
                    coordinator,
                    agentBAddress,
                    80e6,
                    block.timestamp + 10 days,
                    _single(provider),
                    _single(address(0xE1))
                )
            )
        );
        token.mint(address(ownerActor), 100e6);
        ownerActor.approveToken(token, address(vault), 100e6);
        ownerActor.callTarget(address(vault), abi.encodeCall(vault.deposit, (100e6)));
    }

    function testConcurrentAgentsCannotOverReserveSharedParent() public {
        _reserve(agentA, agentAAddress, keccak256("op-a"), 60e6);
        _reserve(agentB, agentBAddress, keccak256("op-b"), 40e6);

        vm.prank(agentBAddress);
        (bool ok,) = address(vault)
            .call(
                abi.encodeCall(
                    vault.reserve,
                    (_input(agentB, keccak256("op-c"), 1), _signature(_input(agentB, keccak256("op-c"), 1)))
                )
            );
        assertTrue(!ok, "third reservation should exceed root/parent cap");

        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.available, 0, "available");
        assertEq(value.reserved, 100e6, "reserved");
        _assertConserved(value);
    }

    function testSameOperationAndTermsAreIdempotentButConflictIsRejected() public {
        bytes32 operation = keccak256("stable-operation");
        bytes32 first = _reserve(agentA, agentAAddress, operation, 25e6);
        bytes32 second = _reserve(agentA, agentAAddress, operation, 25e6);
        assertEq(first, second, "same commitment");
        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.reserved, 25e6, "must reserve once");

        BudgetVault.ReservationInput memory changed = _input(agentA, operation, 26);
        bytes memory changedSignature = _signature(changed);
        vm.prank(agentAAddress);
        (bool ok,) = address(vault).call(abi.encodeCall(vault.reserve, (changed, changedSignature)));
        assertTrue(!ok, "changed payload must conflict");
    }

    function testExactRetryReturnsExistingCommitmentAfterPauseAndExpiry() public {
        bytes32 operation = keccak256("stable-retry");
        BudgetVault.ReservationInput memory input = _input(agentA, operation, 10);
        bytes memory signature = _signature(input);
        vm.prank(agentAAddress);
        bytes32 first = vault.reserve(input, signature);

        ownerActor.callTarget(address(vault), abi.encodeCall(vault.setPaused, (true)));
        vm.warp(input.quoteExpiresAt + 1);
        vm.prank(agentAAddress);
        bytes32 second = vault.reserve(input, signature);

        assertEq(first, second, "retry must retain commitment identity");
        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.reserved, 10e6, "retry must not reserve twice");
    }

    function testAdapterTransitionsAndRefundPreserveConservation() public {
        bytes32 commitment = _reserve(agentA, agentAAddress, keccak256("job"), 40e6);
        vault.consumeReservation(commitment);
        BudgetVault.Ledger memory funded = vault.ledger();
        assertEq(funded.reserved, 0, "reserved after fund");
        assertEq(funded.inEscrow, 40e6, "escrow after fund");

        token.approve(address(vault), 40e6);
        vault.recordRefund(commitment);
        BudgetVault.Ledger memory refunded = vault.ledger();
        assertEq(refunded.available, 100e6, "available after refund");
        assertEq(refunded.deposited, 100e6, "deposit must not increase");
        _assertConserved(refunded);

        (bool ok,) = address(vault).call(abi.encodeCall(vault.recordRefund, (commitment)));
        assertTrue(!ok, "refund must be exactly once");
    }

    function testGrantPolicyAttenuatesProviderAndEvaluator() public {
        assertTrue(vault.isProviderAllowed(agentA, provider), "configured provider");
        assertTrue(vault.isEvaluatorAllowed(agentA, address(0xE1)), "configured evaluator");
        assertTrue(!vault.isProviderAllowed(agentA, address(0xBAD)), "other provider");
        assertTrue(!vault.isEvaluatorAllowed(agentA, address(0xBAD)), "other evaluator");

        bytes32 widened = keccak256("widened");
        bytes memory create = abi.encodeCall(
            vault.createGrant,
            (
                widened,
                coordinator,
                address(0xD00D),
                1e6,
                block.timestamp + 1 days,
                _single(address(0xBAD)),
                _single(address(0xE1))
            )
        );
        (bool createOk,) = ownerActor.callTarget(address(vault), create);
        assertTrue(!createOk, "child cannot widen provider policy");

        BudgetVault.ReservationInput memory wrongEvaluator = _input(agentA, keccak256("wrong-evaluator"), 1);
        wrongEvaluator.evaluator = address(0xBAD);
        vm.prank(agentAAddress);
        (bool reserveOk,) =
            address(vault).call(abi.encodeCall(vault.reserve, (wrongEvaluator, _signature(wrongEvaluator))));
        assertTrue(!reserveOk, "reservation must enforce evaluator policy");
    }

    function testImmutablePilotCapsLimitDepositsCommitmentSizeAndConcurrency() public {
        token.mint(address(ownerActor), 1);
        ownerActor.approveToken(token, address(vault), 1);
        (bool depositOk,) = ownerActor.callTarget(address(vault), abi.encodeCall(vault.deposit, (1)));
        assertTrue(!depositOk, "deposit cap");

        BudgetVault.ReservationInput memory oversized = _input(agentA, keccak256("oversized"), 81);
        vm.prank(agentAAddress);
        (bool amountOk,) = address(vault).call(abi.encodeCall(vault.reserve, (oversized, _signature(oversized))));
        assertTrue(!amountOk, "per-commitment cap");

        _reserve(agentA, agentAAddress, keccak256("slot-one"), 1e6);
        _reserve(agentB, agentBAddress, keccak256("slot-two"), 1e6);
        BudgetVault.ReservationInput memory third = _input(agentA, keccak256("slot-three"), 1);
        vm.prank(agentAAddress);
        (bool concurrentOk,) = address(vault).call(abi.encodeCall(vault.reserve, (third, _signature(third))));
        assertTrue(!concurrentOk, "concurrent commitment cap");
        assertEq(vault.activeCommitments(), 2, "active commitment count");

        bytes32 firstId = vault.commitmentId(agentA, keccak256("slot-one"));
        vm.prank(agentAAddress);
        vault.cancelReservation(firstId);
        assertEq(vault.activeCommitments(), 1, "cancel frees slot");
    }

    function testQuoteMustBindConfiguredToken() public {
        BudgetVault.ReservationInput memory input = _input(agentA, keccak256("wrong-token"), 1);
        input.token = address(0xBAD);
        vm.prank(agentAAddress);
        (bool ok,) = address(vault).call(abi.encodeCall(vault.reserve, (input, _signature(input))));
        assertTrue(!ok, "quote token mismatch");
    }

    function testQuoteMustBindConfiguredAdapter() public {
        BudgetVault.ReservationInput memory input = _input(agentA, keccak256("wrong-adapter"), 1);
        input.adapter = address(0xBAD);
        vm.prank(agentAAddress);
        (bool ok,) = address(vault).call(abi.encodeCall(vault.reserve, (input, _signature(input))));
        assertTrue(!ok, "quote adapter mismatch");
    }

    function testQuoteCannotReplayAgainstAnotherVault() public {
        BudgetVault second =
            new BudgetVault(address(token), address(ownerActor), block.timestamp + 30 days, 100e6, 80e6, 2);
        ownerActor.callTarget(address(second), abi.encodeCall(second.setAdapter, (address(this))));
        ownerActor.callTarget(
            address(second),
            abi.encodeCall(
                second.createGrant,
                (
                    coordinator,
                    second.ROOT_GRANT_ID(),
                    address(0xC0),
                    100e6,
                    block.timestamp + 20 days,
                    _single(provider),
                    _single(address(0xE1))
                )
            )
        );
        ownerActor.callTarget(
            address(second),
            abi.encodeCall(
                second.createGrant,
                (
                    agentA,
                    coordinator,
                    agentAAddress,
                    80e6,
                    block.timestamp + 10 days,
                    _single(provider),
                    _single(address(0xE1))
                )
            )
        );
        token.mint(address(ownerActor), 10e6);
        ownerActor.approveToken(token, address(second), 10e6);
        ownerActor.callTarget(address(second), abi.encodeCall(second.deposit, (10e6)));

        BudgetVault.ReservationInput memory input = _input(agentA, keccak256("domain-bound"), 5);
        bytes memory signatureForFirstVault = _signature(input);
        vm.prank(agentAAddress);
        (bool ok,) = address(second).call(abi.encodeCall(second.reserve, (input, signatureForFirstVault)));
        assertTrue(!ok, "signature must bind verifying contract");
    }

    function testExpiredReservationCanBeCancelledAndAvailableWithdrawn() public {
        bytes32 commitment = _reserve(agentA, agentAAddress, keccak256("expires"), 15e6);
        BudgetVault.Reservation memory reservation = vault.reservations(commitment);
        vm.warp(reservation.jobExpiresAt);
        vm.prank(address(0xF00D));
        vault.cancelReservation(commitment);
        BudgetVault.Ledger memory cancelled = vault.ledger();
        assertEq(cancelled.available, 100e6, "cancel restores available");

        ownerActor.callTarget(address(vault), abi.encodeCall(vault.withdrawAvailable, (address(0xCAFE), 35e6)));
        BudgetVault.Ledger memory withdrawn = vault.ledger();
        assertEq(withdrawn.available, 65e6, "available after withdraw");
        assertEq(withdrawn.withdrawn, 35e6, "withdrawn accounting");
        _assertConserved(withdrawn);
    }

    function testRejectsTokenWithWrongDecimals() public {
        MockWrongDecimals wrong = new MockWrongDecimals();
        try new BudgetVault(address(wrong), address(this), block.timestamp + 1 days, 10e6, 5e6, 1) returns (
            BudgetVault
        ) {
            revert("wrong decimals accepted");
        } catch {}
    }

    function testRevokedAncestorBlocksDispatchOfExistingChildReservation() public {
        bytes32 commitment = _reserve(agentA, agentAAddress, keccak256("parent-revoked"), 10e6);
        ownerActor.callTarget(address(vault), abi.encodeCall(vault.revokeGrant, (coordinator)));
        (bool ok,) = address(vault).call(abi.encodeCall(vault.consumeReservation, (commitment)));
        assertTrue(!ok, "revoked ancestor must block funding");
        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.reserved, 10e6, "failed fund keeps reservation");
        assertEq(value.inEscrow, 0, "failed fund cannot create escrow balance");
        _assertConserved(value);
    }

    function testTokenTransferFailureCannotCreateAccountingBalance() public {
        MockFailingUSDC failing = new MockFailingUSDC();
        BudgetVault isolated = new BudgetVault(address(failing), address(this), block.timestamp + 1 days, 10e6, 5e6, 1);
        failing.mint(address(this), 10e6);
        failing.approve(address(isolated), 10e6);
        (bool ok,) = address(isolated).call(abi.encodeCall(isolated.deposit, (10e6)));
        assertTrue(!ok, "failed transfer must revert deposit");
        BudgetVault.Ledger memory value = isolated.ledger();
        assertEq(value.deposited, 0, "failed transfer cannot credit deposited");
        assertEq(value.available, 0, "failed transfer cannot credit available");
    }

    function _input(bytes32 grantId, bytes32 operation, uint256 dollars)
        internal
        view
        returns (BudgetVault.ReservationInput memory)
    {
        return BudgetVault.ReservationInput({
            grantId: grantId,
            operationId: operation,
            provider: provider,
            evaluator: address(0xE1),
            token: address(token),
            adapter: address(this),
            amount: dollars * 1e6,
            quoteExpiresAt: block.timestamp + 1 days,
            jobExpiresAt: block.timestamp + 7 days,
            workHash: keccak256("work"),
            nonce: keccak256(abi.encode(operation))
        });
    }

    function _signature(BudgetVault.ReservationInput memory input) internal returns (bytes memory) {
        return Sig.sign(vm, providerKey, vault.quoteDigest(input));
    }

    function _reserve(bytes32 grantId, address agent, bytes32 operation, uint256 amount) internal returns (bytes32) {
        BudgetVault.ReservationInput memory input = _input(grantId, operation, amount / 1e6);
        bytes memory signature = _signature(input);
        vm.prank(agent);
        return vault.reserve(input, signature);
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
