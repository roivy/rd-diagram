// Per-type extraction: semantic SVG -> DiagramGeometry.
//
// One declarative profile per diagram type drives a single extractor. The
// profile decides which structural frames become containers, how node labels
// are shaped, and which special geometries (fishbone twigs, mind-map bezier
// links) need derived boxes or sampled waypoints. Decorations that carry no
// semantic weight (fish tails, lifelines, activation bars, label masks) are
// counted and dropped — never silently lost.

import { parseSvgTree, walkTree, findElements, numberAttr, firstRectBox, rectBox } from './svg-tokens.mjs';

export const DRAWIO_TYPES = Object.freeze([
  'architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'fishbone', 'mindmap', 'roster',
]);

const PROFILES = Object.freeze({
  architecture: { containerKinds: ['region', 'security-group'] },
  workflow: { containerKinds: ['lane', 'group'] },
  sequence: { containerKinds: ['segment'] },
  dataflow: { containerKinds: ['stage'] },
  lifecycle: { containerKinds: [] },
  fishbone: { containerKinds: [], fishbone: true },
  mindmap: { containerKinds: [] },
  roster: { containerKinds: [], roster: true },
});

function estimateTextWidth(text, fontSize) {
  let units = 0;
  for (const character of String(text)) {
    units += character.codePointAt(0) > 0x2e80 ? 1 : 0.62;
  }
  return Math.ceil(units * fontSize);
}

/** The one semantic diagram SVG inside a rendered artifact. */
export function extractDiagramSvg(html) {
  const blocks = [];
  const openTag = /<svg\b[^>]*>/g;
  for (let match = openTag.exec(html); match; match = openTag.exec(html)) {
    const end = html.indexOf('</svg>', match.index);
    if (end === -1) continue;
    blocks.push({ markup: html.slice(match.index, end + 6), tag: match[0] });
  }
  if (!blocks.length) return null;
  const semantic = blocks.filter((block) => block.markup.includes('data-node-id='));
  const pool = semantic.length ? semantic : blocks;
  return pool.sort((a, b) => b.markup.length - a.markup.length)[0];
}

function viewBoxOf(openTag) {
  const match = /viewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/.exec(openTag);
  if (!match) return null;
  const [, minX, minY, width, height] = match.map(Number);
  return { minX, minY, width, height };
}

function quadSample(start, control, end, t) {
  const inverse = 1 - t;
  return [
    inverse * inverse * start[0] + 2 * inverse * t * control[0] + t * t * end[0],
    inverse * inverse * start[1] + 2 * inverse * t * control[1] + t * t * end[1],
  ];
}

function cubicSample(start, c1, c2, end, t) {
  const inverse = 1 - t;
  return [
    inverse ** 3 * start[0] + 3 * inverse ** 2 * t * c1[0] + 3 * inverse * t * t * c2[0] + t ** 3 * end[0],
    inverse ** 3 * start[1] + 3 * inverse ** 2 * t * c1[1] + 3 * inverse * t * t * c2[1] + t ** 3 * end[1],
  ];
}

/** Flatten an SVG path (M/L/Q/C) into a polyline; null when unusable. */
function flattenPath(d) {
  if (!d) return null;
  const numbers = d.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  const commands = d.match(/[MLQCZmlqcz]/g) ?? [];
  if (!numbers.length || !commands.length) return null;
  const points = [];
  let cursor = 0;
  let current = null;
  for (const command of commands) {
    const upper = command.toUpperCase();
    if (upper === 'M' || upper === 'L') {
      current = [numbers[cursor], numbers[cursor + 1]];
      cursor += 2;
      points.push(current);
    } else if (upper === 'Q') {
      const control = [numbers[cursor], numbers[cursor + 1]];
      const end = [numbers[cursor + 2], numbers[cursor + 3]];
      cursor += 4;
      points.push(quadSample(current, control, end, 0.5), end);
      current = end;
    } else if (upper === 'C') {
      const c1 = [numbers[cursor], numbers[cursor + 1]];
      const c2 = [numbers[cursor + 2], numbers[cursor + 3]];
      const end = [numbers[cursor + 4], numbers[cursor + 5]];
      cursor += 6;
      points.push(cubicSample(current, c1, c2, end, 1 / 3), cubicSample(current, c1, c2, end, 2 / 3), end);
      current = end;
    } else if (upper === 'Z') {
      break;
    } else {
      return null;
    }
  }
  const deduped = [];
  for (const point of points) {
    if (!point.every(Number.isFinite)) return null;
    const previous = deduped[deduped.length - 1];
    if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 0.5) deduped.push(point);
  }
  return deduped.length >= 2 ? deduped : null;
}

