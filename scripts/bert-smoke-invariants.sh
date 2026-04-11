#!/usr/bin/env bash
#
# Mathematical invariant checks against the live server. These are
# things that must hold between DIFFERENT requests — determinism,
# consistency across endpoints, paper identities — which pure unit
# tests can miss when components get refactored separately.

set -u

BASE="${BERT_SMOKE_BASE:-http://localhost:5174}"
PASS=0
FAIL=0

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }

check() {
  local name="$1"
  local ok="$2"
  local detail="$3"
  if [[ "$ok" == "true" ]]; then
    green "PASS"; printf ' — %s\n' "$name"
    PASS=$((PASS + 1))
  else
    red "FAIL"; printf ' — %s\n' "$name"
    printf '      detail: %s\n' "$detail"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Mathematical invariants against $BASE ==="
echo

# ---------------------------------------------------------------------------
# I1. Same request twice → bit-identical output (determinism)
# ---------------------------------------------------------------------------
A=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "tokenIds": [2, 5, 6, 7, 3, 8, 9, 3],
  "segmentIds": [0, 0, 0, 0, 0, 1, 1, 1]
}' "$BASE/api/bert/encode")
B=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "tokenIds": [2, 5, 6, 7, 3, 8, 9, 3],
  "segmentIds": [0, 0, 0, 0, 0, 1, 1, 1]
}' "$BASE/api/bert/encode")
if [[ "$A" == "$B" ]]; then
  check "I1 determinism: encode(x) == encode(x)" true ""
else
  check "I1 determinism: encode(x) == encode(x)" false "responses differ"
fi

# ---------------------------------------------------------------------------
# I2. Different seeds → different outputs
# ---------------------------------------------------------------------------
OUT42=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "tokenIds":[2,5,6,3], "model":{"preset":"bert-tiny","seed":42}
}' "$BASE/api/bert/pool" | node -e 'let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>console.log(JSON.parse(r).pooled[0]))')
OUT99=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "tokenIds":[2,5,6,3], "model":{"preset":"bert-tiny","seed":99}
}' "$BASE/api/bert/pool" | node -e 'let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>console.log(JSON.parse(r).pooled[0]))')
if [[ "$OUT42" != "$OUT99" ]]; then
  check "I2 different seeds → different pooled output" true ""
else
  check "I2 different seeds → different pooled output" false "both gave $OUT42"
fi

# ---------------------------------------------------------------------------
# I3. Bidirectional attention: adding tokens to the right MUST change [CLS]
#     (this is THE test that fails if BERT accidentally becomes causal)
# ---------------------------------------------------------------------------
CLS_SHORT=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "tokenIds":[2,5,6,3]
}' "$BASE/api/bert/encode" | node -e 'let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>{const j=JSON.parse(r); console.log(j.sequenceOutput[0].slice(0,4).join(","))})')
CLS_LONG=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "tokenIds":[2,5,6,3,7,8,9]
}' "$BASE/api/bert/encode" | node -e 'let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>{const j=JSON.parse(r); console.log(j.sequenceOutput[0].slice(0,4).join(","))})')
if [[ "$CLS_SHORT" != "$CLS_LONG" ]]; then
  check "I3 bidirectional: [CLS] changes when future tokens appear" true "short=$CLS_SHORT long=$CLS_LONG"
else
  check "I3 bidirectional: [CLS] changes when future tokens appear" false "[CLS] identical → CAUSAL?! short=$CLS_SHORT"
fi

# ---------------------------------------------------------------------------
# I4. NSP probabilities sum to exactly 1
# ---------------------------------------------------------------------------
NSP_SUM=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "tokenIds":[2,5,6,3,7,8,3], "segmentIds":[0,0,0,0,1,1,1]
}' "$BASE/api/bert/nsp" | node -e 'let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>{const j=JSON.parse(r); console.log((j.isNext+j.notNext).toFixed(10))})')
if [[ "$NSP_SUM" == "1.0000000000" ]]; then
  check "I4 NSP(isNext) + NSP(notNext) = 1.0" true ""
else
  check "I4 NSP(isNext) + NSP(notNext) = 1.0" false "got $NSP_SUM"
fi

# ---------------------------------------------------------------------------
# I5. pretrain-loss.total === mlmLoss + nspLoss (the §A.2 identity)
# ---------------------------------------------------------------------------
SUM_OK=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "tokenIds":[2,5,4,3,7,4,3], "segmentIds":[0,0,0,0,1,1,1],
  "maskedPositions":[2,5], "originalTokens":[6,8], "nspLabel":0
}' "$BASE/api/bert/pretrain-loss" | node -e 'let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>{const j=JSON.parse(r); const diff=Math.abs(j.total-(j.mlmLoss+j.nspLoss)); console.log(diff < 1e-9 ? "true" : "false:"+diff)})')
if [[ "$SUM_OK" == "true" ]]; then
  check "I5 pretrain-loss.total == mlmLoss + nspLoss" true ""
