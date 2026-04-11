#!/usr/bin/env bash
#
# Live HTTP smoke tests for /api/gpt3. Boot the smoke server first:
#   npx tsx scripts/bert-smoke-server.ts &
#
# Then:
#   bash scripts/gpt3-smoke-tests.sh

set -u

BASE="${BERT_SMOKE_BASE:-http://localhost:5174}"
PASS=0
FAIL=0
FAILED_TESTS=()

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }

assert() {
  local name="$1"
  local body="$2"
  local check="$3"
  local ok
  ok=$(echo "$body" | node -e '
    let raw = ""; process.stdin.on("data", d => raw += d); process.stdin.on("end", () => {
      try {
        const body = JSON.parse(raw);
        const check = '"$check"';
        const ok = check(body);
        process.stdout.write(ok ? "OK" : "FAIL:" + JSON.stringify(body).slice(0, 400));
      } catch (e) {
        process.stdout.write("EXCEPT:" + e.message + " RAW:" + raw.slice(0, 400));
      }
    });
  ')
  if [[ "$ok" == OK* ]]; then
    green "PASS"; printf ' — %s\n' "$name"
    PASS=$((PASS + 1))
  else
    red "FAIL"; printf ' — %s\n' "$name"
    printf '      detail: %s\n' "$ok"
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("$name")
  fi
}

run_test() {
  local name="$1" path="$2" method="$3" payload="$4" check="$5"
  local body
  if [[ "$method" == GET ]]; then
    body=$(curl -sS -X GET "$BASE$path")
  else
    body=$(curl -sS -X "$method" -H "Content-Type: application/json" -d "$payload" "$BASE$path")
  fi
  assert "$name" "$body" "$check"
}

echo "=== Live HTTP GPT-3 smoke tests against $BASE ==="
echo

# ── 1 configs list ────────────────────────────────────────────────────────
run_test "1 GET /api/gpt3/configs" /api/gpt3/configs GET "" \
  '(b) => Array.isArray(b.presets) && b.presets.some(p => p.name === "gpt3-small" && p.numLayers === 12) && b.presets.some(p => p.name === "gpt3-175b" && p.numLayers === 96)'

# ── 2 forward pass ────────────────────────────────────────────────────────
run_test "2 POST /api/gpt3/forward" /api/gpt3/forward POST '{
  "tokenIds": [3, 5, 7, 9, 11]
}' '(b) => Array.isArray(b.logits) && b.shape.logits[0] === 5 && b.shape.logits[1] === 48 && b.model.numLayers === 4'

# ── 3 next-token ──────────────────────────────────────────────────────────
run_test "3 POST /api/gpt3/next-token" /api/gpt3/next-token POST '{
  "tokenIds": [3, 5, 7, 9]
}' '(b) => Array.isArray(b.logits) && b.logits.length === b.vocabSize && b.vocabSize === 48'

# ── 4 generate greedy ─────────────────────────────────────────────────────
run_test "4 POST /api/gpt3/generate greedy" /api/gpt3/generate POST '{
  "promptTokenIds": [3, 5, 7],
  "maxNewTokens": 5,
  "sampling": { "greedy": true }
}' '(b) => b.generated.length === 5 && b.tokens.length === 8 && b.steps === 5 && b.stopReason === "max-new-tokens"'

# ── 5 generate with seed reproducibility ─────────────────────────────────
A5=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "promptTokenIds":[3,5,7], "maxNewTokens":4,
  "sampling":{"temperature":1.3,"topK":10,"seed":77}
}' "$BASE/api/gpt3/generate")
B5=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "promptTokenIds":[3,5,7], "maxNewTokens":4,
  "sampling":{"temperature":1.3,"topK":10,"seed":77}
}' "$BASE/api/gpt3/generate")
if [[ "$A5" == "$B5" ]]; then
  green "PASS"; printf ' — 5 POST /api/gpt3/generate is reproducible under a fixed seed\n'
  PASS=$((PASS + 1))
else
  red "FAIL"; printf ' — 5 POST /api/gpt3/generate is reproducible under a fixed seed\n'
  FAIL=$((FAIL + 1))
fi

# ── 6 sample pure logits ──────────────────────────────────────────────────
run_test "6 POST /api/gpt3/sample greedy" /api/gpt3/sample POST '{
  "logits": [0.1, 0.3, 5.0, 0.2],
  "sampling": { "greedy": true }
}' '(b) => b.token === 2'

# ── 7 sample with top-k ───────────────────────────────────────────────────
run_test "7 POST /api/gpt3/sample top-k filter" /api/gpt3/sample POST '{
  "logits": [0, 1, 2, 3, 4],
  "sampling": { "topK": 2, "temperature": 1.0, "seed": 1 }
}' '(b) => b.token >= 3'

