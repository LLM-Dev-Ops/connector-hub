# OAuth introspection boundary

The fixed `oauth-contract.json` was frozen before implementation. Its 19 holdouts
exercise the exported OAuth validator against a real loopback HTTP introspection
server; nine anchors retain valid, revoked, expired and deadline behavior. Neither
fetch nor token validation is mocked. The 24 existing AuthAgent tests are retained
by identity (they cover other authentication paths too). The new cases live in the
existing AuthAgent suite, alongside those unchanged assertions.

The fix validates the RFC 7662 fields consumed by this validator, including a
literal boolean `active`, bounded integer timestamps and string claims. Active
responses must meet configured audience, issuer, scope and not-before constraints.
Introspection failures return an unauthenticated `unknown` result; a configured
authority cannot be bypassed by JWT structure-only fallback. Optional claims and
unknown extension fields remain supported. An inactive response never returns
identity fields. The abort timer continues through response-body consumption.

This is the exported `AuthAgent` introspection path, **not** the separate pipeline
`AuthIdentityAgent`. Existing no-introspection JWT, Basic and API-key behavior is
unchanged; this work does not claim to make those paths fail closed. Production
issuer/IAM configuration and authoritative scope policy still belong to callers.
No deployment, new persistence, billable provider call or task-data egress occurs.

Use Node 20.20.2 (the existing strict dependency engine check rejects Node 24):

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build -w packages/agentics-contracts
npm test --prefix security
node node_modules/vitest/vitest.mjs run packages/agents/src/__tests__/auth-agent.test.ts --maxWorkers 1 --minWorkers 1
npm ci --prefix security/tools --ignore-scripts --no-audit --no-fund
node --import tsx security/evaluate-oauth.mjs BASELINE CANDIDATE security/tools flywheel.json
node --import tsx security/benchmark-oauth.mjs BASELINE CANDIDATE benchmark.json
```

The original root lock omitted `hono` and did not install reproducibly with npm
10.8.2. Its repair preserves existing package versions and supplies the missing
peer resolution/metadata. For source behavior comparison only, install both
isolated checkouts with this same repaired lock and build agentics-contracts.
Record the original clean-install failure separately; do not call this an original
main build pass. Root lifecycle hooks are not needed by this isolated contract;
the existing broader workflow is unchanged and remains an independent gate.

Flywheel 0.1.12 is pinned under `tools`; it executes the validators for each score,
checks fixed anchors, signs lineage and replays all eight receipt/gate checks.
Thrown/empty results are no-ops; incorrect returned decisions are failures.
`costPerWin=0` is a neutral unmeasured input, not a savings measurement. Rollback
source bytes and SHA-256 are retained in the signed inverse. This component gate
does not authorize merging while repository build, security, coverage or CI fail.

Bounded Darwin 0.10.3 real-mode evaluation may run from `security/`, whose npm test
executes all 28 native HTTP cases. Harness surfaces do not alter the validator;
ties are rejected as `NO_IMPROVEMENT`, not credited as implementation gains.

Rollback: revert the implementation commit (including the npm-lock repair and
opt-in workflow). Verify `git apply --reverse --check` for the source patch before
rollback. No production rollback or package publication is performed here.
