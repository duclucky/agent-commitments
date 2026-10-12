// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {BudgetVault} from "../../src/BudgetVault.sol";
import {MockUSDC, Assertions, Sig} from "../TestSupport.sol";

/// @notice Sequence fuzzing for the accounting invariant. Foundry varies every
/// amount and terminal branch while the assertions check both the global and
/// ancestor ledgers after each transition.
contract BudgetVaultInvariantTest is Assertions {
    MockUSDC private token;
    BudgetVault private vault;
    uint256 private constant PROVIDER_KEY = 0xB0B;
    address private provider;
    address private constant AGENT_ONE = address(0xA11CE);
    address private constant AGENT_TWO = address(0xB11CE);
    bytes32 private constant PARENT = keccak256("parent");
    bytes32 private constant GRANT_ONE = keccak256("grant-one");
    bytes32 private constant GRANT_TWO = keccak256("grant-two");

    function setUp() public {
        token = new MockUSDC();
        provider = vm.addr(PROVIDER_KEY);
        vault = new BudgetVault(address(token), address(this), block.timestamp + 30 days, 100e6, 80e6, 2);
        vault.setAdapter(address(this));
        vault.createGrant(
            PARENT,
            vault.ROOT_GRANT_ID(),
            address(0xC0),
            100e6,
            block.timestamp + 20 days,
            _single(provider),
            _single(address(0xE1))
        );
        vault.createGrant(
            GRANT_ONE, PARENT, AGENT_ONE, 80e6, block.timestamp + 10 days, _single(provider), _single(address(0xE1))
        );
        vault.createGrant(
            GRANT_TWO, PARENT, AGENT_TWO, 80e6, block.timestamp + 10 days, _single(provider), _single(address(0xE1))
        );
        token.mint(address(this), 100e6);
        token.approve(address(vault), 100e6);
        vault.deposit(100e6);
    }

    function testFuzzConservationAcrossConcurrentLifecycle(uint96 firstSeed, uint96 secondSeed, bool settleFirst)
        public
    {
        uint256 firstAmount = 1 + (uint256(firstSeed) % 80e6);
        uint256 remaining = 100e6 - firstAmount;
        uint256 secondLimit = remaining < 80e6 ? remaining : 80e6;
        uint256 secondAmount = secondLimit == 0 ? 0 : 1 + (uint256(secondSeed) % secondLimit);

        bytes32 first = _reserve(GRANT_ONE, AGENT_ONE, keccak256("operation-one"), firstAmount);
        bytes32 second;
        if (secondAmount != 0) second = _reserve(GRANT_TWO, AGENT_TWO, keccak256("operation-two"), secondAmount);
        _assertAllConserved();

        vault.consumeReservation(first);
        _assertAllConserved();
        if (settleFirst) {
            vault.reconcileCompleted(first);
        } else {
            token.approve(address(vault), firstAmount);
            vault.recordRefund(first);
        }
        _assertAllConserved();

        if (second != bytes32(0)) {
            vault.consumeReservation(second);
            vault.reconcileCompleted(second);
            _assertAllConserved();
        }
    }

    function testFuzzDonationNeverCreditsLedger(uint96 donationSeed) public {
        uint256 donation = 1 + (uint256(donationSeed) % 100e6);
        token.mint(address(this), donation);
        assertTrue(token.transfer(address(vault), donation), "donation transfer");

        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(value.deposited, 100e6, "donation changed deposited");
        assertEq(value.available, 100e6, "donation changed available");
        _assertAllConserved();
    }

    function _reserve(bytes32 grantId, address agent, bytes32 operationId, uint256 amount) private returns (bytes32) {
        BudgetVault.ReservationInput memory input = BudgetVault.ReservationInput({
            grantId: grantId,
            operationId: operationId,
            provider: provider,
            evaluator: address(0xE1),
            token: address(token),
            adapter: address(this),
            amount: amount,
            quoteExpiresAt: block.timestamp + 1 days,
            jobExpiresAt: block.timestamp + 7 days,
            workHash: keccak256(abi.encode(operationId)),
            nonce: keccak256(abi.encode("nonce", operationId))
        });
        bytes memory signature = Sig.sign(vm, PROVIDER_KEY, vault.quoteDigest(input));
        vm.prank(agent);
        return vault.reserve(input, signature);
    }

    function _assertAllConserved() private view {
        BudgetVault.Ledger memory value = vault.ledger();
        assertEq(
            value.deposited,
            value.available + value.reserved + value.inEscrow + value.settled + value.withdrawn,
            "global conservation"
        );
        BudgetVault.Grant memory root = vault.grants(vault.ROOT_GRANT_ID());
        BudgetVault.Grant memory parent = vault.grants(PARENT);
        assertEq(root.reserved, value.reserved, "root reserved");
        assertEq(root.inEscrow, value.inEscrow, "root escrow");
        assertEq(root.grossSpent, value.settled, "root spent");
        assertEq(parent.reserved, value.reserved, "parent reserved");
        assertEq(parent.inEscrow, value.inEscrow, "parent escrow");
        assertEq(parent.grossSpent, value.settled, "parent spent");
    }

    function _single(address value) private pure returns (address[] memory values) {
        values = new address[](1);
        values[0] = value;
    }
}
