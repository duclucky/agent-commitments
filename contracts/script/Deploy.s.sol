// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {BudgetVault} from "../src/BudgetVault.sol";
import {ERC8183Adapter} from "../src/ERC8183Adapter.sol";

interface VmDeploy {
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deployment script. Forge only broadcasts when the operator adds
/// `--broadcast`; simulation remains the default. OWNER_ADDRESS must equal the
/// configured external sender so the one-time adapter binding can be applied.
contract Deploy {
    VmDeploy private constant vm = VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (BudgetVault vault, ERC8183Adapter adapter) {
        address token = vm.envAddress("TOKEN_ADDRESS");
        address escrow = vm.envAddress("ESCROW_ADDRESS");
        address owner = vm.envAddress("OWNER_ADDRESS");
        uint256 rootExpiresAt = vm.envUint("ROOT_EXPIRES_AT");
        uint256 depositCap = vm.envUint("DEPOSIT_CAP");
        uint256 maxCommitmentAmount = vm.envUint("MAX_COMMITMENT_AMOUNT");
        uint256 maxConcurrentCommitments = vm.envUint("MAX_CONCURRENT_COMMITMENTS");

        vm.startBroadcast();
        vault = new BudgetVault(token, owner, rootExpiresAt, depositCap, maxCommitmentAmount, maxConcurrentCommitments);
        adapter = new ERC8183Adapter(address(vault), escrow, token);
        vault.setAdapter(address(adapter));
        vm.stopBroadcast();
    }
}
