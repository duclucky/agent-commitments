# Security policy

Experimental alpha: testnet integration and a limited owner-authorized internal mainnet pilot have been tested. Independent security review remains pending. Circle Arc Studio provided tool-assisted self-review, not an independent audit/certification. The pilot exception does not authorize broader production use.

## Report privately

Use GitHub **Security → Report a vulnerability** in this repository when enabled. Never publish exploitable details or attach keys, seed phrases, tokens or customer data. If the channel is unavailable, open a minimal issue requesting a private channel without vulnerability details.

Provide the version/commit, preconditions, impact and a minimal local reproduction. The maintainer should acknowledge, triage, fix and coordinate disclosure. No response-time SLA or bounty is promised.

## Scope and limits

- Contracts govern supported budget flows, not unrelated wallet spending or private keys.
- The mainnet vault is non-upgradeable and binds its adapter once. Quotes require ECDSA EOAs, not ERC-1271 providers.
- Evaluator trust and issuer restrictions affect acceptance and refund liveness; receipt evidence does not prove service quality.
- Direct vault transfers are unassigned, with no rescue function in this version.
- MockUSDC/LocalAgenticCommerce and public Anvil keys are local-only.
- API/console/runtime are reference implementations. Hosted deployment needs its own access controls, rate limits, TLS, monitoring and backups.
- Live CCTP, Gateway, AP2 and x402 support is not certified by this release.

Read the [threat model](docs/threat-model.md), [recovery](docs/runbooks/recovery.md) and [capability matrix](docs/capability-matrix.md). Passing tests, source verification and internal pilot evidence do not replace independent review.
