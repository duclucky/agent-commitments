import { parseAbi } from "viem";

export const resolveSignalVaultAbi = parseAbi([
  "function factory() view returns (address)",
  "function token() view returns (address)",
  "function operator() view returns (address)",
  "function treasury() view returns (address)",
  "function payer() view returns (address)",
  "function callId() view returns (bytes32)",
  "function amount() view returns (uint256)",
  "function validBefore() view returns (uint64)",
  "function completeBy() view returns (uint64)",
  "function status() view returns (uint8)",
]);

export const resolveSignalFactoryAbi = parseAbi([
  "function token() view returns (address)",
  "function operator() view returns (address)",
  "function treasury() view returns (address)",
  "function vaults(bytes32) view returns (address)",
]);
