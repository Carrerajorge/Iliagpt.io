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

# ── Turn B — streaming SSE checks ──────────────────────────────────────────
#
# The SSE endpoint emits framed events:
#   event: <kind>
#   data: <json>
#
# We assert on the raw text body instead of JSON because SSE is a
# line-based protocol, not JSON. `curl --max-time` keeps the tests
# bounded even if the server hangs. Each test checks the presence of
# specific event types and their order.

stream_test() {
  # name is the caller-readable label; payload is the JSON body.
  # We keep the name in the signature even though it's unused here
  # because the call sites already pass it — makes greps easier.
  local name="$1" payload="$2"
  local body
  # `--no-buffer` flushes chunks to stdout as they arrive; `--max-time 10`
  # caps the run; `-N` disables curl's own buffering.
  body=$(curl -sS -N --no-buffer --max-time 10 \
    -X POST -H "Content-Type: application/json" \
    -d "$payload" "$BASE/api/cognitive/stream")
  printf '%s' "$body"
  # Silence shellcheck on unused var.
  : "$name"
}

# 20 /stream emits intent-decided before text-delta
BODY_20=$(stream_test "20" '{
  "userId": "stream-1",
  "message": "Hola mundo streaming",
  "preferredProvider": "mock-streaming"
}')
if echo "$BODY_20" | grep -q '^event: intent-decided' && \
   echo "$BODY_20" | grep -q '^event: text-delta' && \
   echo "$BODY_20" | grep -q '^event: done'; then
  # Check ordering: intent-decided must appear before any text-delta
  FIRST_INTENT=$(echo "$BODY_20" | grep -n '^event: intent-decided' | head -1 | cut -d: -f1)
  FIRST_DELTA=$(echo "$BODY_20" | grep -n '^event: text-delta' | head -1 | cut -d: -f1)
  if [[ -n "$FIRST_INTENT" && -n "$FIRST_DELTA" && "$FIRST_INTENT" -lt "$FIRST_DELTA" ]]; then
    green "PASS"; printf ' — 20 /stream emits intent-decided → text-delta → done\n'
    PASS=$((PASS + 1))
  else
    red "FAIL"; printf ' — 20 /stream event ordering wrong (intent=%s delta=%s)\n' "$FIRST_INTENT" "$FIRST_DELTA"
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("20 /stream event ordering")
  fi
else
  red "FAIL"; printf ' — 20 /stream missing required events\n'
  printf '      body: %s\n' "$(echo "$BODY_20" | head -20)"
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("20 /stream required events")
fi

# 21 /stream yields exactly 4 text-deltas for the mock-streaming preset
BODY_21=$(stream_test "21" '{
  "userId": "stream-2",
  "message": "quiero ver chunks",
  "preferredProvider": "mock-streaming"
}')
DELTA_COUNT=$(echo "$BODY_21" | grep -c '^event: text-delta' || true)
if [[ "$DELTA_COUNT" -eq 4 ]]; then
  green "PASS"; printf ' — 21 /stream yields 4 text-delta events (mock-streaming preset)\n'
  PASS=$((PASS + 1))
else
  red "FAIL"; printf ' — 21 /stream expected 4 deltas got %s\n' "$DELTA_COUNT"
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("21 /stream delta count")
fi

# 22 /stream terminates with a done event carrying a CognitiveResponse
BODY_22=$(stream_test "22" '{
  "userId": "stream-3",
  "message": "termina con done",
  "preferredProvider": "mock-streaming"
}')
LAST_EVENT=$(echo "$BODY_22" | grep '^event:' | tail -1)
if [[ "$LAST_EVENT" == "event: done" ]]; then
  # Extract the JSON that follows the final done event.
  DONE_JSON=$(echo "$BODY_22" | awk '/^event: done$/{flag=1;next} flag && /^data: /{print substr($0,7);exit}')
  OK=$(echo "$DONE_JSON" | node -e 'let r="";process.stdin.on("data",d=>r+=d);process.stdin.on("end",()=>{try{const p=JSON.parse(r);console.log(p.response && p.response.ok === true ? "OK" : "NOK")}catch(e){console.log("ERR")}})')
  if [[ "$OK" == "OK" ]]; then
    green "PASS"; printf ' — 22 /stream done event carries ok=true CognitiveResponse\n'
    PASS=$((PASS + 1))
  else
    red "FAIL"; printf ' — 22 /stream done response not ok: %s\n' "$OK"
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("22 /stream done ok")
  fi
