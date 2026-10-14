// Normalized geometry model shared by every diagram type's extractor and the
// mxGraph emitter. The exporter is fail-closed: an invariant violation means
// the whole export is rejected — a half-converted diagram is never written.

export function validateGeometry(geometry) {
  const problems = [];
  const { title, viewBox, containers, nodes, edges } = geometry;
  if (!Array.isArray(nodes) || nodes.length === 0) problems.push('no nodes extracted');
  if (!Array.isArray(edges)) problems.push('edges must be an array');
  if (!Array.isArray(containers)) problems.push('containers must be an array');
  if (!viewBox || !(viewBox.width > 0) || !(viewBox.height > 0)) {
    problems.push('viewBox missing or degenerate');
  }
  if (typeof title !== 'string' || !title.trim()) problems.push('title missing');

  const seenIds = new Set();
  const claimId = (id, kind) => {
    if (!id || typeof id !== 'string' || !id.trim()) {
      problems.push(`${kind} with empty id`);
      return;
    }
    if (seenIds.has(id)) problems.push(`duplicate id: ${id}`);
    seenIds.add(id);
  };
  const checkBox = (box, kind, id) => {
    if (!box) {
      problems.push(`${kind} ${id} has no geometry`);
      return;
    }
    for (const key of ['x', 'y', 'width', 'height']) {
      if (!Number.isFinite(box[key])) problems.push(`${kind} ${id} box.${key} is not finite`);
    }
    if (box.width <= 0 || box.height <= 0) problems.push(`${kind} ${id} box is degenerate`);
  };

  (containers || []).forEach((container) => {
    claimId(container.id, 'container');
    if (!['lane', 'region', 'security-group', 'stage', 'segment', 'group'].includes(container.kind)) {
      problems.push(`container ${container.id} has unknown kind ${container.kind}`);
    }
    checkBox(container.box, 'container', container.id);
  });
  const nodeIds = new Set();
  (nodes || []).forEach((node) => {
    claimId(node.id, 'node');
    nodeIds.add(node.id);
    checkBox(node.box, 'node', node.id);
    if (node.containerId != null && !(containers || []).some((c) => c.id === node.containerId)) {
      problems.push(`node ${node.id} references unknown container ${node.containerId}`);
    }
  });
  (edges || []).forEach((edge, index) => {
    if (!nodeIds.has(edge.from)) problems.push(`edge #${index} from unknown node ${edge.from}`);
    if (!nodeIds.has(edge.to)) problems.push(`edge #${index} to unknown node ${edge.to}`);
    if (!Array.isArray(edge.points) || edge.points.length < 2) {
      problems.push(`edge #${index} (${edge.from} -> ${edge.to}) needs at least two points`);
    } else {
      edge.points.forEach((point, pointIndex) => {
        if (!Array.isArray(point) || point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
          problems.push(`edge #${index} point ${pointIndex} is malformed`);
        }
      });
    }
  });
  return { ok: problems.length === 0, problems };
}

/** Deterministic ordering applied before emission and validation reporting. */
export function normalizeGeometry(geometry) {
  const byPosition = (a, b) =>
    (a.box.y - b.box.y) || (a.box.x - b.box.x) || String(a.id).localeCompare(String(b.id));
  const containers = [...geometry.containers].sort(byPosition);
  const containerIds = new Set(containers.map((container) => container.id));
  const nodes = [...geometry.nodes]
    .map((node) => ({ ...node, containerId: containerIds.has(node.containerId) ? node.containerId : null }))
    .sort(byPosition);
  const idOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const edges = [...geometry.edges].sort((a, b) =>
    (idOrder.get(a.from) - idOrder.get(b.from)) || (idOrder.get(a.to) - idOrder.get(b.to))
      || String(a.id ?? '').localeCompare(String(b.id ?? '')));
  return { ...geometry, containers, nodes, edges };
}
