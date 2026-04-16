#!/bin/bash
set -e

echo "=== Sira GPT Test Suite ==="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo "Checking prerequisites..."

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed${NC}"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Warning: node_modules not found. Running npm install...${NC}"
    npm install
fi

# Check if Playwright is installed
if ! npx playwright --version &> /dev/null; then
    echo -e "${YELLOW}Warning: Playwright not installed. Installing browsers...${NC}"
    npx playwright install chromium
fi

# Kill any processes using ports 5000 or 5173 (common dev ports)
echo "Checking for port conflicts..."
for PORT in 5000 5173; do
    PID=$(lsof -ti:$PORT 2>/dev/null || true)
    if [ -n "$PID" ]; then
        echo -e "${YELLOW}Killing process on port $PORT (PID: $PID)${NC}"
        kill -9 $PID 2>/dev/null || true
        sleep 1
    fi
done

# Run unit tests
echo ""
echo "=== Running Unit Tests (Vitest) ==="
echo ""

if npm run test:run -- server/__tests__/documentAnalysis.test.ts; then
    echo -e "${GREEN}✓ Unit tests passed${NC}"
    UNIT_RESULT=0
else
    echo -e "${RED}✗ Unit tests failed${NC}"
    UNIT_RESULT=1
fi

# Run E2E tests (Playwright handles its own server via webServer config)
echo ""
echo "=== Running E2E Tests (Playwright) ==="
echo ""

if npx playwright test --reporter=list; then
    echo -e "${GREEN}✓ E2E tests passed${NC}"
    E2E_RESULT=0
else
    echo -e "${RED}✗ E2E tests failed${NC}"
    E2E_RESULT=1
fi

# Summary
echo ""
echo "=== Test Summary ==="
if [ $UNIT_RESULT -eq 0 ] && [ $E2E_RESULT -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed${NC}"
    [ $UNIT_RESULT -ne 0 ] && echo -e "${RED}  - Unit tests: FAILED${NC}"
    [ $E2E_RESULT -ne 0 ] && echo -e "${RED}  - E2E tests: FAILED${NC}"
    exit 1
fi