else
  red "FAIL"; printf ' — 22 /stream did not end with done (last=%s)\n' "$LAST_EVENT"
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("22 /stream terminal done")
fi

# 23 /stream with InHouseGpt adapter streams token-by-token
BODY_23=$(stream_test "23" '{
  "userId": "stream-4",
  "message": "hola in-house",
  "preferredProvider": "in-house-gpt3",
  "maxTokens": 6
}')
INHOUSE_DELTAS=$(echo "$BODY_23" | grep -c '^event: text-delta' || true)
if [[ "$INHOUSE_DELTAS" -ge 1 ]]; then
  green "PASS"; printf ' — 23 /stream in-house-gpt3 yields %s token deltas\n' "$INHOUSE_DELTAS"
  PASS=$((PASS + 1))
else
  red "FAIL"; printf ' — 23 /stream in-house-gpt3 produced 0 deltas\n'
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("23 /stream in-house deltas")
fi

# 24 /stream validation event arrives before done
BODY_24=$(stream_test "24" '{
  "userId": "stream-5",
  "message": "validation ordering",
  "preferredProvider": "mock-streaming"
}')
VAL_LINE=$(echo "$BODY_24" | grep -n '^event: validation' | head -1 | cut -d: -f1)
DONE_LINE=$(echo "$BODY_24" | grep -n '^event: done' | head -1 | cut -d: -f1)
if [[ -n "$VAL_LINE" && -n "$DONE_LINE" && "$VAL_LINE" -lt "$DONE_LINE" ]]; then
  green "PASS"; printf ' — 24 /stream validation fires before done\n'
  PASS=$((PASS + 1))
else
  red "FAIL"; printf ' — 24 /stream validation/done ordering wrong (val=%s done=%s)\n' "$VAL_LINE" "$DONE_LINE"
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("24 /stream validation order")
fi

# 25 /stream rejects invalid input with 400
STREAM_INVALID_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"userId":"s","message":""}' "$BASE/api/cognitive/stream")
if [[ "$STREAM_INVALID_STATUS" == "400" ]]; then
  green "PASS"; printf ' — 25 /stream rejects empty message with 400\n'
  PASS=$((PASS + 1))
else
  red "FAIL"; printf ' — 25 /stream expected 400, got %s\n' "$STREAM_INVALID_STATUS"
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("25 /stream invalid input")
fi

# ── Turn C — context enrichment checks ────────────────────────────────────
#
# The cognitive router boots with a tiny demo memory + document store
# so live HTTP smoke tests can exercise the enrichment stage without
# any external dependencies.

# 26 /run telemetry exposes contextEnrichmentMs + contextChunksIncluded
run_test "26 POST /api/cognitive/run telemetry has context fields" /api/cognitive/run POST '{
  "userId": "smoke-demo",
  "message": "Tell me about the refund policy",
  "preferredProvider": "mock-echo"
}' '(b) => typeof b.telemetry.contextEnrichmentMs === "number" && typeof b.telemetry.contextChunksIncluded === "number"'

# 27 /run with matching document query pulls at least one chunk
run_test "27 POST /api/cognitive/run picks up doc store chunk" /api/cognitive/run POST '{
  "userId": "smoke-demo",
  "message": "Tell me about the refund policy in detail",
  "preferredProvider": "mock-echo"
}' '(b) => b.telemetry.contextChunksIncluded >= 1'

# 28 /run with matching memory query pulls the user memory
run_test "28 POST /api/cognitive/run picks up user memory" /api/cognitive/run POST '{
  "userId": "smoke-demo",
  "message": "Give me a Spanish short answer reply",
  "preferredProvider": "mock-echo"
}' '(b) => b.telemetry.contextChunksIncluded >= 1'

# 29 /run with unrelated query yields zero chunks (but no errors)
run_test "29 POST /api/cognitive/run unrelated query yields 0 chunks" /api/cognitive/run POST '{
  "userId": "smoke-demo",
  "message": "astrophysics quasar jet",
  "preferredProvider": "mock-echo"
}' '(b) => b.telemetry.contextChunksIncluded === 0 && Array.isArray(b.errors)'

