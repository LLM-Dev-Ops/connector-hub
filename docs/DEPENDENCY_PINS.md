# Upstream Dependency Pins

connector-hub compiles against three sibling repositories in the LLM-Dev-Ops
ecosystem. All three are declared in `[workspace.dependencies]` in the root
`Cargo.toml` and pinned to immutable refs, per
[ADR-004](architecture/decisions/ADR-004-pinning-upstream-git-dependencies.md).

| Dependency             | Upstream                      | Pin                                                |
| ---------------------- | ----------------------------- | -------------------------------------------------- |
| `schema-registry-core` | `LLM-Dev-Ops/schema-registry` | `rev = "65d7501bcd6649f63e945e8f9d987e11ea58963f"` |
| `llm-config-core`      | `LLM-Dev-Ops/config-manager`  | `tag = "v0.5.1"`                                   |
| `llm-observatory-core` | `LLM-Dev-Ops/observatory`     | `rev = "6813701693cc85094ea6c52cb00ad4911446b096"` |

A `tag` is preferred for readability. `rev` is the interim form where an upstream
has not cut a release; schema-registry and observatory have no tags yet.

## The llm-config-core coupling

`llm-config-core` is held at `v0.5.1` because `schema-registry-core` requires
that exact tag. Pointing connector-hub at any other ref puts two copies of
`llm-config-core` in the graph, and Cargo treats git dependencies from different
sources as different packages even when name and version match — so a `Config`
from `schema-registry-core` becomes a different type from the `Config`
`connector-hub-core` expects.

Moving `llm-config-core` forward therefore requires `schema-registry` to bump its
own pin first. Do not resolve a duplicate with `[patch]`; that hides a genuine
incompatibility rather than surfacing it.

## Bumping a pin

A dependency-update PR must:

1. Change only `Cargo.toml` and `Cargo.lock`. Bumping a pin as part of a feature
   PR is prohibited — it hides an upstream behaviour change inside an unrelated
   diff.
2. State which upstream tag/SHA it moves from and to, and link the upstream
   changelog or commit range.
3. Pass `cargo build --locked --workspace` and `cargo test --locked --workspace`.
4. Pass `cargo tree --locked --workspace --duplicates` with no `llm-*` or
   `schema-registry-*` duplicates.
5. Move one upstream at a time where possible. When two must move together — as
   `schema-registry-core` and `llm-config-core` must — say so explicitly and
   explain the coupling.

Pins advance through review, not because someone ran `cargo update`.

## Enforcement

**Not yet enforced in CI.** `.github/workflows/ci.yml` still contains no cargo
invocation, so nothing currently stops a floating branch ref or a reintroduced
duplicate from landing. Until the workflow jobs described below exist, run the
checks by hand before merging anything that touches `Cargo.toml`:

```bash
bash scripts/lint-cargo-pins.sh
cargo build --locked --workspace
cargo test --locked --workspace
cargo tree --locked --workspace --duplicates | grep -E '^(llm-|schema-registry-)'
```

The intended CI gate is two jobs:

- `cargo-pins` runs `scripts/lint-cargo-pins.sh`, rejecting a floating branch
  ref in any tracked `Cargo.toml`, any `git = ` without a `tag`/`rev`, and any
  branch-resolved source in `Cargo.lock`.
- `rust` runs `cargo build --locked --workspace` and
  `cargo test --locked --workspace`, then fails on any duplicate `llm-*` or
  `schema-registry-*` crate reported by `cargo tree --duplicates`. `--locked`
  fails the build if `Cargo.lock` would need to change, which is what makes the
  pins an enforced invariant rather than a convention.

This is ADR-004 verification check 9 — "the one that has been missing all
along." Without it every other check here is a one-time snapshot rather than an
invariant.
