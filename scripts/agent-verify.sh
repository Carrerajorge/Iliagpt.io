#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

WATCH_MODE=false
CLIENT_MODE=false
SKIP_TYPECHECK="${AGENT_VERIFY_SKIP_TYPECHECK:-false}"
SKIP_TESTS="${AGENT_VERIFY_SKIP_TESTS:-false}"
POSITIONAL_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch)
      WATCH_MODE=true
      shift
      ;;
    --client)
      CLIENT_MODE=true
      shift
      ;;
    --server)
      CLIENT_MODE=false
      shift
      ;;
    --no-typecheck)
      SKIP_TYPECHECK=true
      shift
      ;;
    --no-tests)
      SKIP_TESTS=true
      shift
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        POSITIONAL_ARGS+=("$1")
        shift
      done
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done

echo "== Agent Verify =="
echo "root: $ROOT_DIR"
echo "mode: $([[ "$WATCH_MODE" == "true" ]] && echo "watch" || echo "run")"
echo "scope: $([[ "$CLIENT_MODE" == "true" ]] && echo "client" || echo "server+shared")"

if [[ ! -d node_modules ]]; then
  echo "node_modules no existe. Ejecutando npm install..."
  npm install
fi

if [[ "$WATCH_MODE" != "true" && "$SKIP_TYPECHECK" != "true" ]]; then
  echo ""
  echo "== Type Check =="
  NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p tsconfig.ci.json --noEmit
fi

if [[ "$SKIP_TESTS" == "true" ]]; then
  echo ""
  echo "Tests omitidos por AGENT_VERIFY_SKIP_TESTS/--no-tests"
  exit 0
fi

echo ""
echo "== Tests =="

if [[ "$CLIENT_MODE" == "true" ]]; then
  if [[ "$WATCH_MODE" == "true" ]]; then
    exec npx vitest --config vitest.client.config.ts "${POSITIONAL_ARGS[@]}"
  fi
  exec npx vitest run --config vitest.client.config.ts "${POSITIONAL_ARGS[@]}"
fi

if [[ "$WATCH_MODE" == "true" ]]; then
  exec npx vitest "${POSITIONAL_ARGS[@]}"
fi

exec npx vitest run "${POSITIONAL_ARGS[@]}"