# 30 /stream emits a context-enriched event after intent-decided
BODY_30=$(stream_test "30" '{
  "userId": "smoke-demo",
  "message": "Tell me about the refund policy",
  "preferredProvider": "mock-streaming"
}')
INTENT_LINE=$(echo "$BODY_30" | grep -n '^event: intent-decided' | head -1 | cut -d: -f1)
CTX_LINE=$(echo "$BODY_30" | grep -n '^event: context-enriched' | head -1 | cut -d: -f1)
if [[ -n "$INTENT_LINE" && -n "$CTX_LINE" && "$INTENT_LINE" -lt "$CTX_LINE" ]]; then
  green "PASS"; printf ' — 30 /stream context-enriched event fires after intent-decided\n'
  PASS=$((PASS + 1))
else
  red "FAIL"; printf ' — 30 /stream context/intent ordering wrong (intent=%s ctx=%s)\n' "$INTENT_LINE" "$CTX_LINE"
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("30 /stream context-enriched ordering")
fi

# 31 /stream context-enriched event payload carries chunksIncluded >= 1
CTX_JSON=$(echo "$BODY_30" | awk '/^event: context-enriched$/{flag=1;next} flag && /^data: /{print substr($0,7);exit}')
CHUNKS=$(echo "$CTX_JSON" | node -e 'let r="";process.stdin.on("data",d=>r+=d);process.stdin.on("end",()=>{try{const p=JSON.parse(r);console.log(p.chunksIncluded ?? 0)}catch{console.log(-1)}})')
if [[ "$CHUNKS" -ge 1 ]]; then
  green "PASS"; printf ' — 31 /stream context-enriched payload has chunksIncluded=%s\n' "$CHUNKS"
  PASS=$((PASS + 1))
else
  red "FAIL"; printf ' — 31 /stream expected chunksIncluded >= 1, got %s\n' "$CHUNKS"
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("31 /stream context-enriched chunksIncluded")
fi

# ── Turn D — tool execution loop checks ───────────────────────────────────
#
# The cognitive router registers a `demo_sum` tool and a `mock-tool-agent`
# adapter that drives one full agentic round trip: ask for the tool,
# receive the result, emit a stop response with the sum. Smoke tests
# verify telemetry + event ordering from end to end.

# 32 /run with mock-tool-agent executes the demo_sum tool
run_test "32 POST /api/cognitive/run tool loop executes demo_sum" /api/cognitive/run POST '{
  "userId": "smoke-tool",
  "message": "please add two numbers",
  "preferredProvider": "mock-tool-agent"
}' '(b) => b.ok === true && b.telemetry.toolCallCount === 1 && b.telemetry.agenticIterations === 2 && Array.isArray(b.toolExecutions) && b.toolExecutions.length === 1 && b.toolExecutions[0].ok === true && b.toolExecutions[0].result && b.toolExecutions[0].result.sum === 5'

# 33 /run without registry bypass: regular runs still work
run_test "33 POST /api/cognitive/run default path has zero tool calls" /api/cognitive/run POST '{
  "userId": "smoke-tool",
  "message": "say hi",
  "preferredProvider": "mock-echo"
}' '(b) => b.telemetry.toolCallCount === 0 && Array.isArray(b.toolExecutions)'

# 34 /stream with mock-tool-agent emits tool-call then tool-result
BODY_34=$(stream_test "34" '{
  "userId": "smoke-tool",
  "message": "please add 2 plus 3",
  "preferredProvider": "mock-tool-agent"
}')
TOOL_CALL_LINE=$(echo "$BODY_34" | grep -n '^event: tool-call$' | head -1 | cut -d: -f1)
TOOL_RESULT_LINE=$(echo "$BODY_34" | grep -n '^event: tool-result$' | head -1 | cut -d: -f1)
DONE_LINE_34=$(echo "$BODY_34" | grep -n '^event: done$' | head -1 | cut -d: -f1)
if [[ -n "$TOOL_CALL_LINE" && -n "$TOOL_RESULT_LINE" && -n "$DONE_LINE_34" && "$TOOL_CALL_LINE" -lt "$TOOL_RESULT_LINE" && "$TOOL_RESULT_LINE" -lt "$DONE_LINE_34" ]]; then
  green "PASS"; printf ' — 34 /stream tool-call → tool-result → done ordering\n'
  PASS=$((PASS + 1))
else
  red "FAIL"; printf ' — 34 /stream ordering wrong (call=%s result=%s done=%s)\n' "$TOOL_CALL_LINE" "$TOOL_RESULT_LINE" "$DONE_LINE_34"
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("34 /stream tool event ordering")
fi

