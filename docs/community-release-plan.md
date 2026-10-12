# Community alpha release plan

Authorized by the owner on 2026-10-12: publish `duclucky/agent-commitments`, keep one monorepo, make the alpha usable by an external builder, and propose focused upstream contributions. This does not authorize new on-chain spending, X posts or Showcase submissions.

## Acceptance checks

1. English README, integration guide, quickstarts, contribution/security guidance and SDK reference describe the current deployment and limitations consistently.
2. A release SDK archive installs in an isolated project with no workspace links, database, console, Circle credential or private key. JavaScript import and TypeScript declarations both work.
3. A prepare-only starter and reproducible local lifecycle let a builder learn before using shared networks. Install/build/default tests never broadcast to a shared network.
4. Source and release contents are inspected before publication. Local credential files, provider keystore, signed transaction journal and operator payloads are excluded.
5. Publish an experimental GitHub release with a real initial commit, SDK archive, checksums and validation evidence. CI status is reported honestly.
6. Inspect upstream scope and existing PRs. Prepare or submit one useful, narrowly scoped contribution when a distinct change is supported by evidence; never fabricate a contribution or duplicate an existing PR.

## Status

- Complete locally: standalone SDK packaging, isolated npm install, ESM starter and TypeScript declarations.
- Complete locally: English primary builder docs, selected public pilot evidence, source/runtime/receipt verification and publication content scan.
- In progress: clean-source check, GitHub publication and release/CI verification.
- Prepared: scoped arc-escrow wallet bootstrap/recovery documentation contribution, after checking existing PRs to avoid duplicate clone-URL and ERC-8183 integration changes.

Independent security review and external adoption remain pending. This release is an experimental builder toolkit, not a production safety certification.
