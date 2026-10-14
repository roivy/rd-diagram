// mxGraph (draw.io) XML emitter.
//
// Output contract: uncompressed <mxfile><diagram><mxGraphModel> XML, stable
// element order (containers, then nodes, then edges — each position-sorted
// upstream), stable generated ids, no timestamps. Byte-identical for
// identical input, so golden snapshots guard the emitter.

const PALETTES = Object.freeze({
  light: Object.freeze({
    frontend: ['#dae8fc', '#6c8ebf'], backend: ['#d5e8d4', '#82b366'],
    database: ['#ffe6cc', '#d79b00'], cloud: ['#e1d5e7', '#9673a6'],
    security: ['#fff2cc', '#d6b656'], messagebus: ['#f5f5f5', '#666666'],
    external: ['#f0f0f0', '#999999'], group: ['#f5f5f5', '#999999'],
    default: ['#dae8fc', '#6c8ebf'],
  }),
  dark: Object.freeze({
    frontend: ['#1a3a5c', '#6c8ebf'], backend: ['#1d3b2a', '#82b366'],
    database: ['#4a3320', '#d79b00'], cloud: ['#3b2a4a', '#9673a6'],
    security: ['#4a3d1a', '#d6b656'], messagebus: ['#2b2b2b', '#888888'],
    external: ['#242424', '#777777'], group: ['#222222', '#666666'],
    default: ['#1a3a5c', '#6c8ebf'],
  }),
});

// Semantic roles that repeat across diagrams (teams, 6M categories, mind-map
// branches) get stable colors by hashing the role name into the palette.
const HASH_ROLES = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];

function paletteFor(styleRole, theme) {
  const palette = PALETTES[theme] || PALETTES.light;
  if (palette[styleRole]) return palette[styleRole];
  let hash = 0;
  for (const character of String(styleRole)) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return palette[HASH_ROLES[hash % HASH_ROLES.length]];
}

function escapeXml(value) {
  // Newlines inside attribute values are normalized to spaces by XML
  // parsers; draw.io reads &#10; as a real line break.
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/\r\n?/g, '\n').replace(/\n/g, '&#10;');
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function vertexStyle(node, theme, isGroup) {
  const [fill, stroke] = paletteFor(node.styleRole, theme);
  const parts = ['rounded=1', 'whiteSpace=wrap', 'html=1', `fillColor=${fill}`, `strokeColor=${stroke}`];
  if (isGroup) {
    parts.push('rounded=0', 'dashed=1', 'verticalAlign=top', 'align=left', 'spacingLeft=6', 'fontStyle=1', 'fillColor=none');
  } else {
    parts.push('arcSize=12');
  }
  if (node.fontSize) parts.push(`fontSize=${node.fontSize}`);
  if (node.verified) parts.push('strokeWidth=2');
  return parts.join(';');
}

function containerStyle(container) {
  const parts = ['rounded=0', 'whiteSpace=wrap', 'html=1', 'dashed=1', 'fillColor=none', 'verticalAlign=top', 'align=left', 'spacingLeft=6', 'fontStyle=1'];
  if (container.kind === 'lane' || container.kind === 'stage' || container.kind === 'segment') {
    parts.push('swimlaneFillColor=none');
  }
  return parts.join(';');
}

function edgeStyle(edge) {
  const parts = ['edgeStyle=none', 'rounded=0', 'html=1'];
  if (edge.dashed) parts.push('dashed=1');
  if (edge.thin) parts.push('strokeWidth=1');
  return parts.join(';');
}

function nodeLabel(node) {
  return [node.label, node.sublabel].filter(Boolean).join('\n');
}

/**
 * Emit draw.io XML from a normalized geometry. Fishbone categories double as
 * group containers for their causes (container id group-of-<nodeId> resolves
 * to the category's own vertex cell). Child geometry is relative to parent,
 * as mxGraph requires.
 */
