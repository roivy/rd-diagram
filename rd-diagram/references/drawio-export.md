# draw.io export

Convert any of the eight diagram types into an editable draw.io file
(uncompressed mxGraph XML — deterministic, diffable, no timestamps).

```bash
node bin/rd.mjs export drawio <type> <input.json> [output.drawio] [--theme light|dark] [--json]
```

The export renders the input through the normal renderer in a temp file and
extracts geometry from the artifact's semantic SVG — there is exactly one
rendering path, so a `.drawio` always matches what the HTML artifact shows.
When `output.drawio` is omitted the file lands next to the input with a
`.drawio` extension. `--json` prints a receipt with `sha256` and extraction
stats (node/edge/container counts and every dropped decoration class).

## What maps to what

| rd artifact | draw.io |
|---|---|
| node group (`data-node-id`) | vertex cell (rounded box, label + sublabel as two lines) |
| semantic kind / outline group (`data-node-kind`, `data-node-outline-group`) | fill/stroke from a fixed palette (`--theme` picks light or dark); unknown roles hash to a stable palette slot |
| edge (`data-edge-from/to`) | edge cell with the authored route as waypoints; endpoints float so draw.io re-anchors cleanly |
| lanes, regions, stages, segments, groups | dashed group cells; nodes are parented into the innermost containing frame (child geometry becomes parent-relative) |
| fishbone category | group cell that owns its causes; the bone stays a diagonal edge to the head |
| roster person | vertex with name, title, and skills as label lines; reporting elbows keep their waypoints |

## Deliberate trade-offs

- **Sequence order survives**: every two-point edge still pins a midpoint
  waypoint, so sequence messages keep their chronological height even though
  endpoints float.
- **Colors are semantic, not pixel-copied**: CSS variables from the viewer
  theme are not resolvable offline, so roles map to draw.io's native palette
  per `--theme`.
- **Decorations are counted, never silently dropped**: fishbone tails and
  head decorations, sequence lifelines/activations, lifecycle start/end
  markers, and edge-label masks are folded into labels or reported in the
  `--json` receipt's `decorationsDropped`.
- **Approximate geometry**: mind-map bezier links are flattened with two
  sampled interior waypoints; fishbone cause boxes are derived from their
  label text. Both remain fully editable in draw.io.

## Fail-closed contract

Exports validate a geometry model before emitting: unique ids, every edge
endpoint must reference an extracted node, finite positive boxes. Any
violation rejects the export with the problem list and writes no file.
Golden snapshots for all eight types live in `test/fixtures/drawio/` and are
byte-compared on every test run (regeneration command at the top of
`test/drawio-export.test.mjs`).
