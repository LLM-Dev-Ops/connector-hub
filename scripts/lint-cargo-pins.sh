#!/bin/bash

# Enforces ADR-004: every git dependency in this repository is pinned to an
# immutable ref (`tag` or `rev`). A floating `branch = ` re-splits the
# llm-config-core diamond that ADR-004 collapsed.
# docs/architecture/decisions/ADR-004-pinning-upstream-git-dependencies.md

set -e
set -u
set -o pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

ADR="docs/architecture/decisions/ADR-004-pinning-upstream-git-dependencies.md"
FAILURES=0

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Cargo git-dependency pin lint (ADR-004)${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

MANIFESTS=$(git ls-files '*Cargo.toml')
if [ -z "${MANIFESTS}" ]; then
    echo -e "${RED}✗ No tracked Cargo.toml found — is this the repository root?${NC}"
    exit 1
fi

echo -e "${BLUE}Checking for floating 'branch = ' pins...${NC}"
if BRANCH_HITS=$(grep -n 'branch = ' ${MANIFESTS}); then
    echo -e "${RED}✗ Floating branch pin(s) found:${NC}"
    echo "${BRANCH_HITS}"
    echo ""
    echo -e "${YELLOW}  Replace 'branch = \"main\"' with 'tag = \"vX.Y.Z\"' (preferred)${NC}"
    echo -e "${YELLOW}  or 'rev = \"<full-40-char-sha>\"'. See ${ADR}.${NC}"
    FAILURES=$((FAILURES + 1))
else
    echo -e "${GREEN}✓ No 'branch = ' in any tracked Cargo.toml${NC}"
fi
echo ""

echo -e "${BLUE}Checking every git dependency carries a tag or rev...${NC}"
UNPINNED=$(grep -n 'git = ' ${MANIFESTS} | grep -v 'tag = ' | grep -v 'rev = ' || true)
if [ -n "${UNPINNED}" ]; then
    echo -e "${RED}✗ Git dependency without an immutable ref:${NC}"
    echo "${UNPINNED}"
    echo ""
    echo -e "${YELLOW}  Every 'git = ' must be accompanied by 'tag = ' or 'rev = '. See ${ADR}.${NC}"
    FAILURES=$((FAILURES + 1))
else
    echo -e "${GREEN}✓ All git dependencies pinned to a tag or rev${NC}"
fi
echo ""

echo -e "${BLUE}Checking Cargo.lock holds no branch-resolved sources...${NC}"
if [ -f Cargo.lock ] && grep -q 'branch=' Cargo.lock; then
    echo -e "${RED}✗ Cargo.lock still contains branch-resolved git sources:${NC}"
    grep -n 'branch=' Cargo.lock
    echo ""
    echo -e "${YELLOW}  Regenerate the lockfile after pinning. See ${ADR}.${NC}"
    FAILURES=$((FAILURES + 1))
else
    echo -e "${GREEN}✓ Cargo.lock has no branch-resolved sources${NC}"
fi
echo ""

echo -e "${BLUE}========================================${NC}"
if [ ${FAILURES} -eq 0 ]; then
    echo -e "${GREEN}All pin checks passed!${NC}"
    exit 0
else
    echo -e "${RED}${FAILURES} pin check(s) failed!${NC}"
    exit 1
fi