export function emitMxGraph(geometry, { theme = 'light', agent = 'rd-diagram' } = {}) {
  const nodeIdToCell = new Map();
  const cells = [];
  let sequence = 2; // 0 and 1 are mxGraph's reserved root cells

  const allocate = () => `c${sequence++}`;

  // Frame containers without an owning node become standalone group cells.
  const frameCellOf = new Map();
  for (const container of geometry.containers) {
    if (container.id.startsWith('group-of-')) continue;
    frameCellOf.set(container.id, allocate());
  }

  const cellOfContainer = (containerId) => {
    if (frameCellOf.has(containerId)) return frameCellOf.get(containerId);
    const owner = containerId.replace(/^group-of-/, '');
    return nodeIdToCell.get(owner) ?? null;
  };

  const originOf = (cellId) => {
    if (!cellId) return { x: 0, y: 0 };
    return origins.get(cellId) || { x: 0, y: 0 };
  };

  const origins = new Map();
  const parentOfNode = (node) => {
    if (!node.containerId) return '1';
    const cell = cellOfContainer(node.containerId);
    return cell || '1';
  };

  // Emit container frame cells first so children can resolve parents.
  for (const container of geometry.containers) {
    const cellId = frameCellOf.get(container.id);
    if (!cellId) continue;
    cells.push({
      id: cellId, parent: '1', vertex: true,
      value: container.label || container.kind,
      style: containerStyle(container),
      x: container.box.x, y: container.box.y, width: container.box.width, height: container.box.height,
    });
    origins.set(cellId, { x: container.box.x, y: container.box.y });
  }

  // Vertices. A fishbone category that owns causes renders as a group cell.
  const groupOwnerIds = new Set(
    geometry.nodes.map((node) => node.id).filter((id) =>
      geometry.containers.some((container) => container.id === `group-of-${id}`)));
  for (const node of geometry.nodes) {
    const cellId = allocate();
    nodeIdToCell.set(node.id, cellId);
    const parent = parentOfNode(node);
    const origin = originOf(parent === '1' ? null : parent);
    const isGroup = groupOwnerIds.has(node.id);
    cells.push({
      id: cellId, parent, vertex: true,
      value: nodeLabel(node),
      style: vertexStyle(node, theme, isGroup),
      x: node.box.x - origin.x, y: node.box.y - origin.y,
      width: node.box.width, height: node.box.height,
    });
    if (isGroup) origins.set(cellId, { x: node.box.x, y: node.box.y });
  }

  for (const edge of geometry.edges) {
    const source = nodeIdToCell.get(edge.from);
    const target = nodeIdToCell.get(edge.to);
    if (!source || !target) continue; // validated upstream; defensive only
    // Interior points carry the authored route. Two-point paths still pin a
    // midpoint waypoint: sequence messages rely on it to keep their
    // chronological order, and straight edges pass through it unchanged.
    const first = edge.points[0];
    const last = edge.points[edge.points.length - 1];
    const waypoints = edge.points.length > 2
      ? edge.points.slice(1, -1)
      : [[(first[0] + last[0]) / 2, (first[1] + last[1]) / 2]];
    cells.push({
      id: allocate(), parent: '1', edge: true,
      value: edge.label || '',
      style: edgeStyle(edge),
      source, target,
      waypoints,
    });
  }

  const lines = [];
  lines.push(`<mxfile host="${escapeXml(agent)}" modified="" agent="${escapeXml(agent)}" version="24.0.0">`);
  lines.push(`  <diagram id="rd-export-1" name="${escapeXml(geometry.title)}">`);
  lines.push('    <mxGraphModel dx="1000" dy="700" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="826" math="0" shadow="0">');
  lines.push('      <root>');
  lines.push('        <mxCell id="0" />');
  lines.push('        <mxCell id="1" parent="0" />');
  for (const cell of cells) {
    if (cell.vertex) {
      lines.push(`        <mxCell id="${cell.id}" value="${escapeXml(cell.value)}" style="${escapeXml(cell.style)}" vertex="1" parent="${cell.parent}">`);
      lines.push(`          <mxGeometry x="${round(cell.x)}" y="${round(cell.y)}" width="${round(cell.width)}" height="${round(cell.height)}" as="geometry" />`);
      lines.push('        </mxCell>');
    } else {
      lines.push(`        <mxCell id="${cell.id}" value="${escapeXml(cell.value)}" style="${escapeXml(cell.style)}" edge="1" parent="${cell.parent}" source="${cell.source}" target="${cell.target}">`);
      if (cell.waypoints.length) {
        lines.push('          <Array as="points">');
        for (const [x, y] of cell.waypoints) {
          lines.push(`            <mxPoint x="${round(x)}" y="${round(y)}" />`);
        }
        lines.push('          </Array>');
      }
      lines.push('          <mxGeometry relative="1" as="geometry" />');
      lines.push('        </mxCell>');
    }
  }
  lines.push('      </root>');
  lines.push('    </mxGraphModel>');
  lines.push('  </diagram>');
  lines.push('</mxfile>');
  return lines.join('\n') + '\n';
}
