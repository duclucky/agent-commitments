# Showcase draft — chưa công bố

Không dùng nguyên văn cho đến khi các placeholder có bằng chứng và người dùng cho phép công bố.

This is historical prepared submission copy, not a published post. Use the [current documentation index](README.md) for builder instructions and verified release status.

## Product summary

Agent Commitments gives teams of autonomous agents a shared USDC budget with hierarchical grants, reservation accounting, escrow dispatch and crash-safe reconciliation on Arc. The reusable primitive separates economic state from transaction transport state so RPC timeouts do not become duplicate payments.

## Evidence required before submission

- Public source: [agent-commitments](https://github.com/duclucky/agent-commitments); experimental [v0.1.0-alpha.1 release](https://github.com/duclucky/agent-commitments/releases/tag/v0.1.0-alpha.1); [ResolveSignal Toolkits](https://resolvesignal.com/toolkits). Publication of this source does not imply submission of this draft or an independent Agent Commitments showcase entry.
- Arc Mainnet pilot: vault `0x2415a87B0b9280C1989F03ceA9DC1c3644777862`, escrow `0x19E14a1006d106882D4c24584AAA6Ce1771E4151`, adapter v2 `0x0db5f0CC38F86e60FEbe495d4fFAF2Bb0288704d`; bound, internally tested with 0.01 USDC refund and 0.005 USDC settlement plus withdraw. [19 canonical receipts](deployments/arc-mainnet-pilot-2026-10-12.md). Internal controlled-wallet tests, not independent customer traction.
- Arc Testnet evidence: vault `0x0A1AbBf8b795e30F305C54C53A2404a595aF923a`, adapter `0x18EF2ad61947800e9F3574b65cee4fd2b4361a4a`; settlement job `186887`, recovery job `186888`, independent-role job `186889`
- Explorer receipts: settlement/recovery/multi-role receipts recorded in `docs/deployments/arc-testnet-2026-10-11.md`; source verification package prepared and bytecode-matched, publication `[pending authorization]`
- Independent users, settled jobs, refunds and repeat workloads: `[pending; exclude team/test traffic]`
- Tool-assisted self-review: [Circle Arc Studio audit](audits/arc-studio-audit-2026-10-12.md), including reproducible local PoCs. Slither coverage is partial; independent review remains pending. Current provider quotes require an ECDSA EOA; ERC-1271 provider signatures are unsupported. Issuer restrictions, evaluator trust, one-time binding and unassigned transfers are documented limitations.

## Experience note outline

1. The concrete duplicate-payment/shared-budget failure observed with a pilot.
2. Why Arc's USDC-first fee model and fast confirmation matter for agent jobs.
3. How `D=A+R+E+S+W`, signed quotes and ERC-8183 adapter interact.
4. A real recovery incident and how expected transaction hashes avoided a resend.
5. Limits: evaluator trust, supported asset/network, no claim of universal global coverage.

Only after evidence and authorization: publish the X post, then run current `submit-showcase` and `update-traction` commands verified from CLI help.

## X copy prepared after internal mainnet pilot — not posted

Building Agent Commitments: shared USDC budgets for agent teams on Arc. Signed quotes, reservations and reconciliation keep economic obligations separate from RPC delivery status. Our internal mainnet pilot exercised a 0.01 USDC refund, reused that budget for a 0.005 USDC settlement, and withdrew the remainder. The read-only console checks live ledger/backing, pinned contract code and canonical receipts; the SDK also works without our UI or API.

Vault: 0x2415a87B0b9280C1989F03ceA9DC1c3644777862
Adapter v2: 0x0db5f0CC38F86e60FEbe495d4fFAF2Bb0288704d
Escrow: 0x19E14a1006d106882D4c24584AAA6Ce1771E4151

This is controlled-wallet testing, not customer traction. Independent review is pending; the adapter targets a documented subset of the ERC-8183 Draft. Developer guide and repository: [pending publication URL].

This draft may require a thread or a long-post account. Before publishing, replace the URL placeholder, check the current program instructions and confirm the final public destinations. See [mainnet quickstart](quickstart-arc-mainnet.md).
