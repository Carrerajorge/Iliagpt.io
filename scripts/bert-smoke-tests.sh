#!/usr/bin/env bash
#
# Live HTTP smoke tests against the BERT + Transformer routers.
# Run the smoke server first:
#   npx tsx scripts/bert-smoke-server.ts &
#
# Then:
#   bash scripts/bert-smoke-tests.sh
#
# Each test hits a real endpoint, checks the HTTP status and a shape
# invariant of the JSON body, and prints PASS/FAIL. Exits with non-zero
# if any test fails.

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
  # shellcheck disable=SC2086
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
  local name="$1"
  local path="$2"
  local method="$3"
  local payload="$4"
  local check="$5"

  local body
  if [[ "$method" == GET ]]; then
    body=$(curl -sS -X GET "$BASE$path")
  else
    body=$(curl -sS -X "$method" -H "Content-Type: application/json" -d "$payload" "$BASE$path")
  fi
  assert "$name" "$body" "$check"
}

echo "=== Live HTTP smoke tests against $BASE ==="
echo

# ── 0 health ──────────────────────────────────────────────────────────────
run_test "00 health" /health GET "" '(b) => b.ok === true'

# ── 1 transformer /attention ──────────────────────────────────────────────
run_test "01 POST /api/transformer/attention" /api/transformer/attention POST '{
  "Q": [[1,0,0,0],[0,1,0,0]],
  "K": [[1,0,0,0],[0,1,0,0]],
  "V": [[1,2,3,4],[5,6,7,8]]
}' '(b) => Array.isArray(b.output) && b.output.length === 2 && b.output[0].length === 4 && typeof b.d_k === "number"'

# ── 2 transformer /schedule (Noam) ────────────────────────────────────────
run_test "02 POST /api/transformer/schedule" /api/transformer/schedule POST '{
  "step": 500,
  "dModel": 512,
  "warmupSteps": 4000
}' '(b) => typeof b.learningRate === "number" && b.learningRate > 0 && b.step === 500'

# ── 3 transformer /configs ────────────────────────────────────────────────
run_test "03 GET /api/transformer/configs" /api/transformer/configs GET "" \
  '(b) => Array.isArray(b.presets) && b.presets.some(p => p.name === "base") && b.presets.some(p => p.name === "big")'

# ── 4 BERT /configs ───────────────────────────────────────────────────────
run_test "04 GET /api/bert/configs" /api/bert/configs GET "" \
  '(b) => Array.isArray(b.presets) && b.presets.some(p => p.name === "bert-base" && p.hiddenSize === 768 && p.numLayers === 12)'

# ── 5 BERT /encode ────────────────────────────────────────────────────────
run_test "05 POST /api/bert/encode" /api/bert/encode POST '{
  "tokenIds": [2, 5, 6, 7, 3, 8, 9, 3],
  "segmentIds": [0, 0, 0, 0, 0, 1, 1, 1]
}' '(b) => Array.isArray(b.sequenceOutput) && b.sequenceOutput.length === 8 && Array.isArray(b.pooledOutput) && b.pooledOutput.length === 16 && b.shape.pooledOutput[1] === 16'

# ── 6 BERT /pool ──────────────────────────────────────────────────────────
run_test "06 POST /api/bert/pool" /api/bert/pool POST '{
  "tokenIds": [2, 5, 6, 7, 3],
  "segmentIds": [0, 0, 0, 0, 0]
}' '(b) => Array.isArray(b.pooled) && b.pooled.length === 16 && b.pooled.every(v => v >= -1 && v <= 1)'

# ── 7 BERT /masked-lm ─────────────────────────────────────────────────────
run_test "07 POST /api/bert/masked-lm" /api/bert/masked-lm POST '{
  "tokenIds": [2, 5, 4, 7, 3],
  "segmentIds": [0, 0, 0, 0, 0],
  "maskedPositions": [2],
  "originalTokens": [6],
  "topK": 3
}' '(b) => Array.isArray(b.predictions) && b.predictions.length === 1 && b.predictions[0].topK.length === 3 && typeof b.loss.loss === "number"'

# ── 8 BERT /mask-batch ────────────────────────────────────────────────────
run_test "08 POST /api/bert/mask-batch" /api/bert/mask-batch POST '{
  "tokenIds": [2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 3],
  "vocabSize": 48,
  "seed": 7
}' '(b) => Array.isArray(b.maskedInputIds) && b.maskedPositions.length >= 1 && b.maskedPositions.every(p => [2,3].indexOf(b.maskedInputIds[p]) === -1 || b.actions[b.maskedPositions.indexOf(p)] === "keep")'

# ── 9 BERT /nsp ───────────────────────────────────────────────────────────
run_test "09 POST /api/bert/nsp" /api/bert/nsp POST '{
  "tokenIds": [2, 5, 6, 3, 7, 8, 3],
  "segmentIds": [0, 0, 0, 0, 1, 1, 1]
}' '(b) => Math.abs(b.isNext + b.notNext - 1) < 1e-9 && ["isNext","notNext"].includes(b.prediction)'

# ── 10 BERT /schedule (linear warmup + decay) ─────────────────────────────
run_test "10 POST /api/bert/schedule" /api/bert/schedule POST '{
  "step": 5000,
  "peakLR": 1e-4,
  "warmupSteps": 10000,
  "totalSteps": 100000
}' '(b) => Math.abs(b.learningRate - 0.5e-4) < 1e-9 && b.peakLR === 1e-4'

