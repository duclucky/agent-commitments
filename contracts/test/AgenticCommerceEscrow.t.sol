// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {AgenticCommerceEscrow} from "../src/AgenticCommerceEscrow.sol";
import {IAgenticCommerceDraft} from "../src/interfaces/IAgenticCommerceDraft.sol";
import {MockUSDC, MockWrongDecimals, Assertions} from "./TestSupport.sol";

contract AgenticCommerceEscrowTest is Assertions {
    MockUSDC private token;
    AgenticCommerceEscrow private escrow;
    address private client = address(0xC11E17);
    address private provider = address(0xB0B);
    address private evaluator = address(0xE1A1);
    address private stranger = address(0xBAD);

    function setUp() public {
        token = new MockUSDC();
        escrow = new AgenticCommerceEscrow(address(token), address(this));
        token.mint(client, 10e6);
        vm.prank(client);
        token.approve(address(escrow), type(uint256).max);
    }

    function testSettlementBindsExpectedBudgetAndReleasesExactlyOnce() public {
        uint256 jobId = _createPricedJob(3e6);

        vm.prank(client);
        (bool mismatch,) = address(escrow).call(abi.encodeCall(escrow.fund, (jobId, 2e6, "")));
        assertTrue(!mismatch, "fund must bind expected budget");

        vm.prank(client);
        escrow.fund(jobId, 3e6, "");
        assertEq(escrow.totalEscrowed(), 3e6, "escrow accounting after fund");
        assertEq(token.balanceOf(address(escrow)), 3e6, "physical escrow balance");

        vm.prank(provider);
        escrow.submit(jobId, keccak256("deliverable"), "");
        vm.prank(evaluator);
        escrow.complete(jobId, keccak256("accepted"), "");

        assertEq(token.balanceOf(provider), 3e6, "provider paid");
        assertEq(escrow.totalEscrowed(), 0, "escrow accounting after completion");
        assertEq(uint256(escrow.getJob(jobId).status), uint256(IAgenticCommerceDraft.Status.Completed), "completed");

        vm.prank(evaluator);
        (bool repeated,) = address(escrow).call(abi.encodeCall(escrow.complete, (jobId, bytes32(0), "")));
        assertTrue(!repeated, "terminal transition must be exactly once");
    }

    function testEvaluatorRejectAndPermissionlessExpiryRefundClient() public {
        uint256 rejected = _createPricedJob(2e6);
        vm.prank(client);
        escrow.fund(rejected, 2e6, "");
        vm.prank(evaluator);
        escrow.reject(rejected, keccak256("rejected"), "");
        assertEq(token.balanceOf(client), 10e6, "reject refund");

        uint256 expired = _createPricedJob(4e6);
        vm.prank(client);
        escrow.fund(expired, 4e6, "");
        IAgenticCommerceDraft.Job memory job = escrow.getJob(expired);
        vm.warp(job.expiredAt);
        vm.prank(stranger);
        escrow.claimRefund(expired);

        assertEq(token.balanceOf(client), 10e6, "expiry refund");
        assertEq(escrow.totalEscrowed(), 0, "no residual obligation");
        assertEq(uint256(escrow.getJob(expired).status), uint256(IAgenticCommerceDraft.Status.Expired), "expired");
    }

    function testPauseBlocksNewObligationsButPreservesFundedRecovery() public {
        uint256 funded = _createPricedJob(2e6);
        vm.prank(client);
        escrow.fund(funded, 2e6, "");
        escrow.setPaused(true);

        vm.prank(client);
        (bool createOk,) = address(escrow)
            .call(
                abi.encodeCall(escrow.createJob, (provider, evaluator, block.timestamp + 1 days, "blocked", address(0)))
            );
        assertTrue(!createOk, "pause blocks job creation");

        vm.prank(evaluator);
        escrow.reject(funded, bytes32(0), "");
        assertEq(token.balanceOf(client), 10e6, "pause preserves refund");
    }

    function testOwnerCanWithdrawOnlyTokensNotBackingJobs() public {
        uint256 jobId = _createPricedJob(3e6);
        vm.prank(client);
        escrow.fund(jobId, 3e6, "");
        token.mint(address(escrow), 2e6);

        (bool overdraw,) = address(escrow).call(abi.encodeCall(escrow.withdrawExcess, (address(this), 2e6 + 1)));
        assertTrue(!overdraw, "owner cannot withdraw escrow backing");
        escrow.withdrawExcess(address(this), 2e6);

        assertEq(token.balanceOf(address(escrow)), 3e6, "job backing remains");
        assertEq(escrow.totalEscrowed(), 3e6, "obligation unchanged");

        vm.prank(stranger);
        (bool unauthorized,) = address(escrow).call(abi.encodeCall(escrow.withdrawExcess, (stranger, 1)));
        assertTrue(!unauthorized, "non-owner cannot withdraw excess");
    }

    function testRejectsUnsafeConfigurationAndUnsupportedHooks() public {
        (bool zeroToken,) = address(this).call(abi.encodeWithSelector(this.deploy.selector, address(0), address(this)));
        assertTrue(!zeroToken, "zero token rejected");
        (bool zeroOwner,) = address(this).call(abi.encodeWithSelector(this.deploy.selector, address(token), address(0)));
        assertTrue(!zeroOwner, "zero owner rejected");

        MockWrongDecimals wrong = new MockWrongDecimals();
        (bool wrongDecimals,) =
            address(this).call(abi.encodeWithSelector(this.deploy.selector, address(wrong), address(this)));
        assertTrue(!wrongDecimals, "non-USDC decimals rejected");

        vm.prank(client);
        (bool hookOk,) = address(escrow)
            .call(
                abi.encodeCall(
                    escrow.createJob, (provider, evaluator, block.timestamp + 1 days, "hook", address(0x123))
                )
            );
        assertTrue(!hookOk, "unreviewed hooks rejected");
    }

    function testOptionalProviderCanOnlyBeAssignedOnceByClient() public {
        vm.prank(client);
        uint256 jobId = escrow.createJob(address(0), evaluator, block.timestamp + 1 days, "open assignment", address(0));

        vm.prank(stranger);
        (bool strangerOk,) = address(escrow).call(abi.encodeCall(escrow.setProvider, (jobId, provider, "")));
        assertTrue(!strangerOk, "only client assigns provider");
        vm.prank(client);
        escrow.setProvider(jobId, provider, "");
        vm.prank(client);
        (bool repeated,) = address(escrow).call(abi.encodeCall(escrow.setProvider, (jobId, stranger, "")));
        assertTrue(!repeated, "provider assignment is final");
    }

    function testPauseBlocksFundingAnUnfundedJob() public {
        uint256 jobId = _createPricedJob(1e6);
        escrow.setPaused(true);
        vm.prank(client);
        (bool funded,) = address(escrow).call(abi.encodeCall(escrow.fund, (jobId, 1e6, "")));
        assertTrue(!funded, "pause blocks new funded obligation");
        assertEq(escrow.totalEscrowed(), 0, "pause does not alter accounting");
    }

    function testFuzzSettlementConservesPhysicalBacking(uint96 rawAmount) public {
        uint256 amount = uint256(rawAmount) % 10e6 + 1;
        uint256 jobId = _createPricedJob(amount);
        vm.prank(client);
        escrow.fund(jobId, amount, "");
        assertEq(token.balanceOf(address(escrow)), escrow.totalEscrowed(), "funded backing");

        vm.prank(provider);
        escrow.submit(jobId, keccak256(abi.encode(rawAmount)), "");
        vm.prank(evaluator);
        escrow.complete(jobId, bytes32(0), "");

        assertEq(token.balanceOf(address(escrow)), 0, "no residual balance");
        assertEq(escrow.totalEscrowed(), 0, "no residual accounting");
        assertEq(token.balanceOf(provider), amount, "exact provider amount");
    }

    function testFuzzExpiryRefundConservesPhysicalBacking(uint96 rawAmount) public {
        uint256 amount = uint256(rawAmount) % 10e6 + 1;
        uint256 jobId = _createPricedJob(amount);
        vm.prank(client);
        escrow.fund(jobId, amount, "");
        vm.warp(escrow.getJob(jobId).expiredAt);
        vm.prank(stranger);
        escrow.claimRefund(jobId);

        assertEq(token.balanceOf(address(escrow)), 0, "no residual balance");
        assertEq(escrow.totalEscrowed(), 0, "no residual accounting");
        assertEq(token.balanceOf(client), 10e6, "exact client refund");
    }

    function deploy(address paymentToken, address owner) external returns (AgenticCommerceEscrow) {
        return new AgenticCommerceEscrow(paymentToken, owner);
    }

    function _createPricedJob(uint256 amount) private returns (uint256 jobId) {
        vm.prank(client);
        jobId = escrow.createJob(provider, evaluator, block.timestamp + 1 days, "content hash only", address(0));
        vm.prank(provider);
        escrow.setBudget(jobId, amount, "");
    }
}
