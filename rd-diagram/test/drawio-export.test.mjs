// draw.io export contract tests.
//
// Golden snapshots live in test/fixtures/drawio/ and regenerate with:
//   node bin/rd.mjs export drawio <type> <input> test/fixtures/drawio/<name>.drawio
// (one per fixture below; keep the command list in sync when adding types).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SaxesParser } from 'saxes';

import { exportDrawio, DRAWIO_TYPES } from '../renderers/shared/drawio/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin', 'rd.mjs');

const FIXTURES = [
  ['architecture', 'web-app.architecture.json', 'web-app.architecture.drawio'],
  ['workflow', 'agent-tool-call.workflow.json', 'agent-tool-call.workflow.drawio'],
  ['sequence', 'cache-miss-request.sequence.json', 'cache-miss-request.sequence.drawio'],
  ['dataflow', 'product-analytics.dataflow.json', 'product-analytics.dataflow.drawio'],
  ['lifecycle', 'agent-run.lifecycle.json', 'agent-run.lifecycle.drawio'],
  ['fishbone', 'production-failure.fishbone.json', 'production-failure.fishbone.drawio'],
  ['mindmap', 'product-planning.mindmap.json', 'product-planning.mindmap.drawio'],
  ['roster', 'project-team.roster.json', 'project-team.roster.drawio'],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-drawio-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function exportFixture(type, inputName, outName, extra = []) {
  const input = path.join(skillRoot, 'examples', inputName);
  const out = path.join(tmp, outName);
  const stdout = execFileSync(process.execPath,
    [cli, 'export', 'drawio', type, input, out, ...extra], { encoding: 'utf8' });
  return { out, stdout, xml: fs.readFileSync(out, 'utf8') };
}

/** Strict-XML parse collecting mxCell/mxPoint structure. */
function parseMxGraph(xml) {
  return new Promise((resolve, reject) => {
    const cells = [];
    const pointsByCell = new Map();
    const stack = [];
    const parser = new SaxesParser({ xmlns: false });
    parser.on('error', (error) => reject(new Error(`XML parse error: ${error.message}`)));
    parser.on('opentag', (node) => {
      stack.push(node);
      if (node.name === 'mxCell') {
        cells.push({ attrs: { ...node.attributes }, geometry: null, points: null, open: true });
      } else if (node.name === 'mxGeometry') {
        const owner = [...stack].reverse().find((n) => n.name === 'mxCell');
        const cell = cells.find((c) => c.attrs.id === owner?.attributes.id && c.open);
        if (cell) cell.geometry = { ...node.attributes };
      } else if (node.name === 'mxPoint') {
        const owner = [...stack].reverse().find((n) => n.name === 'mxCell');
        const cell = cells.find((c) => c.attrs.id === owner?.attributes.id && c.open);
        if (cell) {
          cell.points = cell.points || [];
          cell.points.push([Number(node.attributes.x), Number(node.attributes.y)]);
        }
      }
    });
    parser.on('closetag', (node) => {
      if (node.name === 'mxCell') {
        const cell = [...cells].reverse().find((c) => c.attrs.id === node.attributes.id && c.open);
        if (cell) cell.open = false;
      }
      stack.pop();
    });
    parser.on('end', () => resolve(cells));
    parser.write(xml).close();
  });
}

async function assertMxGraphContract(type, inputName, outName) {
  const { xml } = exportFixture(type, inputName, outName);
  assert.match(xml, /^<mxfile host="rd-diagram"/);
  assert.doesNotMatch(xml, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:/, 'no timestamps');
  const cells = await parseMxGraph(xml);
  const vertices = cells.filter((cell) => cell.attrs.vertex === '1');
  const edges = cells.filter((cell) => cell.attrs.edge === '1');
  assert.ok(vertices.length > 0, `${type}: at least one vertex`);
  const ids = new Set(cells.map((cell) => cell.attrs.id));
  assert.equal(ids.size, cells.length, `${type}: unique cell ids`);
  const vertexIds = new Set(vertices.map((cell) => cell.attrs.id));
  for (const edge of edges) {
    assert.ok(vertexIds.has(edge.attrs.source), `${type}: edge source ${edge.attrs.source} exists`);
    assert.ok(vertexIds.has(edge.attrs.target), `${type}: edge target ${edge.attrs.target} exists`);
  }
  for (const cell of vertices) {
    assert.ok(cell.geometry, `${type}: vertex carries geometry`);
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.ok(Number.isFinite(Number(cell.geometry[key])), `${type}: finite geometry`);
    }
  }
  return { xml, vertices, edges };
}