# ── 8 prompt builder zero-shot ────────────────────────────────────────────
run_test "8 POST /api/gpt3/prompt zero-shot" /api/gpt3/prompt POST '{
  "taskDescription": [5],
  "examples": [],
  "query": [10],
  "inputOutputSeparator": [11],
  "exampleSeparator": [12]
}' '(b) => b.mode === "zero-shot" && b.numExamples === 0 && Array.isArray(b.tokenIds) && b.tokenIds.length > 0'

# ── 9 prompt builder few-shot ─────────────────────────────────────────────
run_test "9 POST /api/gpt3/prompt few-shot" /api/gpt3/prompt POST '{
  "taskDescription": [5],
  "examples": [
    {"input":[6],"output":[7]},
    {"input":[8],"output":[9]}
  ],
  "query": [10],
  "inputOutputSeparator": [11],
  "exampleSeparator": [12]
}' '(b) => b.mode === "few-shot" && b.numExamples === 2'

# ── 10 schedule warmup → peak → decay ─────────────────────────────────────
run_test "10 POST /api/gpt3/schedule at peak" /api/gpt3/schedule POST '{
  "step": 1000,
  "peakLR": 0.0006,
  "warmupSteps": 1000,
  "totalSteps": 10000,
  "minLRFraction": 0.1
}' '(b) => Math.abs(b.learningRate - 0.0006) < 1e-12'

# ── 11 sparse-mask dense ──────────────────────────────────────────────────
run_test "11 POST /api/gpt3/sparse-mask dense" /api/gpt3/sparse-mask POST '{
  "seqLen": 4, "kind": "dense"
}' '(b) => Array.isArray(b.mask) && b.mask.length === 4 && b.density > 0.6 && b.density < 0.7'

# ── 12 sparse-mask strided is sparser than dense ──────────────────────────
run_test "12 POST /api/gpt3/sparse-mask strided is sparser" /api/gpt3/sparse-mask POST '{
  "seqLen": 20, "kind": "strided", "bandSize": 4, "stride": 4
}' '(b) => b.density < 0.525'

# ── 13 causality invariant: appending tokens does NOT change earlier logits
#        (decoder-only regression — fails if someone removes the causal mask)
FWD4=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "tokenIds":[3,5,7,9]
}' "$BASE/api/gpt3/forward" | node -e 'let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>{const j=JSON.parse(r); console.log(j.logits[0].slice(0,4).map(v=>v.toFixed(8)).join(","))})')
FWD6=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "tokenIds":[3,5,7,9,11,13]
}' "$BASE/api/gpt3/forward" | node -e 'let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>{const j=JSON.parse(r); console.log(j.logits[0].slice(0,4).map(v=>v.toFixed(8)).join(","))})')
if [[ "$FWD4" == "$FWD6" ]]; then
  green "PASS"; printf ' — 13 GPT is causal: position 0 logits unchanged by future tokens\n'
  PASS=$((PASS + 1))
else
  red "FAIL"; printf ' — 13 GPT is causal: position 0 logits unchanged (diff!)\n'
  printf '      short=%s\n      long=%s\n' "$FWD4" "$FWD6"
  FAIL=$((FAIL + 1))
fi

# ── 14 negative: prompt with out-of-vocab token rejected ──────────────────
run_test "14 POST /api/gpt3/forward out-of-vocab rejected" /api/gpt3/forward POST '{
  "tokenIds": [3, 5, 9999]
}' '(b) => b.error === "invalid_tokens"'

# ── 15 negative: generate with bad sampling rejected ──────────────────────
run_test "15 POST /api/gpt3/generate bad maxNewTokens rejected" /api/gpt3/generate POST '{
  "promptTokenIds": [3,5], "maxNewTokens": 0
}' '(b) => b.error === "invalid_request"'

# ── 16 stop token halts generation early ─────────────────────────────────
# Pick any stop token from the greedy trajectory
PROBE=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "promptTokenIds":[3,5], "maxNewTokens":6, "sampling":{"greedy":true}
}' "$BASE/api/gpt3/generate")
STOP_TOK=$(echo "$PROBE" | node -e 'let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>{const j=JSON.parse(r); console.log(j.generated[2])})')
run_test "16 POST /api/gpt3/generate with stop token halts" /api/gpt3/generate POST "{
  \"promptTokenIds\": [3,5], \"maxNewTokens\": 16,
  \"stopToken\": $STOP_TOK, \"sampling\": {\"greedy\": true}
}" '(b) => b.stopReason === "stop-token" && b.generated[b.generated.length - 1] === '"$STOP_TOK"

echo
echo "=== Results: $(green $PASS) passed, $(red $FAIL) failed ==="
if [[ $FAIL -gt 0 ]]; then
  echo
  echo "Failed tests:"
  for t in "${FAILED_TESTS[@]}"; do echo "  - $t"; done
  exit 1
fi
