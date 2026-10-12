import { encodeAbiParameters, hashTypedData, keccak256, type Address, type Hex } from "viem";

export interface Quote {
  readonly grantId: Hex;
  readonly operationId: Hex;
  readonly provider: Address;
  readonly evaluator: Address;
  readonly token: Address;
  readonly adapter: Address;
  readonly amount: bigint;
  readonly quoteExpiresAt: bigint;
  readonly jobExpiresAt: bigint;
  readonly workHash: Hex;
  readonly nonce: Hex;
}

export const quoteTypes = {
  Quote: [
    { name: "grantId", type: "bytes32" }, { name: "operationId", type: "bytes32" },
    { name: "provider", type: "address" }, { name: "evaluator", type: "address" },
    { name: "token", type: "address" },
    { name: "adapter", type: "address" },
    { name: "amount", type: "uint256" }, { name: "quoteExpiresAt", type: "uint256" },
    { name: "jobExpiresAt", type: "uint256" }, { name: "workHash", type: "bytes32" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function quoteTypedData(chainId: number, vault: Address, quote: Quote) {
  return {
    domain: { name: "AgentCommitments", version: "1", chainId, verifyingContract: vault },
    types: quoteTypes,
    primaryType: "Quote" as const,
    message: quote,
  };
}

export function quoteDigest(chainId: number, vault: Address, quote: Quote): Hex {
  return hashTypedData(quoteTypedData(chainId, vault, quote));
}

export function deriveCommitmentId(chainId: number, vault: Address, grantId: Hex, operationId: Hex): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
    [BigInt(chainId), vault, grantId, operationId],
  ));
}
