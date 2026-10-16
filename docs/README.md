# Documentation index

## Current builder guidance

Start with the [project README](../README.md), then:

- [Integration guide](integration.md): boundaries and integration options.
- [SDK reference](sdk-api.md): supported SDK surface.
- [ResolveSignal x402 exact](integrations/resolvesignal-x402.md): existing Circle wallet, quote checks and recovery; no new contracts.
- [Architecture](architecture.md) and [threat model](threat-model.md).
- [Recovery runbook](runbooks/recovery.md): unknown transactions and restart recovery.
- [Security policy](../SECURITY.md): review limits and vulnerability reporting.
- [Contributing](../CONTRIBUTING.md): local checks and safe examples.
- [Experimental release](https://github.com/duclucky/agent-commitments/releases/tag/v0.1.0-alpha.1)
  and [publication verification](releases/v0.1.0-alpha.1-verification.json).

Agent Commitments is a developer primitive for shared USDC budgets and payment
obligations. It is listed in [ResolveSignal Toolkits](https://resolvesignal.com/toolkits)
alongside the hosted API Integration Kit. Direct x402 integration is locally
verified; live Circle paid testing and independent
security review remain pending. Agent Starter is planned. Circle Agent Wallet
and Arc Portal continue to own wallet custody, funding and spending limits.

## Evidence and decisions

The [mainnet pilot record](deployments/arc-mainnet-pilot-2026-10-12.md) describes
internal controlled-wallet tests, not external traction. [ADR records](adr/)
explain architecture decisions and supported protocol subsets. Source verification
or tool-assisted self-review is not an independent security audit.

## Historical plans and drafts

[Implementation plan](implementation-plan.md), dated research, audit/operator
notes, and [showcase draft](showcase-draft.md) preserve their original context.
They may contain Vietnamese, local paths or proposed interfaces. They are not
the current installation guide or evidence of completed features. Use the builder
guides and release evidence above to determine current support. The showcase
copy is prepared content, not evidence of a submitted or published post.