function compositionPoints(value) {
  if (!value) return null;
  const points = value.split(';').map((pair) => pair.split(',').map(Number)).filter((point) => point.length === 2 && point.every(Number.isFinite));
  return points.length >= 2 ? points : null;
}

function shiftBox(box, dx, dy) {
  return { x: box.x - dx, y: box.y - dy, width: box.width, height: box.height };
}

function shiftPoints(points, dx, dy) {
  return points.map(([x, y]) => [x - dx, y - dy]);
}

function centerInside(box, point) {
  return point[0] >= box.x && point[0] <= box.x + box.width
    && point[1] >= box.y && point[1] <= box.y + box.height;
}

function groupOf(nodeId) {
  return `group-of-${nodeId}`;
}

function nodeFontSize(element) {
  const text = element.children.find((child) => child.tag === 'text' && child.attrs['data-node-label'] !== undefined)
    || element.children.find((child) => child.tag === 'text');
  const size = numberAttr(text?.attrs ?? {}, 'font-size');
  return size && size >= 8 ? Math.round(size) : null;
}

function labelInside(tree, box) {
  const strip = { x: box.x, y: box.y, width: box.width, height: 26 };
  let best = null;
  walkTree(tree, (element) => {
    if (element.tag !== 'text' || !element.text) return;
    const x = numberAttr(element.attrs, 'x');
    const y = numberAttr(element.attrs, 'y');
    if (x === null || y === null) return;
    if (!centerInside(strip, [x, y])) return;
    if (!best || x < best.x) best = { x, text: element.text };
  });
  return best ? best.text : '';
}

/**
 * Extract a geometry model from a rendered artifact's HTML. Returns
 * { geometry, stats }; fail-closed validation lives in model.mjs so callers
 * can reject with the full problem list instead of a partial diagram.
 */
