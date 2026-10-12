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
- Complete: clean-source install/build/docs checks; SDK tarball is byte-identical when built from the clean clone.
- Complete: public [repository](https://github.com/duclucky/agent-commitments) and experimental [release](https://github.com/duclucky/agent-commitments/releases/tag/v0.1.0-alpha.1), including SDK archive and checksums. Anonymous download and isolated npm install from the published URL passed.
- Complete: [Linux CI](https://github.com/duclucky/agent-commitments/actions/runs/38269940745) passed for release commit `1ce042a6c0c9d0e178072c50a111593939b7f8d7`. The initial run exposed unquoted shell glob expansion; scripts now pass the exclusion pattern literally to Vitest.
- Complete proposal: [circlefin/arc-escrow PR #56](https://github.com/circlefin/arc-escrow/pull/56), ready for maintainer review. It documents non-resumable wallet bootstrap and recovery without duplicating existing clone-URL/ERC-8183 PRs. It has not been merged and is not evidence of Circle endorsement.

See [publication verification](releases/v0.1.0-alpha.1-verification.json) for the public archive checksum, consumer check and release commit. Private vulnerability reporting is enabled on the main repository. No new on-chain transaction, X post or Showcase submission was performed by this release task.

Independent security review and external adoption remain pending. This release is an experimental builder toolkit, not a production safety certification.
