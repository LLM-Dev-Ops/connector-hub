# ADR-004: Pinning Upstream Git Dependencies to Immutable Refs

**Status:** Proposed
**Date:** 2026-07-27
**Decision Makers:** connector-hub maintainers, LLM-Dev-Ops ecosystem owners
**Technical Story:** Make connector-hub builds reproducible and resolve the duplicate `llm-config-core` in the committed lockfile

## Context

`connector-hub` depends on three sibling repositories at compile time, and all
three are declared as floating branch references.

`/workspace/agentics-dev/connector-hub/Cargo.toml`, lines 26-30, verbatim:

```toml
# Upstream compile-time dependencies (git dependencies)
schema-registry-core = { git = "https://github.com/LLM-Dev-Ops/schema-registry", branch = "main" }
llm-config-core = { git = "https://github.com/LLM-Dev-Ops/config-manager", branch = "main" }
llm-observatory-core = { git = "https://github.com/LLM-Dev-Ops/observatory", branch = "main" }
```

These are `[workspace.dependencies]`, consumed by the one library crate in the
workspace. `crates/core/Cargo.toml`, lines 26-29:

```toml
# Upstream compile-time dependencies - Phase 2A mandatory requirements
schema-registry-core.workspace = true
llm-config-core.workspace = true
llm-observatory-core.workspace = true
```

`branch = "main"` is not a version constraint. It instructs Cargo to resolve to
whatever commit `main` points at during resolution. `Cargo.lock` is committed
(confirmed tracked via `git ls-files`), which masks the problem locally — but a
lockfile only holds while nothing re-resolves. `cargo update`, adding any new
dependency, a merge conflict resolved by regenerating the lockfile, or any build
that does not pass `--locked` will silently advance all three pins to whatever
upstream `main` happens to be at that moment. A build that was green yesterday
can be red today with no commit in this repository.

### The failure has already occurred

This is not a hypothetical risk. The committed `Cargo.lock` already contains
**two distinct copies of `llm-config-core` at the same version `0.5.0`**,
resolved from two different git refs.

`Cargo.lock:1144-1146` — the tag-pinned copy:

```
name = "llm-config-core"
version = "0.5.0"
source = "git+https://github.com/LLM-Dev-Ops/config-manager?tag=v0.5.1#acc734dd11ee8911ec62aee59b32ff4fbf6e7655"
```

`Cargo.lock:1163-1165` — the branch-floating copy:

```
name = "llm-config-core"
version = "0.5.0"
source = "git+https://github.com/LLM-Dev-Ops/config-manager?branch=main#4014f4eaa2d96ab966b9b9c4834533fe1afb3c05"
```

Same name, same version, two different commits: `acc734dd` and `4014f4ea`.

The origin of each is traceable. `schema-registry-core` — itself pulled from
`branch = "main"` at `65d7501b` (`Cargo.lock:1827-1829`) — depends on the
**tag-pinned** copy (`Cargo.lock:1839`):

```
 "llm-config-core 0.5.0 (git+https://github.com/LLM-Dev-Ops/config-manager?tag=v0.5.1)",
```

Meanwhile `connector-hub-core` depends on the **branch** copy
(`Cargo.lock:429`):

```
 "llm-config-core 0.5.0 (git+https://github.com/LLM-Dev-Ops/config-manager?branch=main)",
```

Cargo treats git dependencies from different sources as different packages even
when name and version match, so both are compiled into the graph. Their contents
already differ — the `branch=main` copy declares `async-trait` and `tempfile`
dependencies that the `tag=v0.5.1` copy does not (`Cargo.lock:1147-1158` vs
`1166-1177`). The duplication propagates: `llm-config-crypto` and
`llm-config-storage` are each present twice for the same reason.

The practical consequence is that a `Config` type produced by
`schema-registry-core` and a `Config` type expected by `connector-hub-core` are
**different types to the compiler**, despite identical source. Any attempt to
pass one where the other is expected produces a "mismatched types — perhaps two
versions of crate `llm-config-core` are being used?" error. This is the classic
diamond dependency failure, and it is sitting in the committed lockfile now.

