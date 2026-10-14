import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import { loadDiagramWithBrandMarks, writeDiagram, svgRootAttrs, svgAccessibleText, focusEdgeAttrs, animateAttr } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';

// Mind map renderer: a balanced horizontal tree. The root sits at the center;
// branches alternate right/left sides; each subtree's leaves are evenly spaced
// and the subtree is vertically centered on its parent. Branch tones rotate
// through the theme's semantic palette so every first-level branch reads as a
// distinct color band, inherited by its descendants.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: mindmap, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'mindmap',
  defaultExample: 'product-planning.mindmap.json',
});

// Canvas auto-sizes to the content: width from the deepest level per side,
// height from the leaf count, so dense maps never clip.
const LEVEL_GAP = 236;
const LEAF_GAP = 34;
const NODE_H = 40;
const NODE_PAD = 14;
const MAX_TEXT_UNITS = 18;
const ROOT_ZONE = 190; // half-width reserved around the root

const TONES = [
  '--frontend-fill', '--backend-fill', '--database-fill', '--cloud-fill',
  '--security-fill', '--messagebus-fill', '--external-fill',
];

const problems = [];

function clampText(text, maxUnits) {
  const units = textUnits(String(text));
  if (units <= maxUnits) return String(text);
  return `${String(text).slice(0, maxUnits - 1)}…`;
}

function nodeWidth(text) {
  return Math.max(84, Math.min(LEVEL_GAP - 70, NODE_PAD * 2 + textUnits(String(text)) * 9.5));
}

function leafCount(node) {
  const children = node.children || [];
  if (!children.length) return 1;
  return children.reduce((sum, child) => sum + leafCount(child), 0);
}

// Layout: returns placed nodes [{node, x, y, w, depth, tone, side, id, branch}]
// where `branch` is the first-level ancestor's text — the outline index groups
// every descendant under its branch so the map reads category by category.
const placed = [];
function layoutSide(sideNodes, side, xStart) {
  const totalLeaves = sideNodes.reduce((sum, node) => sum + leafCount(node), 0);
  const totalH = totalLeaves * LEAF_GAP;
  let cursor = ROOT_Y - totalH / 2 + LEAF_GAP / 2;
  let toneIndex = 0;

  function place(node, x, depth, tone, side, id, branch) {
    const children = node.children || [];
    const w = nodeWidth(node.text);
    if (!children.length) {
      const y = cursor;
      cursor += LEAF_GAP;
      placed.push({ node, x, y, w, depth, tone, side, id, branch });
      return y;
    }
    const childX = side === 'right' ? x + LEVEL_GAP : x - LEVEL_GAP;
    const childCenterStart = cursor;
    const centers = children.map((child, index) => place(
      child, childX, depth + 1, tone, side, `${id}-${index}`, depth === 1 ? node.text : branch,
    ));
    const y = (centers[0] + centers[centers.length - 1]) / 2;
    void childCenterStart;
    placed.push({ node, x, y, w, depth, tone, side, id, branch });
    return y;
  }

  sideNodes.forEach((node, index) => {
    const tone = TONES[(toneIndex + (side === 'left' ? 4 : 0)) % TONES.length];
    toneIndex += 1;
    place(node, xStart, 1, tone, side, `${side}-${index}`, node.text);
  });
}

function depthOf(node, level = 0) {
  const children = node.children || [];
  if (!children.length) return level;
  return Math.max(...children.map((child) => depthOf(child, level + 1)));
}

const branches = mindmap.branches;
// Balance sides by leaf weight (greedy partition keeps sibling order).
const weights = branches.map((node) => ({ node, weight: leafCount(node) }));
const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
const rightNodes = [];
const leftNodes = [];
let rightWeight = 0;
for (const entry of weights) {
  if (rightWeight < totalWeight / 2 || leftNodes.length >= 5) {
    rightNodes.push(entry.node);
    rightWeight += entry.weight;
  } else {
    leftNodes.push(entry.node);
  }
}
if (!leftNodes.length && rightNodes.length > 1) leftNodes.push(rightNodes.pop());