test('drawio: exports all eight diagram types as valid mxGraph XML', async () => {
  assert.equal(DRAWIO_TYPES.length, 8);
  for (const [type, inputName] of FIXTURES) {
    const { vertices, edges } = await assertMxGraphContract(type, inputName, `${type}-contract.drawio`);
    assert.ok(vertices.length >= 5, `${type}: meaningful node count (${vertices.length})`);
    assert.ok(edges.length >= 1, `${type}: at least one edge (${edges.length})`);
  }
});

test('drawio: every edge pins at least one waypoint (sequence order survives)', async () => {
  const { edges } = await assertMxGraphContract('sequence', 'cache-miss-request.sequence.json', 'sequence-waypoints.drawio');
  assert.ok(edges.length >= 10, 'sequence fixture carries its messages');
  for (const edge of edges) {
    assert.ok(Array.isArray(edge.points) && edge.points.length >= 1, `edge ${edge.attrs.id} has a waypoint`);
    for (const [x, y] of edge.points) assert.ok(Number.isFinite(x) && Number.isFinite(y), 'waypoint is finite');
  }
});

test('drawio: identical input exports byte-identical files and receipts', () => {
  const first = exportFixture('workflow', 'agent-tool-call.workflow.json', 'det-1.drawio', ['--json']);
  const second = exportFixture('workflow', 'agent-tool-call.workflow.json', 'det-2.drawio', ['--json']);
  assert.equal(first.xml, second.xml, 'xml bytes identical');
  const receiptA = JSON.parse(first.stdout);
  const receiptB = JSON.parse(second.stdout);
  assert.equal(receiptA.sha256, receiptB.sha256, 'receipt sha256 identical');
  assert.equal(receiptA.ok, true);
  assert.equal(typeof receiptA.sha256, 'string');
  assert.ok(receiptA.stats.nodes > 0);
});

test('drawio: theme flag switches the palette', () => {
  const light = exportFixture('dataflow', 'product-analytics.dataflow.json', 'theme-light.drawio');
  const dark = exportFixture('dataflow', 'product-analytics.dataflow.json', 'theme-dark.drawio', ['--theme', 'dark']);
  const lightFill = /fillColor=(#[0-9a-f]{6})/.exec(light.xml)[1];
  const darkFill = /fillColor=(#[0-9a-f]{6})/.exec(dark.xml)[1];
  assert.notEqual(lightFill, darkFill, 'palette actually changes');
  assert.match(light.stdout, /theme-light\.drawio/, 'CLI prints the output path');
});

test('drawio: golden snapshots stay byte-stable', () => {
  for (const [type, inputName, goldenName] of FIXTURES) {
    const goldenPath = path.join(skillRoot, 'test', 'fixtures', 'drawio', goldenName);
    const { xml } = exportFixture(type, inputName, `golden-${goldenName}`);
    const golden = fs.readFileSync(goldenPath, 'utf8').replace(/\r\n?/g, '\n');
    assert.equal(xml, golden, `${goldenName} drifted — regenerate with the command at the top of this file`);
  }
});

test('drawio: unknown type, unknown option, and arity errors exit with usage code 2', () => {
  const unknownType = runCli(['export', 'drawio', 'bogus', path.join(skillRoot, 'examples/web-app.architecture.json')]);
  assert.equal(unknownType.status, 2);
  assert.match(unknownType.stderr, /Unsupported diagram type/);
  const unknownOption = runCli(['export', 'drawio', 'workflow', path.join(skillRoot, 'examples/agent-tool-call.workflow.json'), '--nope']);
  assert.equal(unknownOption.status, 2);
  assert.match(unknownOption.stderr, /Unknown export option/);
  const missingArgs = runCli(['export', 'drawio']);
  assert.equal(missingArgs.status, 2);
  assert.match(missingArgs.stderr, /Usage:/);
  const unknownFormat = runCli(['export', 'mermaid']);
  assert.equal(unknownFormat.status, 2);
  assert.match(unknownFormat.stderr, /Unknown export format/);
});

test('drawio: renderer failure rejects the export without leaving an output file', () => {
  const badInput = path.join(tmp, 'bad.workflow.json');
  fs.writeFileSync(badInput, JSON.stringify({ schema_version: 2, diagram_type: 'workflow', meta: {}, lanes: [], nodes: [] }));
  const target = path.join(tmp, 'must-not-exist.drawio');
  const result = runCli(['export', 'drawio', 'workflow', badInput, target]);
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(target), false, 'no partial output');
});

test('drawio: exportDrawio rejects geometry invariant violations', () => {
  const html = '<html><body><svg viewBox="0 0 400 200">'
    + '<g data-node-id="a" data-node-label="A"><rect x="10" y="10" width="80" height="40"/></g>'
    + '<path data-edge-from="a" data-edge-to="ghost" d="M 20 20 L 200 60"/>'
    + '</svg></body></html>';
  assert.throws(() => exportDrawio(html, { type: 'architecture' }), /unknown node ghost|invariants violated/);
});
