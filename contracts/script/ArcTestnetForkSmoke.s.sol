// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BudgetVault} from "../src/BudgetVault.sol";
import {ERC8183Adapter} from "../src/ERC8183Adapter.sol";
import {IAgenticCommerce} from "../src/interfaces/IAgenticCommerce.sol";

interface VmArcFork {
    function createSelectFork(string calldata urlOrAlias) external returns (uint256 forkId);
    function prank(address sender) external;
    function addr(uint256 privateKey) external returns (address keyAddr);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function mockCall(address callee, bytes calldata data, bytes calldata returnData) external;
    function deal(address who, uint256 newBalance) external;
}

/// @notice Runs the complete contract lifecycle against a local fork of the
/// deployed Arc testnet contracts. No transaction is broadcast to Arc and Arc's
/// native-USDC system calls are mocked, so this is not a live token-flow test.
contract ArcTestnetForkSmoke {
    VmArcFork private constant vm = VmArcFork(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant PROVIDER_TEST_KEY = 0xB0B;
    address private constant OWNER = 0x2503A16442F21B3B01f04EFd5205EE8B04F9bb79;
    IERC20 private constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    BudgetVault private constant VAULT = BudgetVault(0x0A1AbBf8b795e30F305C54C53A2404a595aF923a);
    ERC8183Adapter private constant ADAPTER = ERC8183Adapter(0x18EF2ad61947800e9F3574b65cee4fd2b4361a4a);
    IAgenticCommerce private constant ESCROW = IAgenticCommerce(0x0747EEf0706327138c69792bF28Cd525089e4583);
    address private constant ARC_TRANSFER = 0x1800000000000000000000000000000000000000;
    address private constant ARC_BLOCKLIST = 0x1800000000000000000000000000000000000001;

    function run() external {
        vm.createSelectFork("https://rpc.testnet.arc.io");
        require(block.chainid == 5_042_002, "wrong Arc chain");
        // Foundry does not emulate Arc's native-USDC system contracts on a fork.
        // These mocks exercise vault, adapter and escrow state transitions, but
        // do not prove live USDC movement.
        vm.mockCall(
            ARC_BLOCKLIST, abi.encodeWithSelector(bytes4(keccak256("isBlocklisted(address)"))), abi.encode(false)
        );
        vm.mockCall(
            ARC_TRANSFER,
            abi.encodeWithSelector(bytes4(keccak256("transfer(address,address,uint256)"))),
            abi.encode(true)
        );

        address provider = vm.addr(PROVIDER_TEST_KEY);
        address evaluator = address(0xE1);
        bytes32 grantId = keccak256("arc-testnet-fork-smoke-grant");
        bytes32 operationId = keccak256("arc-testnet-fork-smoke-operation");
        BudgetVault.Ledger memory ledgerBefore = VAULT.ledger();
        uint256 activeBefore = VAULT.activeCommitments();

        _fundAndCreateGrant(grantId, provider, evaluator);
        (bytes32 commitmentId, bytes32 workHash) = _reserve(grantId, operationId, provider, evaluator);
        // Mirror balances that Arc's native transfer system contract would move.
        // 1 USDC ERC-20 unit (6 decimals) maps to 1e12 native units (18 decimals).
        vm.deal(address(VAULT), 100_000 * 1e12);
        vm.deal(address(ADAPTER), 100_000 * 1e12);
        vm.deal(address(ESCROW), 100_000 * 1e12);
        uint256 jobId = ADAPTER.dispatch(commitmentId);
        vm.prank(provider);
        ESCROW.setBudget(jobId, 100_000, "");
        ADAPTER.fund(commitmentId);
        _assertFunded(jobId, provider, evaluator);
        _completeAndReconcile(jobId, commitmentId, workHash, provider, evaluator);
        _assertSettled(ledgerBefore, activeBefore);
    }

    function _fundAndCreateGrant(bytes32 grantId, address provider, address evaluator) private {
        uint256 amount = 100_000; // 0.1 USDC on the local fork only.

        vm.prank(OWNER);
        USDC.approve(address(VAULT), amount);
        vm.prank(OWNER);
        VAULT.deposit(amount);

        address[] memory providers = new address[](1);
        providers[0] = provider;
        address[] memory evaluators = new address[](1);
        evaluators[0] = evaluator;
        bytes32 rootGrantId = VAULT.ROOT_GRANT_ID();
        vm.prank(OWNER);
        VAULT.createGrant(grantId, rootGrantId, OWNER, amount, block.timestamp + 2 days, providers, evaluators);
    }

    function _reserve(bytes32 grantId, bytes32 operationId, address provider, address evaluator)
        private
        returns (bytes32 commitmentId, bytes32 workHash)
    {
        uint256 amount = 100_000;
        workHash = keccak256("arc-testnet-fork-deliverable");
        BudgetVault.ReservationInput memory input = BudgetVault.ReservationInput({
            grantId: grantId,
            operationId: operationId,
            provider: provider,
            evaluator: evaluator,
            token: address(USDC),
            adapter: address(ADAPTER),
            amount: amount,
            quoteExpiresAt: block.timestamp + 15 minutes,
            jobExpiresAt: block.timestamp + 1 hours,
            workHash: workHash,
            nonce: keccak256("arc-testnet-fork-nonce")
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PROVIDER_TEST_KEY, VAULT.quoteDigest(input));
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(OWNER);
        commitmentId = VAULT.reserve(input, signature);
    }

    function _assertFunded(uint256 jobId, address provider, address evaluator) private view {
        IAgenticCommerce.Job memory fundedJob = ESCROW.getJob(jobId);
        require(fundedJob.client == address(ADAPTER), "escrow client binding");
        require(fundedJob.provider == provider, "escrow provider binding");
        require(fundedJob.evaluator == evaluator, "escrow evaluator binding");
        require(fundedJob.budget == 100_000, "escrow budget binding");
        require(fundedJob.status == IAgenticCommerce.Status.Funded, "escrow not funded");
    }

    function _completeAndReconcile(
        uint256 jobId,
        bytes32 commitmentId,
        bytes32 workHash,
        address provider,
        address evaluator
    ) private {
        vm.prank(provider);
        ESCROW.submit(jobId, workHash, "");
        vm.prank(evaluator);
        ESCROW.complete(jobId, keccak256("accepted-on-local-fork"), "");
        ADAPTER.reconcile(commitmentId);
    }

    function _assertSettled(BudgetVault.Ledger memory ledgerBefore, uint256 activeBefore) private view {
        uint256 amount = 100_000;
        BudgetVault.Ledger memory ledger = VAULT.ledger();
        require(ledger.deposited == ledgerBefore.deposited + amount, "deposit accounting");
        require(
            ledger.available == ledgerBefore.available && ledger.reserved == ledgerBefore.reserved
                && ledger.inEscrow == ledgerBefore.inEscrow,
            "non-terminal balance"
        );
        require(
            ledger.settled == ledgerBefore.settled + amount && ledger.withdrawn == ledgerBefore.withdrawn,
            "settlement accounting"
        );
        require(VAULT.activeCommitments() == activeBefore, "active commitment not released");
    }
}