# ── 11 BERT /hidden-states (feature-based §5.3) ──────────────────────────
run_test "11 POST /api/bert/hidden-states" /api/bert/hidden-states POST '{
  "tokenIds": [2, 5, 6, 7, 3],
  "segmentIds": [0, 0, 0, 0, 0]
}' '(b) => Array.isArray(b.layers) && b.layers.length === b.numLayers + 1 && b.layers[0].label === "embeddings"'

# ── 12 BERT /classify (Figure 4a/b) ──────────────────────────────────────
run_test "12 POST /api/bert/classify" /api/bert/classify POST '{
  "tokenIds": [2, 5, 6, 3, 7, 8, 3],
  "segmentIds": [0, 0, 0, 0, 1, 1, 1],
  "numLabels": 3,
  "label": 1
}' '(b) => Array.isArray(b.logits) && b.logits.length === 3 && typeof b.loss.loss === "number" && b.loss.prediction >= 0 && b.loss.prediction < 3'

# ── 13 BERT /span (SQuAD v1.1, Figure 4c) ────────────────────────────────
run_test "13 POST /api/bert/span" /api/bert/span POST '{
  "tokenIds": [2, 5, 6, 7, 8, 3],
  "segmentIds": [0, 0, 0, 0, 0, 0],
  "goldStart": 1,
  "goldEnd": 3
}' '(b) => Array.isArray(b.startLogits) && b.startLogits.length === 6 && typeof b.loss.loss === "number" && Math.abs(b.loss.loss - (b.loss.startLoss + b.loss.endLoss)) < 1e-9'

# ── 14 BERT /tag (Figure 4d, NER) ────────────────────────────────────────
run_test "14 POST /api/bert/tag" /api/bert/tag POST '{
  "tokenIds": [2, 5, 6, 7, 3],
  "segmentIds": [0, 0, 0, 0, 0],
  "numLabels": 5,
  "labels": [-100, 1, 2, 3, -100]
}' '(b) => Array.isArray(b.logits) && b.logits.length === 5 && b.logits[0].length === 5 && b.loss.tokenCount === 3'

# ── 15 BERT /pretrain-loss (combined MLM + NSP §A.2) ─────────────────────
run_test "15 POST /api/bert/pretrain-loss" /api/bert/pretrain-loss POST '{
  "tokenIds": [2, 5, 4, 3, 7, 4, 3],
  "segmentIds": [0, 0, 0, 0, 1, 1, 1],
  "maskedPositions": [2, 5],
  "originalTokens": [6, 8],
  "nspLabel": 0
}' '(b) => typeof b.mlmLoss === "number" && typeof b.nspLoss === "number" && Math.abs(b.total - (b.mlmLoss + b.nspLoss)) < 1e-9'

# ── 16 BERT /span-v2 (SQuAD 2.0, τ threshold §4.3) ───────────────────────
run_test "16 POST /api/bert/span-v2" /api/bert/span-v2 POST '{
  "tokenIds": [2, 5, 6, 7, 8, 3],
  "segmentIds": [0, 0, 0, 0, 0, 0],
  "goldStart": 0,
  "goldEnd": 0,
  "tau": 0
}' '(b) => typeof b.prediction.nullScore === "number" && typeof b.prediction.bestSpanScore === "number" && b.prediction.start >= 1 && typeof b.prediction.hasAnswer === "boolean" && typeof b.loss.loss === "number"'

# ── 17 BERT /multiple-choice (SWAG §4.4) ─────────────────────────────────
run_test "17 POST /api/bert/multiple-choice" /api/bert/multiple-choice POST '{
  "candidates": [
    [2, 5, 6, 3, 7, 8, 3],
    [2, 5, 6, 3, 9, 10, 3],
    [2, 5, 6, 3, 11, 12, 3],
    [2, 5, 6, 3, 13, 14, 3]
  ],
  "goldIndex": 2
}' '(b) => Array.isArray(b.scores) && b.scores.length === 4 && b.prediction >= 0 && b.prediction < 4 && typeof b.loss.loss === "number" && Math.abs(b.loss.probabilities.reduce((a,c)=>a+c,0) - 1) < 1e-9'

# ── 18 BERT /layer-combine (concat-last-2 on tiny config) ────────────────
run_test "18 POST /api/bert/layer-combine concat-last-k" /api/bert/layer-combine POST '{
  "tokenIds": [2, 5, 6, 7, 3],
  "segmentIds": [0, 0, 0, 0, 0],
  "strategy": "concat-last-k",
  "k": 2
}' '(b) => Array.isArray(b.combined) && b.shape[0] === 5 && b.shape[1] === 32'

# ── 19 BERT /layer-combine weighted-sum ──────────────────────────────────
run_test "19 POST /api/bert/layer-combine weighted-sum" /api/bert/layer-combine POST '{
  "tokenIds": [2, 5, 6, 3],
  "segmentIds": [0, 0, 0, 0],
  "strategy": "weighted-sum",
  "weights": [0.1, 0.3, 0.6]
}' '(b) => Array.isArray(b.combined) && b.shape[0] === 4 && b.shape[1] === 16'

# ── 20 BERT /hypers ──────────────────────────────────────────────────────
run_test "20 GET /api/bert/hypers" /api/bert/hypers GET "" \
  '(b) => b.preTraining.peakLearningRate === 1e-4 && b.preTraining.warmupSteps === 10000 && b.preTraining.batchSize === 256 && Array.isArray(b.fineTuningGrid) && b.fineTuningGrid.length === 18'

echo
echo "=== Results: $(green $PASS) passed, $(red $FAIL) failed ==="
if [[ $FAIL -gt 0 ]]; then
  echo
  echo "Failed tests:"
  for t in "${FAILED_TESTS[@]}"; do echo "  - $t"; done
  exit 1
fi