const rightDepth = Math.max(0, ...rightNodes.map((node) => depthOf(node, 1)));
const leftDepth = Math.max(0, ...leftNodes.map((node) => depthOf(node, 1)));
const totalLeaves2 = rightNodes.reduce((sum, node) => sum + leafCount(node), 0)
  + leftNodes.reduce((sum, node) => sum + leafCount(node), 0);
let VIEW_W = Math.max(1880, ROOT_ZONE * 2 + (rightDepth + leftDepth) * LEVEL_GAP + NODE_PAD * 2 + 120);
let VIEW_H = Math.max(760, totalLeaves2 * LEAF_GAP + 120);
// Keep the canvas a wide diagram (ratio >= 1.6) so the reader accepts its
// declared readable vertical scroll instead of reporting unexpected overflow.
if (VIEW_W / VIEW_H < 1.6) VIEW_W = Math.ceil(VIEW_H * 1.6);
const __rdFitW = VIEW_W; const __rdFitH = VIEW_H;
const ROOT_X = VIEW_W / 2;
const ROOT_Y = VIEW_H / 2;
globalThis.__rdMindView = [VIEW_W, VIEW_H];

layoutSide(rightNodes, 'right', ROOT_X + ROOT_ZONE - 20);
layoutSide(leftNodes, 'left', ROOT_X - ROOT_ZONE + 20);

// Canvas containment diagnostics.
for (const item of placed) {
  const x0 = item.side === 'right' ? item.x : item.x - item.w;
  if (x0 < 8 || item.x + item.w > VIEW_W - 8 || item.y < 24 || item.y > VIEW_H - 16) {
    problems.push(`Node ${JSON.stringify(item.node.text)} falls outside the canvas at depth ${item.depth}.`);
  }
}
if (problems.length) {
  throwDiagnosticProblems('Mind map layout constraints violated', problems, {
    code: 'mindmap/layout',
    subject: { diagramType: 'mindmap' },
    diagnostics: problems.map((message) => ({
      code: 'mindmap/node-out-of-canvas', severity: 'error', message,
      subject: { diagramType: 'mindmap' }, evidence: {}, supportedFixes: ['shorten labels, reduce branches, or reduce depth to 3 levels'],
    })),
  });
}

const svgParts = [];
svgParts.push(renderDefinitions());

// Root
const rootW = nodeWidth(mindmap.root.text) + 40;
svgParts.push(
  `  <g class="rd-mind-root" data-node-id="root" data-node-label="${esc(mindmap.root.text)}"${animateAttr(mindmap.meta, 'node', 0)}>`,
  `    <rect x="${ROOT_X - rootW / 2}" y="${ROOT_Y - 26}" width="${rootW}" height="52" rx="12" />`,
  `    <text class="rd-mind-root-text" x="${ROOT_X}" y="${ROOT_Y + 6}">${esc(clampText(mindmap.root.text, 16))}</text>`,
  mindmap.root.sublabel
    ? `    <text class="rd-mind-root-sub" x="${ROOT_X}" y="${ROOT_Y + 44}">${esc(clampText(mindmap.root.sublabel, 26))}</text>`
    : '',
  '  </g>',
);

