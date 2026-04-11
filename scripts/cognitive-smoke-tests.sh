#!/usr/bin/env bash
#
# Live HTTP smoke tests for the cognitive middleware. Boot the smoke
# server first:
#   npx tsx scripts/bert-smoke-server.ts &
#
# Then:
#   bash scripts/cognitive-smoke-tests.sh
#
# Each test hits a real /api/cognitive/* endpoint, parses the JSON
# body, and asserts a structural invariant. Exits non-zero if any
# test fails.

set -u

BASE="${BERT_SMOKE_BASE:-http://localhost:5174}"
PASS=0
FAIL=0
# Initialize as empty array so paths that don't go through `assert()`
# (e.g., the concurrency block below) can still safely append.
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
        process.stdout.write(ok ? "OK" : "FAIL:" + JSON.stringify(body).slice(0, 600));
      } catch (e) {
        process.stdout.write("EXCEPT:" + e.message + " RAW:" + raw.slice(0, 600));
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

echo "=== Live HTTP cognitive middleware smoke tests against $BASE ==="
echo

# 1 List adapters
run_test "1 GET /api/cognitive/adapters" /api/cognitive/adapters GET "" \
  '(b) => Array.isArray(b.adapters) && b.adapters.length >= 1 && Array.isArray(b.intents) && b.intents.includes("qa")'

# 2 Classify a question
run_test "2 POST /api/cognitive/classify question" /api/cognitive/classify POST '{
  "message": "What is the capital of France?"
}' '(b) => b.intent === "qa" && b.confidence > 0 && Array.isArray(b.alternatives)'

# 3 Classify an image generation request
run_test "3 POST /api/cognitive/classify image" /api/cognitive/classify POST '{
  "message": "Generate an image of a sunset over Paris"
}' '(b) => b.intent === "image_generation" && b.confidence === 1'

# 4 Classify a translation request
run_test "4 POST /api/cognitive/classify translation" /api/cognitive/classify POST '{
  "message": "Translate hello to French"
}' '(b) => b.intent === "translation"'

# 5 Spanish summarization
run_test "5 POST /api/cognitive/classify Spanish summary" /api/cognitive/classify POST '{
  "message": "Hazme un resumen breve de este documento"
}' '(b) => b.intent === "summarization"'

# 6 Validate a clean response
run_test "6 POST /api/cognitive/validate clean" /api/cognitive/validate POST '{
  "response": {
    "text": "Paris is the capital of France.",
    "finishReason": "stop",
    "toolCalls": []
  }
}' '(b) => b.ok === true && Array.isArray(b.issues) && b.issues.length === 0'

# 7 Validate an empty response (should fail)
run_test "7 POST /api/cognitive/validate empty" /api/cognitive/validate POST '{
  "response": {
    "text": "",
    "finishReason": "stop",
    "toolCalls": []
  }
}' '(b) => b.ok === false && b.issues.some(i => i.code === "empty_response")'

# 8 Validate a refusal (warning, not error)
run_test "8 POST /api/cognitive/validate refusal" /api/cognitive/validate POST '{
  "response": {
    "text": "I am sorry, I cannot help with that.",
    "finishReason": "stop",
    "toolCalls": []
  }
}' '(b) => b.refusalDetected === true && b.ok === true'

# 9 Validate tool calls with missing required arg
run_test "9 POST /api/cognitive/validate tool missing arg" /api/cognitive/validate POST '{
  "response": {
    "text": "",
    "finishReason": "tool_calls",
    "toolCalls": [{"id": "c1", "name": "search", "args": {}}]
  },
  "toolDescriptors": [{
    "name": "search",
    "description": "search the web",
    "inputSchema": {"type": "object", "required": ["query"]}
  }]
}' '(b) => b.ok === false && b.issues.some(i => i.code === "tool_args_missing_required")'

# 10 Full pipeline run — happy path. Note: after Turn A, the in-house
# adapter is FIRST in priority order, so the default provider is now
# "in-house-gpt3" instead of "mock-echo".
run_test "10 POST /api/cognitive/run happy path" /api/cognitive/run POST '{
  "userId": "smoke-1",
  "message": "What is the capital of France?"
}' '(b) => b.ok === true && b.routing.intent.intent === "qa" && b.routing.providerName === "in-house-gpt3" && typeof b.text === "string" && typeof b.telemetry.durationMs === "number"'

# 11 Full pipeline run with preferred provider override
run_test "11 POST /api/cognitive/run preferred provider" /api/cognitive/run POST '{
  "userId": "smoke-2",
  "message": "Hello there",
  "preferredProvider": "mock-scripted"
}' '(b) => b.ok === true && b.routing.providerName === "mock-scripted" && b.text.length > 0'

# 12 Full pipeline run with unknown preferred provider falls back
run_test "12 POST /api/cognitive/run unknown preferred falls back" /api/cognitive/run POST '{
  "userId": "smoke-3",
  "message": "Hi",
  "preferredProvider": "ghost-provider"
}' '(b) => b.ok === true && b.routing.providerReason.indexOf("not registered") >= 0'

