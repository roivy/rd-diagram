#!/usr/bin/env bash
# Re-render every deck demo page from its canonical source with the CURRENT
# viewer template + renderers, then rebuild the hero deck (which injects the
# postMessage bridge). Run after any viewer/renderer change — refresh_baselines.sh
# only refreshes examples/, not demo/.
set -e
cd "$(dirname "$0")/.."
command -v node >/dev/null 2>&1 || { echo "node >= 18 is required"; exit 1; }
D=demo
E=rd-diagram/examples
node rd-diagram/renderers/roster/render-roster.mjs $E/project-team.roster.json $D/00-roster.html
node rd-diagram/renderers/fishbone/render-fishbone.mjs $E/production-failure.fishbone.json $D/01-fa-fishbone.html
node rd-diagram/renderers/architecture/render-architecture.mjs $E/robot-dfmea.architecture.json $D/02-dfmea.html
node rd-diagram/renderers/architecture/render-architecture.mjs $E/robot-mainboard.architecture.json $D/03-mainboard.html
node rd-diagram/renderers/workflow/render-workflow.mjs .rd/cover-src/04-8d-flow.workflow.json $D/04-8d-flow.html
node rd-diagram/renderers/mindmap/render-mindmap.mjs $E/product-planning.mindmap.json $D/05-mindmap.html
cp examples/workflow-agent-tool-call-rendered.html $D/06a-workflow.html
cp examples/sequence-cache-miss-request.html $D/06b-sequence.html
cp examples/dataflow-product-analytics.html $D/06c-dataflow.html
cp examples/lifecycle-agent-run.html $D/06d-lifecycle.html
python tools/build_hero_deck.py
echo "demo pages regenerated"
