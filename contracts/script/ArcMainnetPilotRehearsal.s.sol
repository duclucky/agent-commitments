// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {BudgetVault} from "../src/BudgetVault.sol";
import {AgenticCommerceEscrow} from "../src/AgenticCommerceEscrow.sol";
import {ERC8183DraftAdapter} from "../src/ERC8183DraftAdapter.sol";
import {MockUSDC} from "../test/TestSupport.sol";

interface VmMainnetRehearsal {
    function createSelectFork(string calldata urlOrAlias) external returns (uint256);
    function etch(address target, bytes calldata code) external;
    function prank(address sender) external;
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8, bytes32, bytes32);
}

/// @notice No broadcast or real signer. Deployed contract logic with a replaced token on a local fork.
/// @dev Gas excludes SCA verification/relayer overhead and Arc native token implementation.
contract ArcMainnetPilotRehearsal {
    VmMainnetRehearsal private constant vm =
        VmMainnetRehearsal(address(uint160(uint256(keccak256("hevm cheat code")))));
    BudgetVault private constant vault = BudgetVault(0x2415a87B0b9280C1989F03ceA9DC1c3644777862);
    AgenticCommerceEscrow private constant escrow = AgenticCommerceEscrow(0x19E14a1006d106882D4c24584AAA6Ce1771E4151);
    ERC8183DraftAdapter private constant adapter = ERC8183DraftAdapter(0x0db5f0CC38F86e60FEbe495d4fFAF2Bb0288704d);
    address private constant owner = 0x7329d0F937dAa2f16Ff0869C5E05a907A4c17dC2;
    address private constant evaluator = address(0xE1);
    // Fixed public dummy key: local fork ONLY; never a mainnet signer.
    uint256 private constant localProviderKey = 0xB0B;
    bytes32 private constant grantId = keccak256("mainnet-pilot-rehearsal-only");
    MockUSDC private constant token = MockUSDC(0x3600000000000000000000000000000000000000);
    event StepGas(string step, uint256 gasUsed);
    event ForkEvidence(uint256 blockNumber, uint256 deposited, uint256 settled, uint256 withdrawn);

    function run() external {
        vm.createSelectFork("https://rpc.mainnet.arc.io");
        require(block.chainid == 5042, "wrong chain");
        require(address(vault.adapter()) == address(0) && vault.ledger().deposited == 0, "not empty unbound canary");
        require(vault.owner() == owner && !vault.paused() && !escrow.paused(), "unexpected ownership or pause");
        require(
            address(adapter.vault()) == address(vault) && address(adapter.escrow()) == address(escrow),
            "binding mismatch"
        );
        require(
            address(vault).codehash == 0x9d39228432ff3a2fed8a959c9a8692109f0fb5f77db12d3b7061089fda388bc2, "vault hash"
        );
        require(
            address(escrow).codehash == 0xd7d2f4b47c3ead3ae5bcaa7db790d5841577aa347cf7b433a8dbdf9566a882fb,
            "escrow hash"
        );
        require(
            address(adapter).codehash == 0xac4382e1add9828e48bce8c0569fa77d53442cfa7e3ae8832270f75afead4da6,
            "adapter hash"
        );

        // Replace only token code locally: Foundry cannot emulate Arc native-USDC system calls.
        MockUSDC localToken = new MockUSDC();
        vm.etch(address(token), address(localToken).code);
        token.mint(owner, 10_000);
        address provider = vm.addr(localProviderKey);
        uint256 beforeGas = gasleft();
        vm.prank(owner);
        vault.setAdapter(address(adapter));
        emit StepGas("bind", beforeGas - gasleft());
        beforeGas = gasleft();
        vm.prank(owner);
        token.approve(address(vault), 10_000);
        emit StepGas("approve", beforeGas - gasleft());
        beforeGas = gasleft();
        vm.prank(owner);
        vault.deposit(10_000);
        emit StepGas("deposit", beforeGas - gasleft());
        address[] memory providers = new address[](1);
        providers[0] = provider;
        address[] memory evaluators = new address[](1);
        evaluators[0] = evaluator;
        bytes32 rootGrantId = vault.ROOT_GRANT_ID();
        beforeGas = gasleft();
        vm.prank(owner);
        vault.createGrant(grantId, rootGrantId, owner, 20_000, block.timestamp + 1 days, providers, evaluators);
        emit StepGas("grant", beforeGas - gasleft());

        (bytes32 refundId, uint256 refundJob) = _fund(provider, "refund", 10_000);
        beforeGas = gasleft();
        vm.prank(evaluator);
        escrow.reject(refundJob, keccak256("rehearsal-rejected"), "");
        emit StepGas("reject", beforeGas - gasleft());
        require(vault.ledger().available == 0 && vault.ledger().inEscrow == 10_000, "no premature refund credit");
        beforeGas = gasleft();
        adapter.reconcile(refundId);
        emit StepGas("refund-reconcile", beforeGas - gasleft());
        require(vault.ledger().available == 10_000 && vault.activeCommitments() == 0, "refund restored");

        (bytes32 settleId, uint256 settleJob) = _fund(provider, "settle", 5_000);
        beforeGas = gasleft();
        vm.prank(provider);
        escrow.submit(settleJob, keccak256("rehearsal-output"), "");
        emit StepGas("submit", beforeGas - gasleft());
        beforeGas = gasleft();
        vm.prank(evaluator);
        escrow.complete(settleJob, keccak256("rehearsal-accepted"), "");
        emit StepGas("complete", beforeGas - gasleft());
        beforeGas = gasleft();
        adapter.reconcile(settleId);
        emit StepGas("settle-reconcile", beforeGas - gasleft());
        beforeGas = gasleft();
        vm.prank(owner);
        vault.withdrawAvailable(owner, 5_000);
        emit StepGas("withdraw", beforeGas - gasleft());
        BudgetVault.Ledger memory value = vault.ledger();
        require(value.deposited == 10_000 && value.settled == 5_000 && value.withdrawn == 5_000, "terminal ledger");
        require(
            value.available + value.reserved + value.inEscrow == 0 && vault.activeCommitments() == 0,
            "no remaining obligation"
        );
        require(token.balanceOf(provider) == 5_000 && token.balanceOf(address(vault)) == 0, "physical backing");
        require(token.balanceOf(address(adapter)) == 0 && token.balanceOf(address(escrow)) == 0, "no stranded token");
        require(
            token.allowance(address(adapter), address(vault)) == 0
                && token.allowance(address(adapter), address(escrow)) == 0,
            "exact allowances cleared"
        );
        emit ForkEvidence(block.number, value.deposited, value.settled, value.withdrawn);
    }

    function _fund(address provider, string memory phase, uint256 amount) private returns (bytes32 id, uint256 jobId) {
        BudgetVault.ReservationInput memory input = BudgetVault.ReservationInput({
            grantId: grantId,
            operationId: keccak256(bytes(phase)),
            provider: provider,
            evaluator: evaluator,
            token: address(token),
            adapter: address(adapter),
            amount: amount,
            quoteExpiresAt: block.timestamp + 15 minutes,
            jobExpiresAt: block.timestamp + 1 hours,
            workHash: keccak256(abi.encode("rehearsal-input", phase)),
            nonce: keccak256(abi.encode("rehearsal-nonce", phase))
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(localProviderKey, vault.quoteDigest(input));
        uint256 beforeGas = gasleft();
        vm.prank(owner);
        id = vault.reserve(input, abi.encodePacked(r, s, v));
        emit StepGas(string.concat(phase, "-reserve"), beforeGas - gasleft());
        beforeGas = gasleft();
        jobId = adapter.dispatch(id);
        emit StepGas(string.concat(phase, "-dispatch"), beforeGas - gasleft());
        beforeGas = gasleft();
        vm.prank(provider);
        escrow.setBudget(jobId, amount, "");
        emit StepGas(string.concat(phase, "-price"), beforeGas - gasleft());
        beforeGas = gasleft();
        adapter.fund(id);
        emit StepGas(string.concat(phase, "-fund"), beforeGas - gasleft());
    }
}
