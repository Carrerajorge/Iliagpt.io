#!/usr/bin/env bash
#
# Negative-path smoke tests — verify the endpoints reject malformed
# input cleanly with a 400 + structured error body, and NEVER 500 or
# hang. This is the "does it survive adversarial input" check.

set -u

BASE="${BERT_SMOKE_BASE:-http://localhost:5174}"
PASS=0
FAIL=0

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }

expect_error() {
  local name="$1"
  local path="$2"
  local payload="$3"
  local method="${4:-POST}"
  local http_code body
  if [[ "$method" == GET ]]; then
    http_code=$(curl -sS -o /tmp/bert-err-body -w "%{http_code}" -X GET "$BASE$path")
  else
    http_code=$(curl -sS -o /tmp/bert-err-body -w "%{http_code}" -X "$method" -H "Content-Type: application/json" -d "$payload" "$BASE$path")
  fi
  body=$(cat /tmp/bert-err-body)
  # Must be 4xx (client error) with a JSON error field
  local ok
  ok=$(echo "$body" | node -e '
    let raw = ""; process.stdin.on("data", d => raw += d); process.stdin.on("end", () => {
      try {
        const b = JSON.parse(raw);
        process.stdout.write(b.error ? "OK:" + b.error : "NOERR");
      } catch (e) { process.stdout.write("NOJSON"); }
    });
  ')
  if [[ "$http_code" =~ ^4 ]] && [[ "$ok" == OK:* ]]; then
    green "PASS"; printf ' — %s (%s %s)\n' "$name" "$http_code" "${ok:3}"
    PASS=$((PASS + 1))
  else
    red "FAIL"; printf ' — %s (http=%s body=%.200s)\n' "$name" "$http_code" "$body"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Negative-path smoke tests against $BASE ==="
echo

# 1. Empty body
expect_error "1 encode empty body" /api/bert/encode '{}'

# 2. Out-of-vocab token
expect_error "2 encode token >= vocabSize" /api/bert/encode \
  '{"tokenIds":[2,5,9999,3]}'

# 3. Wrong-length segment ids
expect_error "3 encode segmentIds length mismatch" /api/bert/encode \
  '{"tokenIds":[2,5,6,3],"segmentIds":[0,0]}'

# 4. Too-long sequence (>128 tokens cap)
LONG_TOKENS=$(node -e 'console.log(JSON.stringify(Array(200).fill(5)))')
expect_error "4 encode tokenIds > 128 cap" /api/bert/encode "{\"tokenIds\":$LONG_TOKENS}"

# 5. Unknown preset
expect_error "5 configs unknown preset" "/api/bert/configs?name=bert-jumbo" '' GET

# 6. Masked position out of range
expect_error "6 masked-lm position out of range" /api/bert/masked-lm \
  '{"tokenIds":[2,5,3],"maskedPositions":[99],"topK":3}'

# 7. maskedPositions / originalTokens length mismatch
expect_error "7 masked-lm length mismatch" /api/bert/masked-lm \
  '{"tokenIds":[2,5,6,3],"maskedPositions":[1,2],"originalTokens":[5],"topK":3}'

# 8. Classify with label out of range
expect_error "8 classify label >= numLabels" /api/bert/classify \
  '{"tokenIds":[2,5,3],"numLabels":3,"label":5}'

# 9. Span with goldEnd < goldStart
expect_error "9 span goldEnd < goldStart" /api/bert/span \
  '{"tokenIds":[2,5,6,3],"goldStart":3,"goldEnd":1}'

# 10. Multiple-choice with only 1 candidate (min 2)
expect_error "10 multiple-choice 1 candidate" /api/bert/multiple-choice \
  '{"candidates":[[2,5,3]],"goldIndex":0}'

# 11. Layer combine with missing k
expect_error "11 layer-combine missing k" /api/bert/layer-combine \
  '{"tokenIds":[2,5,3],"strategy":"concat-last-k"}'

# 12. Schedule with warmup > total
expect_error "12 schedule warmup > total" /api/bert/schedule \
  '{"step":1,"peakLR":1e-4,"warmupSteps":1000,"totalSteps":500}'

# 13. Mask batch with probabilities summing != 1
expect_error "13 mask-batch invalid probs" /api/bert/mask-batch \
  '{"tokenIds":[2,5,6,7,3],"vocabSize":48,"seed":1,"replaceWithMaskProbability":0.5,"replaceWithRandomProbability":0.3,"keepOriginalProbability":0.3}'

echo
echo "=== Results: $(green $PASS) passed, $(red $FAIL) failed ==="
if [[ $FAIL -gt 0 ]]; then exit 1; fi
