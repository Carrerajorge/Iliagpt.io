#!/bin/bash
set -e

echo "=== IliaGPT Production Build ==="

echo "1. Building application..."
npm run build

echo "2. Pruning dev dependencies..."
npm prune --production

echo "3. Removing large dev-only directories..."
rm -rf native/ .pythonlibs/ python_agent_tools/ attached_assets/ artifacts/ \
       .local/ .cache/ .agents/ .upm/ .npm/ .config/ .canvas/ \
       desktop/ daemon/ tests/ e2e/ scripts/ docs/ Downloads/ \
       sandbox_workspace/ generated_reports/ uploads/ \
       .git/ .github/ .husky/ tmp/

echo "4. Removing frontend source (already bundled in dist/)..."
rm -rf client/src/ client/public/

echo "5. Removing remaining large dev packages from node_modules..."
rm -rf node_modules/electron/ node_modules/electron-builder/ \
       node_modules/app-builder-bin/ node_modules/app-builder-lib/ \
       node_modules/7zip-bin/ node_modules/@opentelemetry/ \
       node_modules/three/ node_modules/3d-force-graph/ \
       node_modules/react-force-graph-3d/ node_modules/three-render-objects/ \
       node_modules/playwright-core/ node_modules/@types/ \
       node_modules/lightningcss-linux-x64-musl/ node_modules/lightningcss-linux-x64-gnu/ \
       node_modules/.cache/ node_modules/.vite/

echo "6. Removing source maps..."
find . -name "*.map" -delete 2>/dev/null || true

echo "=== Build complete ==="
du -sh node_modules/ 2>/dev/null || true
echo "Ready for deployment."
