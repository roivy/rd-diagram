// draw.io export facade: artifact HTML -> validated geometry -> mxGraph XML.
//
// Fail-closed: any model invariant violation rejects the export with the full
// problem list; a partial diagram is never emitted.

import { extractDiagramGeometry, DRAWIO_TYPES } from './profiles.mjs';
import { validateGeometry, normalizeGeometry } from './model.mjs';
import { emitMxGraph } from './mxgraph.mjs';

export { DRAWIO_TYPES };

/**
 * @param {string} html rendered artifact HTML (contains the diagram SVG)
 * @param {{ type: string, title?: string, theme?: 'light'|'dark' }} options
 * @returns {{ xml: string, stats: object }}
 * @throws {Error} when the type is unsupported, the SVG is missing, or the
 *   extracted geometry violates a model invariant.
 */
export function exportDrawio(html, { type, title, theme = 'light' } = {}) {
  if (!DRAWIO_TYPES.includes(type)) {
    throw new Error(`Unsupported diagram type for draw.io export: ${type}`);
  }
  const { geometry, stats } = extractDiagramGeometry(html, type, title);
  const normalized = normalizeGeometry(geometry);
  const report = validateGeometry(normalized);
  if (!report.ok) {
    throw new Error(`draw.io export rejected: geometry invariants violated (${report.problems.slice(0, 5).join('; ')}${report.problems.length > 5 ? '; …' : ''})`);
  }
  const xml = emitMxGraph(normalized, { theme });
  return { xml, stats };
}