Note the asymmetry that makes the fix obvious: `schema-registry` — an upstream
repo — already pins its own dependency to `tag = "v0.5.1"`. connector-hub is the
one floating. Adopting the upstream repo's existing discipline collapses the
diamond.

### Why this went unnoticed

`.github/workflows/ci.yml` contains **no cargo invocation**. Its jobs are
`npm ci`, `npm run lint`, `npm run format:check`, and `npm run typecheck` — the
pipeline builds the TypeScript side of the repository only. `cloudbuild.yaml`
likewise contains no `cargo` step. The Rust workspace holding all three floating
dependencies is never compiled by automation, so neither the reproducibility gap
nor the existing duplicate has ever failed a build.

This means the pinning decision below is necessary but not sufficient: without a
CI job that actually compiles the workspace, the next regression is equally
invisible.

### Related

`incident-manager` sits at the opposite extreme — it disabled all five of its
ecosystem dependencies rather than pin them, with a manifest comment blaming
"upstream dependency issues"
(`incident-manager/Cargo.toml:43-50`, see
`incident-manager/docs/adr/ADR-0001-re-enabling-llm-dev-ops-ecosystem-dependencies.md`).
The two repos are living out the two failure modes of unpinned git
dependencies: silent breakage, and total disconnection. Both resolve to the same
policy.

## Decision

We will **pin all three upstream git dependencies to immutable refs**, and
establish a **deliberate, reviewable process for advancing those pins**.

1. **Every git dependency declares `tag` (preferred) or `rev`. No
   `branch = ` in any manifest in this repository.** A tag is human-readable and
   maps to an upstream release; a `rev` SHA is the fallback when an upstream has
   not yet cut one. Both are immutable from this repository's perspective.
2. **`llm-config-core` is pinned to `tag = "v0.5.1"`** — matching what
   `schema-registry-core` already requires. This is what collapses the diamond
   into a single copy. Any other choice for this specific dependency requires
   `schema-registry` to move first.
3. **Pins advance only through a dedicated dependency-update pull request**, one
   that touches `Cargo.toml` and `Cargo.lock` and nothing else. Bumping a pin as
   an incidental part of a feature PR is prohibited, because it hides an
   upstream behaviour change inside an unrelated diff.
4. **`cargo update` is not run casually.** With pins in place, `cargo update`
   cannot advance a git dependency past its pin — that is the point — but it can
   still churn registry dependencies. Lockfile changes belong in their own PR.
5. **CI compiles the Rust workspace with `--locked`.** `--locked` fails the
   build if `Cargo.lock` would need to change, which is what converts the policy
   from a convention into an enforced invariant.
6. **CI fails on duplicate `llm-*` crates.** `cargo tree --duplicates` gates the
   build, so a reintroduced diamond is caught at PR time rather than discovered
   in a compile error weeks later.

### Rejected alternatives

- **Keep `branch = "main"` and rely on the committed `Cargo.lock`.** This is
  effectively today's approach and it has already failed — the duplicate is in
  the lockfile. A lockfile records a resolution; it does not constrain the next
  one. It is also useless to any downstream consumer, since lockfiles are
  ignored for dependencies.
- **`[patch.'https://github.com/LLM-Dev-Ops/config-manager']` to force a single
  version.** Would unify the two copies without pinning, but silently overrides
  what `schema-registry-core` asked for. If the two commits are genuinely
  incompatible, `patch` converts a clear duplicate-crate error into a subtle
  runtime misbehaviour. Patching is a temporary override, not a dependency
  policy.
- **`path` dependencies onto the sibling checkouts.** Only resolves inside a
  workspace laid out exactly like this one. Breaks `Dockerfile` and any CI that
  clones a single repository.
- **Vendor the upstream sources into this repo.** Removes the coordination
  problem by removing the dependency relationship, at the cost of permanent
  divergence. Wrong trade for crates under active development in the same
  ecosystem.