// Connectors + nodes
for (const item of placed) {
  const isBranch = item.depth === 1;
  const x0 = item.side === 'right' ? item.x : item.x - item.w;
  const anchorParentX = item.side === 'right' ? x0 : x0 + item.w;
  svgParts.push(
    `  <g class="rd-mind-node${isBranch ? ' rd-mind-branch' : ' rd-mind-child'}" data-node-id="${esc(item.id)}" data-node-label="${esc(item.node.text)}" data-node-outline-group="${esc(item.branch)}"${animateAttr(mindmap.meta, 'node', item.depth)}>`,
  );
  svgParts.push(
    isBranch
      ? `    <rect class="rd-mind-branch-box" fill="var(${item.tone})" x="${x0}" y="${item.y - NODE_H / 2}" width="${item.w}" height="${NODE_H}" rx="8" />`
      : `    <rect class="rd-mind-child-box" fill="var(${item.tone})" x="${x0}" y="${item.y - NODE_H / 2 + 2}" width="${item.w}" height="${NODE_H - 4}" rx="6" />`,
    `    <text class="${isBranch ? 'rd-mind-branch-text' : 'rd-mind-child-text'}" x="${x0 + item.w / 2}" y="${item.y + (isBranch ? 5 : 4)}">${esc(clampText(item.node.text, isBranch ? MAX_TEXT_UNITS : 14))}</text>`,
  );
  if (item.node.sublabel) {
    svgParts.push(
      `    <text class="rd-mind-node-sub" x="${x0 + item.w / 2}" y="${item.y + NODE_H / 2 + 13}">${esc(clampText(item.node.sublabel, 20))}</text>`,
    );
  }
  svgParts.push('  </g>');
}
// Connectors after nodes so curves sit under boxes visually is fine either way;
// emit connectors as a group beneath by prepending them before node groups.
const connectorParts = [];
let connectorIndex = 0;
function connector(parentX, parentY, childAnchorX, childY, tone, fromId, toId, depth) {
  const midX = (parentX + childAnchorX) / 2;
  const index = connectorIndex;
  connectorIndex += 1;
  connectorParts.push(
    `    <path ${focusEdgeAttrs(fromId, toId, '', index, `mind-${index}`)}${animateAttr(mindmap.meta, 'edge', depth)} class="rd-mind-link" stroke="var(${tone})" d="M ${parentX} ${parentY} C ${midX} ${parentY}, ${midX} ${childY}, ${childAnchorX} ${childY}" />`,
  );
}
for (const item of placed) {
  const children = item.node.children || [];
  if (!children.length) continue;
  const parentX = item.side === 'right' ? item.x + item.w : item.x - item.w;
  for (const [childIndex] of children.entries()) {
    const child = placed.find((candidate) => candidate.id === `${item.id}-${childIndex}`);
    if (!child) continue;
    const childAnchorX = child.side === 'right' ? child.x : child.x - child.w;
    connector(parentX, item.y, childAnchorX, child.y, item.tone, item.id, child.id, child.depth);
  }
}
// Root connectors
for (const node of branches) {
  const item = placed.find((candidate) => candidate.node === node);
  if (!item) continue;
  const anchorX = item.side === 'right' ? item.x : item.x - item.w;
  const rootAnchorX = item.side === 'right' ? ROOT_X + rootW / 2 : ROOT_X - rootW / 2;
  connector(rootAnchorX, ROOT_Y, anchorX, item.y, item.tone, 'root', item.id, 1);
}

const svg = [
  `    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" ${svgRootAttrs(mindmap.meta)} data-diagram-type="mindmap" data-reader-fit="authored-height" xmlns="http://www.w3.org/2000/svg">`,
  `      ${svgAccessibleText(mindmap.meta, 'title')}`,
  `      ${svgAccessibleText(mindmap.meta, 'description')}`,
  `  <style>
    .rd-mind-root rect { fill: var(--frontend-fill); stroke: var(--frontend-stroke); stroke-width: 3; }
    .rd-mind-root-text { fill: var(--text); font-weight: 700; font-size: 17px; text-anchor: middle; }
    .rd-mind-root-sub { fill: var(--text-dim); font-size: 12px; text-anchor: middle; }
    .rd-mind-branch-box { stroke: var(--lane-stroke); stroke-width: 1.5; }
    .rd-mind-branch-text { fill: var(--text); font-weight: 700; font-size: 17px; text-anchor: middle; }
    .rd-mind-child-box { stroke: none; opacity: 0.72; }
    .rd-mind-child-text { fill: var(--text); font-size: 15px; text-anchor: middle; }
    .rd-mind-node-sub { fill: var(--text-muted); font-size: 12px; text-anchor: middle; }
    .rd-mind-link { fill: none; stroke-width: 2.2; opacity: 0.75; }
  </style>`,
  connectorParts.join('\n'),
  svgParts.join('\n'),
  '    </svg>',
].join('\n');

writeDiagram({
  outPath,
  template,
  diagramType: 'mindmap',
  meta: mindmap.meta,
  svg,
  cards: [],
  source: mindmap,
});
