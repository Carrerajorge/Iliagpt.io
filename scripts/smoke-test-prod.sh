#!/bin/bash
set -e

echo "=== Production Smoke Test ==="
echo ""

cleanup() {
    echo "Cleaning up..."
    if [ ! -z "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null || true
    fi
    pkill -f "node dist/index.cjs" 2>/dev/null || true
}
trap cleanup EXIT

echo "Step 1: Install all dependencies (for build + Playwright)..."
npm ci --silent 2>/dev/null || npm install --silent

echo "Step 2: Building for production..."
npm run build

echo "Step 3: Starting production server..."
NODE_ENV=production node dist/index.cjs &
SERVER_PID=$!

echo "Step 4: Waiting for server to be ready..."
MAX_WAIT=60
WAITED=0
while ! curl -s http://localhost:5000 > /dev/null 2>&1; do
    sleep 1
    WAITED=$((WAITED + 1))
    if [ $WAITED -ge $MAX_WAIT ]; then
        echo "ERROR: Server failed to start within ${MAX_WAIT}s"
        exit 1
    fi
done
echo "Server ready after ${WAITED}s"

echo "Step 5: Running smoke tests against production build..."
npx playwright test e2e/smoke.spec.ts --reporter=list

echo ""
echo "=== Smoke Tests Passed ==="