- **Publish all three to crates.io and depend on versions.** The correct
  end-state and fully compatible with this ADR — migrating a `tag` pin to a
  registry `version` is a one-line change per dependency. But it requires
  publishing decisions across three repositories and is not a prerequisite for
  fixing a broken lockfile today.

### Target state

```toml
# Upstream compile-time dependencies — pinned to immutable refs. See ADR-004.
# Bump only via a dedicated dependency-update PR.
schema-registry-core = { git = "https://github.com/LLM-Dev-Ops/schema-registry", tag = "vX.Y.Z" }
llm-config-core      = { git = "https://github.com/LLM-Dev-Ops/config-manager",  tag = "v0.5.1" }
llm-observatory-core = { git = "https://github.com/LLM-Dev-Ops/observatory",     tag = "vX.Y.Z" }
```

Where an upstream has not tagged, the interim form is
`rev = "<full-40-char-sha>"` using the SHA already recorded in `Cargo.lock`:
`65d7501bcd6649f63e945e8f9d987e11ea58963f` for `schema-registry`
(`Cargo.lock:1829`) and `6813701693cc85094ea6c52cb00ad4911446b096` for
`observatory` (`Cargo.lock:1263`). Using the SHA already in the lockfile means
the pin introduces **no** change to the resolved graph — the diff is provably
inert, which makes it safe to land ahead of the `llm-config-core` fix.

### Pin bump process

A dependency-update PR must:

1. Change only `Cargo.toml` and `Cargo.lock`.
2. State in its description which upstream tag/SHA it moves from and to, and
   link the upstream changelog or commit range.
3. Pass `cargo build --locked --workspace` and `cargo test --locked --workspace`.
4. Pass `cargo tree --duplicates` with no `llm-*` or `schema-registry-*`
   duplicates.
5. Bump **one** upstream at a time where possible. When two must move together —
   as `schema-registry-core` and `llm-config-core` do, being coupled — say so
   explicitly in the description and explain the coupling.

Cadence: scheduled review of available upstream tags at a fixed interval, plus
out-of-band bumps for security fixes. Pins do not advance because someone ran
`cargo update`.

## Consequences

### Positive

- Builds become reproducible. The same commit resolves to the same dependency
  graph indefinitely, including in Docker and on a fresh clone.
- The existing duplicate `llm-config-core` is eliminated, removing a compile
  error that is currently latent and will surface the moment code passes a
  config type across the `schema-registry-core` boundary.
- Upstream breaking changes arrive in a reviewable PR attributable to a person,
  not as a mystery failure on an unrelated branch.
- `git bisect` becomes meaningful for this repository. Under floating branches,
  an old commit does not rebuild the way it originally built.
- CI actually compiles the Rust workspace for the first time, closing the gap
  that let this defect persist.

### Negative

- Upstream fixes no longer arrive automatically. Every bump is manual work, and
  pins will drift stale without the scheduled review. This is the deliberate
  trade: visible staleness over invisible breakage.
- Pinning `llm-config-core` to `v0.5.1` gives up whatever has landed on
  `config-manager` `main` since `4014f4ea` — including the `async-trait` support
  visible in the lockfile diff. If connector-hub needs that, `schema-registry`
  must bump its own pin first, and this repo is blocked behind it. That
  ordering constraint is real and should be surfaced early.
- Turning on `--locked` and a duplicate check in CI will likely fail the first
  build. That failure is the pre-existing defect becoming visible, not a
  regression introduced by this ADR — but it must be budgeted for.
- Coordinating three upstream repos to cut tags is cross-team work.

### Neutral

- `tag` is not perfectly immutable — a tag can be force-moved upstream. `rev`
  is stronger. We accept `tag` for readability and treat tag mutation as an
  ecosystem-level policy violation, not a technical control.
- The ordering of Cargo's resolution means this ADR must be implemented before
  any further Rust development on `crates/core`, or that work will be built
  against a graph that is about to change.

## Implementation Plan

