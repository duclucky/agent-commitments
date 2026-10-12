// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.30;

import {AgenticCommerceEscrow} from "../src/AgenticCommerceEscrow.sol";
import {ERC8183DraftAdapter} from "../src/ERC8183DraftAdapter.sol";

interface VmDraftDeploy {
    function envAddress(string calldata name) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploys an unbound, unfunded candidate pair. Binding remains a separate irreversible action.
contract DeployDraftCandidate {
    VmDraftDeploy private constant vm = VmDraftDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (AgenticCommerceEscrow escrow, ERC8183DraftAdapter adapter) {
        address token = vm.envAddress("TOKEN_ADDRESS");
        address vault = vm.envAddress("VAULT_ADDRESS");
        address owner = vm.envAddress("OWNER_ADDRESS");

        vm.startBroadcast();
        escrow = new AgenticCommerceEscrow(token, owner);
        adapter = new ERC8183DraftAdapter(vault, address(escrow), token);
        vm.stopBroadcast();
    }
}