export function extractDiagramGeometry(html, type, title) {
  const profile = PROFILES[type];
  if (!profile) {
    throw new Error(`Unsupported diagram type for draw.io export: ${type}`);
  }
  const svgBlock = extractDiagramSvg(html);
  if (!svgBlock) throw new Error('No diagram SVG found in the rendered artifact.');
  const viewBox = viewBoxOf(svgBlock.tag);
  const tree = parseSvgTree(svgBlock.markup);

  // The tokenizer keeps no parent links; index ancestry once, up front.
  const parentOf = new Map();
  walkTree(tree, (element, parent) => parentOf.set(element, parent));

  const decorations = {};
  const dropped = (reason, count = 1) => { if (count > 0) decorations[reason] = (decorations[reason] || 0) + count; };

  // --- containers: structural frames + roster card-wall groups ---
  const containers = [];
  if (profile.containerKinds.length) {
    for (const element of findElements(tree, (node) => node.tag === 'rect' && node.attrs['data-graph-role'] === 'structural-frame')) {
      const kind = element.attrs['data-composition-frame-kind'];
      if (!profile.containerKinds.includes(kind)) {
        dropped(`frame:${kind || 'unknown'}`);
        continue;
      }
      const box = rectBox(element);
      if (!box) continue;
      containers.push({
        id: `frame-${element.attrs['data-composition-frame-id'] || containers.length}`,
        kind, box,
        label: element.attrs['data-composition-frame-label'] || labelInside(tree, box),
      });
    }
  }
  if (profile.roster) {
    for (const element of findElements(tree, (node) => node.attrs.class === 'rd-roster-group' && node.attrs['data-node-id'])) {
      const box = firstRectBox(element);
      if (!box) continue;
      containers.push({ id: groupOf(element.attrs['data-node-id']), kind: 'group', box, label: element.attrs['data-node-label'] || '' });
    }
  }

  // --- nodes ---
  const nodes = [];
  const nodeElementById = new Map();
  const categoryOfCause = new Map();
  const categoryIds = new Set();
  for (const element of findElements(tree, (node) => Boolean(node.attrs?.['data-node-id']))) {
    const id = element.attrs['data-node-id'];
    if (profile.roster && element.attrs.class === 'rd-roster-group') continue; // container, not vertex
    let box = firstRectBox(element);
    let label = element.attrs['data-node-label'] || id;
    let sublabel = element.attrs['data-node-sublabel'] || '';

    if (profile.fishbone && /rd-fish-cause/.test(element.attrs.class || '')) {
      const text = element.children.find((child) => /rd-fish-cause-text/.test(child.attrs.class || ''));
      const fontSize = numberAttr(text?.attrs ?? {}, 'font-size') ?? 13;
      const tx = numberAttr(text?.attrs ?? {}, 'x');
      const ty = numberAttr(text?.attrs ?? {}, 'y');
      if (!text || tx === null || ty === null) { dropped('fishbone-causes-without-text'); continue; }
      const width = estimateTextWidth(text.text, fontSize) + 12;
      box = { x: tx - width / 2, y: ty - fontSize, width, height: fontSize + 7 };
      label = text.text;
    }
    if (!box) { dropped('nodes-without-geometry'); continue; }

    if (profile.roster) {
      const parts = label.split(' · ');
      if (parts.length > 1) {
        label = parts[0];
        sublabel = parts.slice(1).join(' · ');
      }
      const skills = element.children
        .filter((child) => child.attrs.class === 'rd-roster-skill')
        .map((chip) => chip.children.find((grandchild) => grandchild.tag === 'text')?.text || '')
        .filter(Boolean);
      if (skills.length) sublabel = [sublabel, skills.join(' · ')].filter(Boolean).join('\n');
    }
    if (/rd-mind-root/.test(element.attrs.class || '')) {
      const sub = element.children.find((child) => child.attrs.class === 'rd-mind-root-sub');
      if (sub?.text) sublabel = sub.text;
    }

    nodes.push({
      id, label, sublabel,
      styleRole: element.attrs['data-node-kind'] || element.attrs['data-node-outline-group'] || 'default',
      box, containerId: null,
      fontSize: nodeFontSize(element),
      verified: profile.fishbone ? /rd-fish-verified/.test(element.attrs.class || '') : false,
    });
    nodeElementById.set(id, element);

    if (profile.fishbone && /rd-fish-category/.test(element.attrs.class || '')) {
      containers.push({ id: groupOf(id), kind: 'group', box, label: element.attrs['data-node-label'] || '' });
      categoryIds.add(id);
    }
  }

  if (profile.fishbone) {
    for (const node of nodes) {
      if (!/rd-fish-cause/.test(nodeElementById.get(node.id)?.attrs.class || '')) continue;
      let cursor = parentOf.get(nodeElementById.get(node.id));
      while (cursor && !categoryIds.has(cursor.attrs?.['data-node-id'])) cursor = parentOf.get(cursor);
      if (cursor?.attrs?.['data-node-id']) {
        categoryOfCause.set(node.id, cursor.attrs['data-node-id']);
        node.containerId = groupOf(cursor.attrs['data-node-id']);
      }
    }
  }

  // --- edges ---
  const edges = [];
  const seenEdgeKeys = new Set();
  const addEdge = (edge) => {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.points.flat().map((n) => Math.round(n)).join(',')}`;
    if (seenEdgeKeys.has(key)) return;
    seenEdgeKeys.add(key);
    edges.push(edge);
  };
  walkTree(tree, (element) => {
    const attrs = element.attrs || {};
    if (element.tag === 'path' && attrs['data-edge-from']) {
      const points = compositionPoints(attrs['data-composition-points']) || flattenPath(attrs.d);
      if (!points) { dropped('edges-without-geometry'); return; }
      addEdge({
        from: attrs['data-edge-from'], to: attrs['data-edge-to'],
        label: attrs['data-edge-label'] || '', points, dashed: /dashed/.test(attrs.class || ''),
      });
      return;
    }
    if (element.tag === 'line' && attrs['data-edge-from']) {
      const p1 = [numberAttr(attrs, 'x1'), numberAttr(attrs, 'y1')];
      const p2 = [numberAttr(attrs, 'x2'), numberAttr(attrs, 'y2')];
      if (p1.some((n) => n === null) || p2.some((n) => n === null)) { dropped('edges-without-geometry'); return; }
      addEdge({ from: attrs['data-edge-from'], to: attrs['data-edge-to'], label: attrs['data-edge-label'] || '', points: [p1, p2] });
      return;
    }
    // Sequence wraps semantics on a <g>; geometry lives on the inner path.
    if (element.tag === 'g' && attrs['data-edge-from'] && !attrs['data-graph-role']) {
      const path = element.children.find((child) => child.tag === 'path');
      if (!path) return;
      const points = compositionPoints(path.attrs['data-composition-points']) || flattenPath(path.attrs.d);
      if (!points) { dropped('edges-without-geometry'); return; }
      addEdge({ from: attrs['data-edge-from'], to: attrs['data-edge-to'], label: attrs['data-edge-label'] || '', points });
    }
  });
  // Fishbone twigs: cause -> category membership edges carrying the twig line.
  if (profile.fishbone) {
    for (const [causeId, categoryId] of categoryOfCause) {
      const twig = nodeElementById.get(causeId)?.children.find((child) => child.attrs.class === 'rd-fish-twig');
      if (!twig) continue;
      const p1 = [numberAttr(twig.attrs, 'x1'), numberAttr(twig.attrs, 'y1')];
      const p2 = [numberAttr(twig.attrs, 'x2'), numberAttr(twig.attrs, 'y2')];
      if (p1.some((n) => n === null) || p2.some((n) => n === null)) continue;
      addEdge({ from: causeId, to: categoryId, label: '', points: [p1, p2], thin: true });
    }
  }

  // --- decorations consciously dropped (counted, never silent) ---
  dropped('lifecycle-markers', findElements(tree, (n) => Boolean(n.attrs?.['data-lifecycle-initial-marker'])).length);
  dropped('fishbone-tails', findElements(tree, (n) => n.attrs?.class === 'rd-fish-tail').length);
  dropped('sequence-lifelines', findElements(tree, (n) => n.tag === 'path' && /a-default/.test(n.attrs?.class || '') && !n.attrs?.['data-edge-from'] && /dasharray/.test(n.attrs?.style || '')).length);
  dropped('edge-label-masks', findElements(tree, (n) => n.tag === 'g' && n.attrs?.['data-detail'] === 'context').length);

  // --- normalize coordinates against the viewBox origin ---
  const dx = viewBox ? viewBox.minX : 0;
  const dy = viewBox ? viewBox.minY : 0;
  for (const container of containers) container.box = shiftBox(container.box, dx, dy);
  for (const node of nodes) node.box = shiftBox(node.box, dx, dy);
  for (const edge of edges) edge.points = shiftPoints(edge.points, dx, dy);

  // --- geometric container parenting: innermost containing frame wins ---
  const byArea = [...containers].sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height);
  for (const node of nodes) {
    if (node.containerId) continue;
    const cx = node.box.x + node.box.width / 2;
    const cy = node.box.y + node.box.height / 2;
    // A fishbone category doubles as its own group container; it must not
    // become a child of itself.
    const host = byArea.find((container) => container.id !== groupOf(node.id) && centerInside(container.box, [cx, cy]));
    if (host) node.containerId = host.id;
  }

  const geometry = {
    title: title || 'Diagram',
    viewBox: { width: viewBox ? viewBox.width : 1000, height: viewBox ? viewBox.height : 800 },
    containers,
    nodes,
    edges,
  };
  return { geometry, stats: { nodes: nodes.length, edges: edges.length, containers: containers.length, decorationsDropped: decorations } };
}
