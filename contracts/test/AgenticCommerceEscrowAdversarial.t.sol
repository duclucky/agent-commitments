// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {AgenticCommerceEscrow} from "../src/AgenticCommerceEscrow.sol";
import {IAgenticCommerceDraft} from "../src/interfaces/IAgenticCommerceDraft.sol";
import {MockUSDC, Assertions} from "./TestSupport.sol";

contract AdversarialEscrowToken is MockUSDC {
    bool public fakeIncoming;
    bool public failOutgoing;
    bool public callbackAttempted;
    bool public callbackSucceeded;
    address private callbackTarget;
    bytes private callbackData;

    function configure(bool fake, bool fail) external {
        fakeIncoming = fake;
        failOutgoing = fail;
    }

    function armCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        if (fakeIncoming) return true;
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        if (failOutgoing) return false;
        if (callbackTarget != address(0)) {
            address target = callbackTarget;
            callbackTarget = address(0);
            callbackAttempted = true;
            (callbackSucceeded,) = target.call(callbackData);
        }
        _transfer(msg.sender, to, amount);
        return true;
    }
}

contract AgenticCommerceEscrowAdversarialTest is Assertions {
    AdversarialEscrowToken private token;
    AgenticCommerceEscrow private escrow;
    address private provider = address(0xB0B);

    function setUp() public {
        token = new AdversarialEscrowToken();
        escrow = new AgenticCommerceEscrow(address(token), address(this));
        token.mint(address(this), 10e6);
        token.approve(address(escrow), 10e6);
    }

    function testFakeSuccessfulTokenTransferCannotFundAnUnbackedJob() public {
        uint256 jobId = _priced(3e6);
        token.configure(true, false);
        (bool ok,) = address(escrow).call(abi.encodeCall(escrow.fund, (jobId, 3e6, "")));
        assertTrue(!ok, "fund must confirm physical incoming tokens");
        assertEq(escrow.totalEscrowed(), 0, "accounting rolls back");
        assertEq(uint256(escrow.getJob(jobId).status), uint256(IAgenticCommerceDraft.Status.Open), "state rolls back");
    }

    function testPayoutFailureKeepsObligationAndCanBeRetried() public {
        uint256 jobId = _priced(3e6);
        escrow.fund(jobId, 3e6, "");
        vm.prank(provider);
        escrow.submit(jobId, keccak256("work"), "");
        token.configure(false, true);
        (bool ok,) = address(escrow).call(abi.encodeCall(escrow.complete, (jobId, bytes32(0), "")));
        assertTrue(!ok, "failed token payout reverts completion");
        assertEq(escrow.totalEscrowed(), 3e6, "backing retained");
        assertEq(
            uint256(escrow.getJob(jobId).status),
            uint256(IAgenticCommerceDraft.Status.Submitted),
            "pending evaluation retained"
        );

        token.configure(false, false);
        escrow.complete(jobId, bytes32(0), "");
        assertEq(token.balanceOf(provider), 3e6, "retry pays exactly once");
    }

    function testPayoutCallbackCannotRefundAnotherJobReentrantly() public {
        uint256 first = _priced(2e6);
        uint256 second = _priced(3e6);
        escrow.fund(first, 2e6, "");
        escrow.fund(second, 3e6, "");
        vm.prank(provider);
        escrow.submit(first, keccak256("work"), "");
        vm.warp(escrow.getJob(second).expiredAt);
        token.armCallback(address(escrow), abi.encodeCall(escrow.claimRefund, (second)));
        escrow.complete(first, bytes32(0), "");

        assertTrue(token.callbackAttempted(), "token callback exercised");
        assertTrue(!token.callbackSucceeded(), "cross-job reentrancy blocked");
        assertEq(escrow.totalEscrowed(), 3e6, "second job remains backed");
        assertEq(token.balanceOf(address(escrow)), 3e6, "physical backing remains");
        escrow.claimRefund(second);
        assertEq(escrow.totalEscrowed(), 0, "normal recovery remains possible");
    }

    function _priced(uint256 amount) private returns (uint256) {
        uint256 jobId = escrow.createJob(provider, address(this), block.timestamp + 1 days, "hash only", address(0));
        escrow.setBudget(jobId, amount, "");
        return jobId;
    }
}