1. **Baseline the current graph.** Record `cargo tree --workspace` and
   `cargo tree --duplicates` output from the committed lockfile, so the effect
   of each subsequent step is measurable against a known starting point.
2. **Pin `schema-registry-core` and `llm-observatory-core` to the SHAs already
   in `Cargo.lock`** (`65d7501b...`, `6813701693...`) using `rev = `. Verify
   `Cargo.lock` is byte-identical afterwards — if it changes, something else is
   wrong and must be understood before proceeding.
3. **Request tags from `schema-registry` and `observatory`** for those commits
   or a later known-good one, then replace the `rev` pins with `tag` pins in a
   follow-up. Interim `rev` pins are acceptable indefinitely; they are not a
   reason to delay step 2.
4. **Resolve the `llm-config-core` diamond.** Change the workspace pin from
   `branch = "main"` to `tag = "v0.5.1"`, matching `schema-registry-core`.
   Regenerate `Cargo.lock`.
5. **Verify the diamond is gone** — exactly one `llm-config-core`,
   `llm-config-crypto`, and `llm-config-storage` entry each in `Cargo.lock`.
6. **Fix the resulting compile errors.** Dropping from `main` to `v0.5.1` may
   remove APIs `crates/core` uses. If `v0.5.1` is genuinely insufficient, stop
   and instead drive `schema-registry` to bump its `llm-config-core` pin
   forward — do **not** reintroduce a second copy, and do not reach for
   `[patch]`.
7. **Add a Rust CI job** to `.github/workflows/ci.yml` running
   `cargo build --locked --workspace` and `cargo test --locked --workspace`.
   This is the step that makes everything above enforceable.
8. **Add a duplicate-dependency gate** to the same workflow, failing on any
   duplicate `llm-*` or `schema-registry-*` crate.
9. **Add a manifest lint** rejecting the literal string `branch = ` in any
   `Cargo.toml`, so the pattern cannot return via a future PR.
10. **Document the bump process** in `CONTRIBUTING` or `docs/`, linking this
    ADR, and set up the scheduled upstream-tag review.
11. **Update the comment on `Cargo.toml:26`** from "Upstream compile-time
    dependencies (git dependencies)" to reference this ADR and the
    no-casual-bumps rule.

Step 2 is inert and can land immediately. Steps 4-6 carry real risk and should
be a separate PR. Steps 7-9 should land before or alongside step 4, so the
duplicate check demonstrates the fix rather than merely asserting it.

## Verification

The decision is implemented when all of the following hold:

1. `grep -rn 'branch = ' --include=Cargo.toml .` returns no results anywhere in
   the repository.
2. `grep -n 'git = ' Cargo.toml` shows all three dependencies, each carrying a
   `tag = ` or `rev = `.
3. `grep -c 'name = "llm-config-core"' Cargo.lock` returns `1`. The same holds
   for `llm-config-crypto` and `llm-config-storage`.
4. `grep -c 'branch=main' Cargo.lock` returns `0`.
5. `cargo build --locked --workspace` succeeds — proving `Cargo.lock` is
   consistent with the manifests and nothing re-resolves at build time.
6. `cargo test --locked --workspace` succeeds.
7. `cargo tree --duplicates` reports no duplicate `llm-*` or
   `schema-registry-*` crate.
8. A force-push to any upstream `main` produces **no** change in this
   repository's resolved graph — verifiable by running
   `cargo update -p llm-config-core` and confirming `Cargo.lock` is unchanged.
9. `.github/workflows/ci.yml` contains a job invoking `cargo` with `--locked`,
   and that job appears in the checks of a pull request.
10. The manifest lint from step 9 fails when `branch = "main"` is deliberately
    reintroduced — test the guard by breaking it once, then reverting.
11. Two consecutive clean clones and builds of the same commit, a week apart,
    produce identical `cargo tree --workspace` output.

Checks 3 and 7 confirm the existing defect is repaired. Checks 5, 8, and 10
confirm it cannot silently return. Check 9 is the one that has been missing all
along — without it, every other check is a one-time snapshot rather than an
invariant.
