#!/usr/bin/env bash
# Post-template refresh: whenever viewer/template changes, regenerate all
# golden baselines so `npm test` starts from a consistent checkpoint.
set -e
cd "$(dirname "$0")/../rd-diagram"
command -v node >/dev/null 2>&1 || { echo "node >= 18 is required"; exit 1; }
node scripts/render-examples.mjs examples >/dev/null
node scripts/render-examples.mjs ../examples >/dev/null
node renderers/architecture/render-architecture.mjs examples/web-app.architecture.json ../examples/web-app.html >/dev/null
node bin/rd.mjs compare architecture examples/checkout-platform.base.architecture.json examples/checkout-platform.head.architecture.json ../examples/checkout-platform-delta.html --receipt ../examples/checkout-platform-delta.receipt.json --quality showcase --json >/dev/null
node test/golden.mjs | tail -1
cd ..
# Golden refresh only touches examples/; demo pages embed the viewer
# template too and go stale without a re-render. regen_demo_pages.sh re-renders
# every deck page (bridge injection included) and rebuilds the hero deck.
bash tools/regen_demo_pages.sh
