#!/usr/bin/env bash
#
# Live HTTP smoke tests for the GPT-4 technical report additions:
#   /api/gpt3/chat, /scaling-law-fit, /scaling-law-predict,
#   /preference-loss, /reinforce-step, /calibration, /chain-of-thought.
#
# Run the smoke server first:
#   npx tsx scripts/bert-smoke-server.ts &
#
# Then:
#   bash scripts/gpt4-smoke-tests.sh

set -u

BASE="${BERT_SMOKE_BASE:-http://localhost:5174}"
PASS=0
FAIL=0
FAILED_TESTS=()

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }

assert() {
  local name="$1" body="$2" check="$3"
  local ok
  ok=$(echo "$body" | node -e '
    let raw = ""; process.stdin.on("data", d => raw += d); process.stdin.on("end", () => {
      try {
        const body = JSON.parse(raw);
        const check = '"$check"';
        const ok = check(body);
        process.stdout.write(ok ? "OK" : "FAIL:" + JSON.stringify(body).slice(0, 500));
      } catch (e) {
        process.stdout.write("EXCEPT:" + e.message + " RAW:" + raw.slice(0, 500));
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

echo "=== Live HTTP GPT-4 smoke tests against $BASE ==="
echo

# ── 1 chat: 3 messages + primer ──────────────────────────────────────────
run_test "1 POST /api/gpt3/chat" /api/gpt3/chat POST '{
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hi!"}
  ]
}' '(b) => Array.isArray(b.tokenIds) && b.tokenIds.length > 0 && b.roles[0] === "system" && b.numTurns === 1'

# ── 2 chat: multi-turn alternation validated ─────────────────────────────
run_test "2 POST /api/gpt3/chat multi-turn" /api/gpt3/chat POST '{
  "messages": [
    {"role": "user", "content": "q1"},
    {"role": "assistant", "content": "a1"},
    {"role": "user", "content": "q2"}
  ]
}' '(b) => b.mode === "one-shot" && b.numTurns === 2'

# ── 3 chat: invalid (two system messages) rejected ───────────────────────
run_test "3 POST /api/gpt3/chat two-system rejected" /api/gpt3/chat POST '{
  "messages": [
    {"role": "system", "content": "A"},
    {"role": "system", "content": "B"},
    {"role": "user", "content": "hi"}
  ]
}' '(b) => b.error === "chat_failed"'

# ── 4 chat: non-alternating roles rejected ───────────────────────────────
run_test "4 POST /api/gpt3/chat non-alternating rejected" /api/gpt3/chat POST '{
  "messages": [
    {"role": "user", "content": "hi"},
    {"role": "user", "content": "hi again"}
  ]
}' '(b) => b.error === "chat_failed"'

# ── 5 scaling-law fit on synthetic data ──────────────────────────────────
run_test "5 POST /api/gpt3/scaling-law-fit" /api/gpt3/scaling-law-fit POST '{
  "observations": [
    {"compute": 100,   "loss": 10.5},
    {"compute": 1000,  "loss": 8.2},
    {"compute": 10000, "loss": 6.5},
    {"compute": 100000,"loss": 5.3}
  ],
  "asymptote": 4.5
}' '(b) => typeof b.params.a === "number" && b.params.b < 0 && b.params.c === 4.5 && b.r2Train > 0.9'

# ── 6 scaling-law predict from params ────────────────────────────────────
run_test "6 POST /api/gpt3/scaling-law-predict" /api/gpt3/scaling-law-predict POST '{
  "params": {"a": 5, "b": -0.1, "c": 1.5},
  "compute": 1e6
}' '(b) => typeof b.predictedLoss === "number" && b.predictedLoss > 1.5'

# ── 7 preference-loss scalar form ────────────────────────────────────────
run_test "7 POST /api/gpt3/preference-loss scalar" /api/gpt3/preference-loss POST '{
  "rChosen": 2.5,
  "rRejected": 0.5
}' '(b) => typeof b.loss === "number" && b.probChosenWins > 0.5 && Math.abs(b.rewardGap - 2.0) < 1e-9'

# ── 8 preference-loss batched form ───────────────────────────────────────
run_test "8 POST /api/gpt3/preference-loss batch" /api/gpt3/preference-loss POST '{
  "rChosen": [3, 5, 2],
  "rRejected": [1, 2, 3]
}' '(b) => typeof b.meanLoss === "number" && Array.isArray(b.perPair) && b.perPair.length === 3'