# 35 /stream tool-result payload carries the outcome
TOOL_RESULT_JSON=$(echo "$BODY_34" | awk '/^event: tool-result$/{flag=1;next} flag && /^data: /{print substr($0,7);exit}')
TOOL_OK=$(echo "$TOOL_RESULT_JSON" | node -e 'let r="";process.stdin.on("data",d=>r+=d);process.stdin.on("end",()=>{try{const p=JSON.parse(r);console.log(p.outcome && p.outcome.ok === true && p.outcome.toolName === "demo_sum" && p.outcome.result && p.outcome.result.sum === 5 ? "OK" : "NOK")}catch{console.log("ERR")}})')
if [[ "$TOOL_OK" == "OK" ]]; then
  green "PASS"; printf ' — 35 /stream tool-result payload carries demo_sum outcome with sum=5\n'
  PASS=$((PASS + 1))
else
  red "FAIL"; printf ' — 35 /stream tool-result payload wrong: %s\n' "$TOOL_OK"
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("35 /stream tool-result payload")
fi

# 36 /run telemetry surfaces new Turn D fields
run_test "36 POST /api/cognitive/run telemetry has Turn D fields" /api/cognitive/run POST '{
  "userId": "smoke-tool",
  "message": "add some numbers",
  "preferredProvider": "mock-tool-agent"
}' '(b) => typeof b.telemetry.toolCallCount === "number" && typeof b.telemetry.toolTotalMs === "number" && typeof b.telemetry.agenticIterations === "number"'

# ── Turn E — rate limit + circuit breaker checks ──────────────────────────
#
# Uses the dedicated /throttled-demo middleware with a tiny-bucket
# limiter (capacity=2, no refill) so denial is deterministic. The
# /reset helper clears the limiter between test groups.

# Reset the throttled limiter so tests are order-independent.
curl -sS -X POST "$BASE/api/cognitive/throttled-demo/reset" -o /dev/null

# 37 /run main path telemetry has Turn E fields (normal limiter, generous)
run_test "37 POST /api/cognitive/run main path telemetry has Turn E fields" /api/cognitive/run POST '{
  "userId": "smoke-e1",
  "message": "hola turno e",
  "preferredProvider": "mock-echo"
}' '(b) => b.telemetry.rateLimitAllowed === true && typeof b.telemetry.rateLimitRemaining === "number" && typeof b.telemetry.rateLimitCheckMs === "number" && typeof b.telemetry.circuitBreakerState === "string"'

# 38 /throttled-demo/run first 2 calls allowed
run_test "38 POST /api/cognitive/throttled-demo/run first call ok" /api/cognitive/throttled-demo/run POST '{
  "userId": "smoke-drain",
  "message": "first call",
  "preferredProvider": "mock-echo"
}' '(b) => b.ok === true && b.telemetry.rateLimitAllowed === true && b.telemetry.rateLimitRemaining === 1'

run_test "39 POST /api/cognitive/throttled-demo/run second call ok" /api/cognitive/throttled-demo/run POST '{
  "userId": "smoke-drain",
  "message": "second call",
  "preferredProvider": "mock-echo"
}' '(b) => b.ok === true && b.telemetry.rateLimitRemaining === 0'

# 40 /throttled-demo/run third call is denied with rate_limited
run_test "40 POST /api/cognitive/throttled-demo/run third call rate limited" /api/cognitive/throttled-demo/run POST '{
  "userId": "smoke-drain",
  "message": "third call should be denied",
  "preferredProvider": "mock-echo"
}' '(b) => b.ok === false && b.telemetry.rateLimitAllowed === false && b.validation.issues && b.validation.issues.some(i => i.code === "rate_limited") && b.errors && b.errors.some(e => e.indexOf("rate_limited") === 0)'

# 41 /throttled-demo/run isolates buckets by user
run_test "41 POST /api/cognitive/throttled-demo/run distinct user has fresh bucket" /api/cognitive/throttled-demo/run POST '{
  "userId": "smoke-drain-other",
  "message": "different user",
  "preferredProvider": "mock-echo"
}' '(b) => b.ok === true && b.telemetry.rateLimitAllowed === true'

# Reset before next group
curl -sS -X POST "$BASE/api/cognitive/throttled-demo/reset" -o /dev/null

echo
echo "=== Results: $(green $PASS) passed, $(red $FAIL) failed ==="
if [[ $FAIL -gt 0 ]]; then
  echo
  echo "Failed tests:"
  for t in "${FAILED_TESTS[@]}"; do echo "  - $t"; done
  exit 1
fi
