export const budgetVaultAbi = [
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "setPaused", stateMutability: "nonpayable", inputs: [{ name: "value", type: "bool" }], outputs: [] },
  { type: "function", name: "depositCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxCommitmentAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxConcurrentCommitments", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "activeCommitments", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isProviderAllowed", stateMutability: "view", inputs: [
    { name: "grantId", type: "bytes32" }, { name: "provider", type: "address" },
  ], outputs: [{ type: "bool" }] },
  { type: "function", name: "isEvaluatorAllowed", stateMutability: "view", inputs: [
    { name: "grantId", type: "bytes32" }, { name: "evaluator", type: "address" },
  ], outputs: [{ type: "bool" }] },
  { type: "function", name: "ledger", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: [
    { name: "deposited", type: "uint256" }, { name: "available", type: "uint256" },
    { name: "reserved", type: "uint256" }, { name: "inEscrow", type: "uint256" },
    { name: "settled", type: "uint256" }, { name: "withdrawn", type: "uint256" },
  ] }] },
  { type: "function", name: "reservations", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ type: "tuple", components: [
    { name: "grantId", type: "bytes32" }, { name: "provider", type: "address" },
    { name: "evaluator", type: "address" }, { name: "amount", type: "uint256" },
    { name: "jobExpiresAt", type: "uint256" }, { name: "workHash", type: "bytes32" },
    { name: "termsHash", type: "bytes32" }, { name: "status", type: "uint8" },
  ] }] },
  { type: "function", name: "createGrant", stateMutability: "nonpayable", inputs: [
    { name: "grantId", type: "bytes32" }, { name: "parentId", type: "bytes32" },
    { name: "grantee", type: "address" }, { name: "cap", type: "uint256" }, { name: "expiresAt", type: "uint256" },
    { name: "providers", type: "address[]" }, { name: "evaluators", type: "address[]" },
  ], outputs: [] },
  { type: "function", name: "revokeGrant", stateMutability: "nonpayable", inputs: [{ name: "grantId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "reserve", stateMutability: "nonpayable", inputs: [
    { name: "input", type: "tuple", components: [
      { name: "grantId", type: "bytes32" }, { name: "operationId", type: "bytes32" },
      { name: "provider", type: "address" }, { name: "evaluator", type: "address" },
      { name: "token", type: "address" },
      { name: "adapter", type: "address" },
      { name: "amount", type: "uint256" }, { name: "quoteExpiresAt", type: "uint256" },
      { name: "jobExpiresAt", type: "uint256" }, { name: "workHash", type: "bytes32" }, { name: "nonce", type: "bytes32" },
    ] },
    { name: "providerSignature", type: "bytes" },
  ], outputs: [{ name: "id", type: "bytes32" }] },
  { type: "function", name: "cancelReservation", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }], outputs: [] },
  { type: "function", name: "withdrawAvailable", stateMutability: "nonpayable", inputs: [{ name: "recipient", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [
    { name: "spender", type: "address" }, { name: "amount", type: "uint256" },
  ], outputs: [{ type: "bool" }] },
] as const;

export const adapterAbi = [
  { type: "function", name: "jobs", stateMutability: "view", inputs: [{ name: "commitmentId", type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "dispatch", stateMutability: "nonpayable", inputs: [{ name: "commitmentId", type: "bytes32" }], outputs: [{ name: "jobId", type: "uint256" }] },
  { type: "function", name: "fund", stateMutability: "nonpayable", inputs: [{ name: "commitmentId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "reconcile", stateMutability: "nonpayable", inputs: [{ name: "commitmentId", type: "bytes32" }], outputs: [] },
] as const;

export const agenticCommerceAbi = [
  { type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ type: "tuple", components: [
    { name: "id", type: "uint256" }, { name: "client", type: "address" },
    { name: "provider", type: "address" }, { name: "evaluator", type: "address" },
    { name: "description", type: "string" }, { name: "budget", type: "uint256" },
    { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" },
    { name: "hook", type: "address" },
  ] }] },
  { type: "function", name: "setBudget", stateMutability: "nonpayable", inputs: [
    { name: "jobId", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "optParams", type: "bytes" },
  ], outputs: [] },
  { type: "function", name: "submit", stateMutability: "nonpayable", inputs: [
    { name: "jobId", type: "uint256" }, { name: "deliverable", type: "bytes32" }, { name: "optParams", type: "bytes" },
  ], outputs: [] },
  { type: "function", name: "complete", stateMutability: "nonpayable", inputs: [
    { name: "jobId", type: "uint256" }, { name: "reason", type: "bytes32" }, { name: "optParams", type: "bytes" },
  ], outputs: [] },
  { type: "function", name: "reject", stateMutability: "nonpayable", inputs: [
    { name: "jobId", type: "uint256" }, { name: "reason", type: "bytes32" }, { name: "optParams", type: "bytes" },
  ], outputs: [] },
  { type: "function", name: "claimRefund", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
] as const;

export const agenticCommerceDraftAbi = [
  ...agenticCommerceAbi,
  { type: "function", name: "setProvider", stateMutability: "nonpayable", inputs: [
    { name: "jobId", type: "uint256" }, { name: "provider", type: "address" }, { name: "optParams", type: "bytes" },
  ], outputs: [] },
  { type: "function", name: "fund", stateMutability: "nonpayable", inputs: [
    { name: "jobId", type: "uint256" }, { name: "expectedBudget", type: "uint256" }, { name: "optParams", type: "bytes" },
  ], outputs: [] },
] as const;