else
  check "I5 pretrain-loss.total == mlmLoss + nspLoss" false "$SUM_OK"
fi

# ---------------------------------------------------------------------------
# I6. Span v2 with tau = +inf → hasAnswer == false
# ---------------------------------------------------------------------------
TAU_HUGE=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "tokenIds":[2,5,6,7,8,3], "tau":1e9
}' "$BASE/api/bert/span-v2" | node -e 'let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>console.log(JSON.parse(r).prediction.hasAnswer))')
if [[ "$TAU_HUGE" == "false" ]]; then
  check "I6 span-v2 τ=+∞ → hasAnswer=false" true ""
else
  check "I6 span-v2 τ=+∞ → hasAnswer=false" false "got $TAU_HUGE"
fi

# ---------------------------------------------------------------------------
# I7. hidden-states length = numLayers + 1 (§5.3)
# ---------------------------------------------------------------------------
HS_LEN=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "tokenIds":[2,5,6,3]
}' "$BASE/api/bert/hidden-states" | node -e 'let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>{const j=JSON.parse(r); console.log(j.layers.length === j.numLayers + 1 ? "true" : "false:"+j.layers.length+"vs"+(j.numLayers+1))})')
if [[ "$HS_LEN" == "true" ]]; then
  check "I7 hidden-states.layers.length == numLayers + 1" true ""
else
  check "I7 hidden-states.layers.length == numLayers + 1" false "$HS_LEN"
fi

# ---------------------------------------------------------------------------
# I8. transformer/attention: attention weights per row sum to 1
# ---------------------------------------------------------------------------
ATTN_SUM=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "Q":[[1,0,0,0],[0,1,0,0],[0,0,1,0]],
  "K":[[1,0,0,0],[0,1,0,0],[0,0,1,0]],
  "V":[[1,2,3,4],[5,6,7,8],[9,10,11,12]]
}' "$BASE/api/transformer/attention" | node -e 'let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>{const j=JSON.parse(r); const sums=j.weights.map(row=>row.reduce((a,c)=>a+c,0)); const allOne=sums.every(s => Math.abs(s-1)<1e-9); console.log(allOne ? "true" : "false:"+sums.join(","))})')
if [[ "$ATTN_SUM" == "true" ]]; then
  check "I8 attention weights per row sum to 1 (softmax identity)" true ""
else
  check "I8 attention weights per row sum to 1 (softmax identity)" false "$ATTN_SUM"
fi

# ---------------------------------------------------------------------------
# I9. bert/schedule at step=warmup → LR == peakLR exactly
# ---------------------------------------------------------------------------
AT_PEAK=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "step":10000, "peakLR":0.0001, "warmupSteps":10000, "totalSteps":1000000
}' "$BASE/api/bert/schedule" | node -e 'let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>{const j=JSON.parse(r); console.log(Math.abs(j.learningRate - 0.0001) < 1e-12 ? "true" : "false:"+j.learningRate)})')
if [[ "$AT_PEAK" == "true" ]]; then
  check "I9 bert-schedule: lr(step=warmup) == peakLR exact" true ""
else
  check "I9 bert-schedule: lr(step=warmup) == peakLR exact" false "$AT_PEAK"
fi

# ---------------------------------------------------------------------------
# I10. transformer/rerank: candidates re-sorted by hybrid score
# ---------------------------------------------------------------------------
RERANK=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "query":[1,0,0,0],
  "candidates":[
    {"embedding":[0.9,0.1,0,0],"payload":{"id":"A"}},
    {"embedding":[0.1,0.9,0,0],"payload":{"id":"B"}},
    {"embedding":[0.99,0.01,0,0],"payload":{"id":"C"}}
  ]
}' "$BASE/api/transformer/rerank" | node -e 'let r=""; process.stdin.on("data",d=>r+=d); process.stdin.on("end",()=>{const j=JSON.parse(r); const sortedDesc = j.ranked.every((c,i)=>i===0||c.finalScore<=j.ranked[i-1].finalScore); const topIsC = j.ranked[0].payload.id === "C"; console.log(sortedDesc && topIsC ? "true" : "false:top="+j.ranked[0].payload.id)})')
if [[ "$RERANK" == "true" ]]; then
  check "I10 transformer-rerank: top result is the cosine-closest candidate (C)" true ""
else
  check "I10 transformer-rerank: top result is the cosine-closest candidate (C)" false "$RERANK"
fi

echo
echo "=== Results: $(green $PASS) passed, $(red $FAIL) failed ==="
if [[ $FAIL -gt 0 ]]; then exit 1; fi