# ── 9 preference-loss rejects mixed scalar+array ─────────────────────────
run_test "9 POST /api/gpt3/preference-loss mixed rejected" /api/gpt3/preference-loss POST '{
  "rChosen": 1,
  "rRejected": [2]
}' '(b) => b.error === "shape_mismatch"'

# ── 10 reinforce-step with KL ────────────────────────────────────────────
run_test "10 POST /api/gpt3/reinforce-step" /api/gpt3/reinforce-step POST '{
  "logProbs": [-0.5, -0.5, -1.0],
  "reward": 3,
  "baseline": 1,
  "klDivergencePerToken": [0.1, 0.1, 0.2],
  "klCoefficient": 0.5
}' '(b) => b.advantage === 2 && Array.isArray(b.perTokenGradient) && b.perTokenGradient.length === 3 && b.perTokenGradient[0] === -2 && Math.abs(b.klPenalty - 0.2) < 1e-9'

# ── 11 calibration perfect predictor → low ECE ──────────────────────────
run_test "11 POST /api/gpt3/calibration" /api/gpt3/calibration POST '{
  "predictions": [
    {"probability": 0.9, "correct": true},
    {"probability": 0.9, "correct": true},
    {"probability": 0.9, "correct": true},
    {"probability": 0.9, "correct": true},
    {"probability": 0.9, "correct": true},
    {"probability": 0.9, "correct": true},
    {"probability": 0.9, "correct": true},
    {"probability": 0.9, "correct": true},
    {"probability": 0.9, "correct": true},
    {"probability": 0.9, "correct": false}
  ],
  "numBins": 10
}' '(b) => b.ece >= 0 && b.ece < 0.05 && b.numPredictions === 10'

# ── 12 calibration systematic over-confidence → high ECE ────────────────
run_test "12 POST /api/gpt3/calibration high ECE" /api/gpt3/calibration POST '{
  "predictions": [
    {"probability": 0.95, "correct": false},
    {"probability": 0.95, "correct": false},
    {"probability": 0.95, "correct": false},
    {"probability": 0.95, "correct": true}
  ]
}' '(b) => b.ece > 0.5'

# ── 13 chain-of-thought wrapper ─────────────────────────────────────────
run_test "13 POST /api/gpt3/chain-of-thought" /api/gpt3/chain-of-thought POST '{
  "question": "What is 48 plus 76?"
}' '(b) => b.wrapped === "What is 48 plus 76?\nLet\u0027s think step by step." && b.preamble === "Let\u0027s think step by step."'

# ── 14 scaling-law round-trip: fit then predict at a held-out compute ───
FIT=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "observations": [
    {"compute": 100,    "loss": 10.5},
    {"compute": 1000,   "loss": 8.2},
    {"compute": 10000,  "loss": 6.5},
    {"compute": 100000, "loss": 5.3}
  ],
  "asymptote": 4.5
}' "$BASE/api/gpt3/scaling-law-fit")
A=$(echo "$FIT" | node -e 'let r="";process.stdin.on("data",d=>r+=d);process.stdin.on("end",()=>console.log(JSON.parse(r).params.a))')
B=$(echo "$FIT" | node -e 'let r="";process.stdin.on("data",d=>r+=d);process.stdin.on("end",()=>console.log(JSON.parse(r).params.b))')
C=$(echo "$FIT" | node -e 'let r="";process.stdin.on("data",d=>r+=d);process.stdin.on("end",()=>console.log(JSON.parse(r).params.c))')
run_test "14 POST scaling-law-predict from fitted params" /api/gpt3/scaling-law-predict POST "{
  \"params\": {\"a\": $A, \"b\": $B, \"c\": $C},
  \"compute\": 1e6
}" '(b) => typeof b.predictedLoss === "number" && b.predictedLoss > 4.5 && b.predictedLoss < 6'

echo
echo "=== Results: $(green $PASS) passed, $(red $FAIL) failed ==="
if [[ $FAIL -gt 0 ]]; then
  echo
  echo "Failed tests:"
  for t in "${FAILED_TESTS[@]}"; do echo "  - $t"; done
  exit 1
fi