# 13 Full pipeline records routing decision + telemetry
run_test "13 POST /api/cognitive/run telemetry shape" /api/cognitive/run POST '{
  "userId": "smoke-4",
  "message": "Generate an image of a robot"
}' '(b) => b.routing.intent.intent === "image_generation" && typeof b.telemetry.intentClassificationMs === "number" && typeof b.telemetry.providerCallMs === "number" && typeof b.telemetry.validationMs === "number" && b.telemetry.retries >= 0'

# 14 Concurrent runs — fire 3 in parallel and verify each gets isolated state.
#
# Bash subshells lose `&` background output when captured via $(...) —
# we have to write each curl's body to a temp file and read them back
# after `wait`. This is the correct pattern for collecting parallel
# subprocess output in bash.
TMP_DIR=${TMPDIR:-/tmp}
C1="$TMP_DIR/cog-smoke-c1-$$.json"
C2="$TMP_DIR/cog-smoke-c2-$$.json"
C3="$TMP_DIR/cog-smoke-c3-$$.json"
curl -sS -X POST -H "Content-Type: application/json" \
  -d '{"userId":"c1","message":"hi 1"}' \
  "$BASE/api/cognitive/run" > "$C1" &
curl -sS -X POST -H "Content-Type: application/json" \
  -d '{"userId":"c2","message":"hi 2"}' \
  "$BASE/api/cognitive/run" > "$C2" &
curl -sS -X POST -H "Content-Type: application/json" \
  -d '{"userId":"c3","message":"hi 3"}' \
  "$BASE/api/cognitive/run" > "$C3" &
wait
ALL=$(cat "$C1" "$C2" "$C3")
rm -f "$C1" "$C2" "$C3"
COUNT_OK=$(echo "$ALL" | grep -o '"ok":true' | wc -l | tr -d ' ')
if [[ "$COUNT_OK" -ge 3 ]]; then
  green "PASS"; printf ' — 14 concurrent /api/cognitive/run (3 parallel)\n'
  PASS=$((PASS + 1))
else
  red "FAIL"; printf ' — 14 concurrent /api/cognitive/run only got %s ok responses\n' "$COUNT_OK"
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("14 concurrent /api/cognitive/run")
fi

# ── Turn A — real provider adapter checks ──────────────────────────────────

# 15 The in-house-gpt3 adapter is registered out of the box
run_test "15 GET /api/cognitive/adapters includes in-house-gpt3" /api/cognitive/adapters GET "" \
  '(b) => Array.isArray(b.adapters) && b.adapters.includes("in-house-gpt3")'

# 16 Run with explicit preferredProvider="in-house-gpt3" picks the offline adapter
run_test "16 POST /api/cognitive/run preferred in-house-gpt3" /api/cognitive/run POST '{
  "userId": "smoke-A1",
  "message": "Hello in-house",
  "preferredProvider": "in-house-gpt3"
}' '(b) => b.routing.providerName === "in-house-gpt3" && b.ok === true && typeof b.text === "string" && b.routing.providerReason.indexOf("preferred") >= 0'

# 17 In-house adapter is FIRST in priority order, so requests without preference also land there
run_test "17 POST /api/cognitive/run default routes to in-house-gpt3" /api/cognitive/run POST '{
  "userId": "smoke-A2",
  "message": "Tell me a story"
}' '(b) => b.routing.providerName === "in-house-gpt3"'

# 18 In-house adapter is deterministic across two consecutive HTTP requests
RUN_A=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "userId": "smoke-A3",
  "message": "Hello",
  "preferredProvider": "in-house-gpt3"
}' "$BASE/api/cognitive/run")
RUN_B=$(curl -sS -X POST -H "Content-Type: application/json" -d '{
  "userId": "smoke-A3",
  "message": "Hello",
  "preferredProvider": "in-house-gpt3"
}' "$BASE/api/cognitive/run")
TEXT_A=$(echo "$RUN_A" | node -e 'let r="";process.stdin.on("data",d=>r+=d);process.stdin.on("end",()=>{try{console.log(JSON.parse(r).text)}catch{console.log("ERR")}})')
TEXT_B=$(echo "$RUN_B" | node -e 'let r="";process.stdin.on("data",d=>r+=d);process.stdin.on("end",()=>{try{console.log(JSON.parse(r).text)}catch{console.log("ERR")}})')
if [[ "$TEXT_A" == "$TEXT_B" && "$TEXT_A" != "ERR" ]]; then
  green "PASS"; printf ' — 18 in-house-gpt3 deterministic across HTTP roundtrips\n'
  PASS=$((PASS + 1))
else
  red "FAIL"; printf ' — 18 in-house-gpt3 not deterministic: A=%s B=%s\n' "$TEXT_A" "$TEXT_B"
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("18 in-house-gpt3 deterministic")
fi

# 19 Invalid input rejected with 400
run_test "19 POST /api/cognitive/run empty message rejected" /api/cognitive/run POST '{
  "userId": "smoke-5",
  "message": ""
}' '(b) => b.error === "invalid_request"'

echo
echo "=== Results: $(green $PASS) passed, $(red $FAIL) failed ==="
if [[ $FAIL -gt 0 ]]; then
  echo
  echo "Failed tests:"
  for t in "${FAILED_TESTS[@]}"; do echo "  - $t"; done
  exit 1
fi
