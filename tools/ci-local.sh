#!/usr/bin/env bash
# The CI steps in the order .github/workflows/ci.yml runs them. Run it as `nice -n 10 tools/ci-local.sh`;
# SKIP_E2E=1 leaves out the browser step on a machine without Chrome.
set -euo pipefail
cd "$(dirname "$0")/.."

step() {
  local name=$1
  shift
  local start=$SECONDS
  echo "== $name"
  "$@"
  echo "== $name: $((SECONDS - start)) s"
}

step "cargo fmt" cargo fmt --check
step "clippy" cargo clippy --all-targets -- -D warnings
step "clippy (wasm32)" cargo clippy --target wasm32-unknown-unknown -p invest_engine -- -D warnings
step "cargo test" cargo test
# A clean checkout installs from the lockfile.
[ -e node_modules ] || step "npm ci" npm ci
step "lint" npm run lint
step "typecheck" npm run typecheck
step "test" npm test
step "build" npm run build
if [ -z "${SKIP_E2E:-}" ]; then
  step "e2e" npm run e2e
fi
echo "ci-local: all steps passed in $SECONDS s"
