import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import { loadDiagramWithBrandMarks, writeDiagram, svgRootAttrs, svgAccessibleText, animateAttr } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';

// Fishbone (Ishikawa) renderer — classic textbook fish anatomy:
//   - a horizontal spine with a three-chevron tail on the left;
//   - a fish-head polygon (flat right edge, pointed toward the spine) carrying
//     the problem statement;
//   - big bones slanted toward the head with arrowheads piercing the spine;
//   - causes as short slanted twigs parallel to their bone;
//   - subcauses as small ticks on the twig;
//   - verified root causes highlighted with the accent tone.
// Layout is deterministic from the input alone.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: fishbone, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'fishbone',
  defaultExample: 'production-failure.fishbone.json',
});

const problems = [];

const VIEW_W = 1880;
const VIEW_H = 860;
const SPINE_Y = 430;
const TAIL_X = 190;          // leftmost chevron
const HEAD_X = 1440;         // fish-head flat right edge
const HEAD_W = 290;
const BONE_RISE = 320;       // vertical extent of a bone (steep, classic)
const BONE_SLANT = 160;      // horizontal offset foot -> outer end (steep bone)
const BONE_MARGIN = 0.18;    // innermost cause stops this far from the foot
const TWIG_LEN = 132;        // horizontal cause arrow length
const TWIG_GAP = 36;         // spacing between cause twigs along the bone

const CATEGORY_TONES = [
  ['--frontend-fill', '--frontend-stroke'],
  ['--backend-fill', '--backend-stroke'],
  ['--database-fill', '--database-stroke'],
  ['--cloud-fill', '--cloud-stroke'],
  ['--security-fill', '--security-stroke'],
  ['--messagebus-fill', '--messagebus-stroke'],
  ['--external-fill', '--external-stroke'],
];

function clampText(text, maxUnits) {
  const units = textUnits(String(text));
  if (units <= maxUnits) return String(text);
  return `${String(text).slice(0, maxUnits - 1)}…`;
}

function wrapProblem(text) {
  const lines = [];
  let rest = String(text);
  while (textUnits(rest) > 11 && lines.length < 5) {
    let cut = 11;
    while (cut > 4 && textUnits(rest.slice(0, cut)) > 11) cut -= 1;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) lines.push(rest);
  return lines.slice(0, 6);
}

function causeFont(text, isSub) {
  const units = Math.max(1, textUnits(text));
  const preferred = isSub ? 11 : 13.5;
  const fitted = Math.min(preferred, 200 / (units * 0.62));
  return Math.max(isSub ? 10 : 11.5, Math.floor(fitted * 10) / 10);
}

// Bone frame: foot (fx, SPINE_Y); outer end (fx - BONE_SLANT, SPINE_Y ∓ RISE).
// Direction unit vector from foot toward the outer end.
function boneFrame(footX, side) {
  const dx = -BONE_SLANT;
  const dy = -side * BONE_RISE;
  const len = Math.hypot(dx, dy);
  return { ux: dx / len, uy: dy / len, len };
}
function bonePoint(footX, side, distFromFoot) {
  const { ux, uy } = boneFrame(footX, side);
  return [footX + ux * distFromFoot, SPINE_Y + uy * distFromFoot];
}

const categories = fishbone.categories;
const usableLen = Math.hypot(BONE_SLANT, BONE_RISE);

const svgParts = [];
svgParts.push(renderDefinitions());

// --- Spine with three-chevron tail ---
svgParts.push(
  `  <g class="rd-fish-spine">`,
  `    <line x1="${TAIL_X + 54}" y1="${SPINE_Y}" x2="${HEAD_X + 18}" y2="${SPINE_Y}" marker-end="url(#rd-fish-spine-arrow)" />`,
  `    <path class="rd-fish-tail" d="M ${TAIL_X + 54} ${SPINE_Y} L ${TAIL_X + 14} ${SPINE_Y - 26} L ${TAIL_X + 30} ${SPINE_Y} L ${TAIL_X + 14} ${SPINE_Y + 26} Z" />`,
  `    <path class="rd-fish-tail" d="M ${TAIL_X + 96} ${SPINE_Y} L ${TAIL_X + 52} ${SPINE_Y - 34} L ${TAIL_X + 70} ${SPINE_Y} L ${TAIL_X + 52} ${SPINE_Y + 34} Z" />`,
  `    <path class="rd-fish-tail" d="M ${TAIL_X + 146} ${SPINE_Y} L ${TAIL_X + 94} ${SPINE_Y - 44} L ${TAIL_X + 116} ${SPINE_Y} L ${TAIL_X + 94} ${SPINE_Y + 44} Z" />`,
  `  </g>`,
);

// --- Fish head: clean effect box; the spine pierces into it ---
const headLines = wrapProblem(fishbone.problem.text);
const headTextH = headLines.length * 27 + (fishbone.problem.sublabel ? 22 : 0);
const headH = Math.min(240, headTextH + 48);
const headTop = SPINE_Y - headH / 2;
svgParts.push(
  `  <g class="rd-fish-head" data-node-id="problem" data-node-label="${esc(fishbone.problem.text)}"${animateAttr(fishbone.meta, 'node', 0)}>`,
  `    <rect class="rd-fish-head-shape" x="${HEAD_X}" y="${headTop}" width="${HEAD_W}" height="${headH}" rx="12" />`,
);
headLines.forEach((line, index) => {
  svgParts.push(
    `    <text class="rd-fish-head-text" x="${HEAD_X + HEAD_W / 2}" y="${headTop + 38 + index * 27}">${esc(line)}</text>`,
  );
});
if (fishbone.problem.sublabel) {
  svgParts.push(
    `    <text class="rd-fish-head-sub" x="${HEAD_X + HEAD_W / 2}" y="${headTop + 38 + headLines.length * 27 + 4}">${esc(clampText(fishbone.problem.sublabel, 22))}</text>`,
  );
}
svgParts.push('  </g>');

// --- Bones + causes (classic Ishikawa geometry) ---
// Big bones slant steeply toward the head; each cause is a HORIZONTAL arrow
// striking the bone; subcauses are small horizontal ticks striking the cause.
categories.forEach((category, index) => {
  const side = index % 2 === 0 ? 1 : -1; // top / bottom
  const lane = Math.floor(index / 2);
  const lanes = Math.ceil(categories.length / 2);
  const footX = 470 + ((HEAD_X - 290) - 470) * (lanes === 1 ? 0.5 : (lane + 0.5) / lanes);
  const [toneFill, toneStroke] = CATEGORY_TONES[index % CATEGORY_TONES.length];
  const outerX = footX - BONE_SLANT;
  const outerY = SPINE_Y - side * BONE_RISE;

  svgParts.push(
    `  <g class="rd-fish-category" data-node-id="${esc(category.id)}" data-node-label="${esc(category.label)}" data-node-outline-group="${esc(category.label)}"${animateAttr(fishbone.meta, 'node', index + 1)}>`,
    `    <line data-edge-from="${esc(category.id)}" data-edge-to="problem" data-edge-label="${esc(category.label)}" data-edge-key="bone-${index}"${animateAttr(fishbone.meta, 'edge', index)} class="rd-fish-bone" x1="${outerX}" y1="${outerY}" x2="${footX}" y2="${SPINE_Y}" marker-end="url(#rd-fish-bone-arrow)" />`,
    `    <rect class="rd-fish-category-box" fill="var(${toneFill})" stroke="var(${toneStroke})" x="${outerX - 28 - 95}" y="${outerY - side * 30 - 21}" width="190" height="42" rx="9" />`,
    `    <text class="rd-fish-category-text" x="${outerX - 28}" y="${outerY - side * 30 + 5}">${esc(clampText(category.label, 11))}</text>`,
  );

  const causes = category.causes;
  const laneCount = lanes;
  causes.forEach((cause, causeIndex) => {
    const t0 = 0.16;
    const t1 = 0.88;
    // Interleave rows across the side's bones so cause rows align fish-wide.
    const globalRow = causeIndex * laneCount + lane;
    const maxRows = Math.max(1, (Math.max(...categories.filter((_, i) => i % 2 === (index % 2)).map((c) => c.causes.length)) - 1) * laneCount + laneCount - 1);
    const frac = t0 + (t1 - t0) * (maxRows === 0 ? 0.5 : globalRow / maxRows);
    const bx = outerX + BONE_SLANT * frac;
    const by = outerY + side * BONE_RISE * frac;
    const dir = causeIndex % 2 === 0 ? -1 : 1; // alternate sides of the bone
    const arrowLen = 156;
    const tipX = bx;
    const tailX = bx + dir * arrowLen;
    const font = causeFont(cause.text, false);
    const verifiedCls = cause.verified ? ' rd-fish-verified' : '';
    const titleAttr = cause.evidence ? ` title="${esc(cause.evidence)}"` : '';
    const labelY = by - 9 - (side > 0 ? 0 : 0);
    svgParts.push(
      `    <g class="rd-fish-cause${verifiedCls}" data-node-id="${esc(category.id)}-cause-${causeIndex}" data-node-label="${esc(cause.text)}" data-node-outline-group="${esc(category.label)}"${titleAttr}${animateAttr(fishbone.meta, 'node', causeIndex + 2)}>`,
      `      <line class="rd-fish-twig"${animateAttr(fishbone.meta, 'edge', causeIndex + 1)} x1="${tailX}" y1="${by}" x2="${tipX}" y2="${by}" marker-end="url(#rd-fish-cause-arrow)" />`,
      `      <text class="rd-fish-cause-text${verifiedCls ? ' rd-fish-cause-text-verified' : ''}" x="${(tailX + tipX) / 2}" y="${labelY}" text-anchor="middle" font-size="${font}">${esc(category.label + ' · ' + clampText(cause.text, 13))}</text>`,
    ...(cause.risk === 'high' ? [`      <g class="rd-fish-risk-high" transform="translate(${(tailX + tipX) / 2 + 10}, ${labelY - 26})"><rect x="-16" y="-9" width="32" height="18" rx="4" /><text x="0" y="4.5" text-anchor="middle">高危</text></g>`] : []),
    ...(cause.risk === 'medium' ? [`      <circle class="rd-fish-risk-medium" cx="${(tailX + tipX) / 2 - 8}" cy="${labelY - 26}" r="7" />`] : []),
    );
    if (cause.verified) {
      svgParts.push(`      <circle class="rd-fish-verified-dot" cx="${(tailX + tipX) / 2}" cy="${labelY - 12}" r="4.5" />`);
    }
    (cause.subcauses || []).forEach((sub, subIndex) => {
      const subFrac = 0.3 + subIndex * 0.28;
      const sx = tailX + (tipX - tailX) * subFrac;
      const sy = by;
      const subDir = dir; // strike the cause line from the same open side
      const subTail = sx - subDir * 62;
      const subY = by - side * (16 + subIndex * 15);
      svgParts.push(
        `      <path class="rd-fish-subtwig" d="M ${subTail.toFixed(1)} ${subY} L ${sx.toFixed(1)} ${subY} M ${sx.toFixed(1)} ${subY} L ${sx.toFixed(1)} ${sy}" />`,
        `      <text class="rd-fish-subcause-text" x="${((subTail + sx) / 2).toFixed(1)}" y="${subY - (side > 0 ? 4 : -9)}" text-anchor="middle">${esc(clampText(sub, 12))}</text>`,
      );
    });
    svgParts.push('    </g>');
  });
  svgParts.push('  </g>');
});

// --- Layout guards ---
for (const [index, category] of categories.entries()) {
  const side = index % 2 === 0 ? 1 : -1;
  const lane = Math.floor(index / 2);
  const lanes = Math.ceil(categories.length / 2);
  const footX = 470 + ((HEAD_X - 290) - 470) * (lanes === 1 ? 0.5 : (lane + 0.5) / lanes);
  const outerX = footX - BONE_SLANT;
  const outerY = SPINE_Y - side * BONE_RISE;
  if (outerX - 125 < 8 || outerY - 55 < 8 || outerY + 55 > VIEW_H - 8) {
    problems.push(`Category ${JSON.stringify(category.label)} falls outside the canvas.`);
  }
  const causes = category.causes;
  const causeGapPx = causes.length > 1 ? BONE_RISE * (0.88 - 0.16) / Math.max(1, (causes.length - 1) * Math.max(1, lanes)) : 999;
  if (causeGapPx < 30) {
    problems.push(`Category ${JSON.stringify(category.label)} carries too many causes for readable spacing.`);
  }
}
if (problems.length) {
  throwDiagnosticProblems('Fishbone layout constraints violated', problems, {
    code: 'fishbone/layout',
    subject: { diagramType: 'fishbone' },
    diagnostics: problems.map((message) => ({
      code: 'fishbone/layout', severity: 'error', message,
      subject: { diagramType: 'fishbone' }, evidence: {},
      supportedFixes: ['shorten labels or reduce categories/causes'],
    })),
  });
}

const svg = [
  `    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" ${svgRootAttrs(fishbone.meta)} data-diagram-type="fishbone" data-reader-fit="authored-height" xmlns="http://www.w3.org/2000/svg">`,
  `      ${svgAccessibleText(fishbone.meta, 'title')}`,
  `      ${svgAccessibleText(fishbone.meta, 'description')}`,
  `  <style>
    .rd-fish-spine line { stroke: var(--lane-stroke); stroke-width: 6; }
    .rd-fish-tail { fill: var(--lane-stroke); opacity: 0.92; }
    .rd-fish-head-shape { fill: var(--frontend-fill); stroke: var(--frontend-stroke); stroke-width: 3; }
    .rd-fish-eye { fill: var(--text); }
    .rd-fish-head-text { fill: var(--text); font-weight: 700; font-size: 17px; text-anchor: middle; }
    .rd-fish-head-sub { fill: var(--text-dim); font-size: 11.5px; text-anchor: middle; }
    .rd-fish-bone { stroke: var(--lane-stroke); stroke-width: 3; }
    .rd-fish-category-box { stroke-width: 2; }
    .rd-fish-category-text { fill: var(--text); font-weight: 700; font-size: 16px; text-anchor: middle; }
    .rd-fish-twig { stroke: var(--lane-stroke); stroke-width: 1.7; }
    .rd-fish-cause-text { fill: var(--text); font-size: 13px; }
    .rd-fish-risk-high rect { fill: #b91c1c; stroke: none; }
    .rd-fish-risk-high text { fill: #fff; font-size: 10px; font-weight: 700; }
    .rd-fish-risk-high ~ .rd-fish-twig, g.rd-fish-cause:has(.rd-fish-risk-high) .rd-fish-twig { stroke: #ef4444; stroke-width: 3; }
    .rd-fish-risk-medium { fill: #d97706; }
    .rd-fish-cause-text-verified { font-weight: 700; }
    .rd-fish-verified-dot { fill: var(--guide-accent); }
    .rd-fish-verified .rd-fish-twig { stroke: var(--guide-accent); stroke-width: 2.6; }
    .rd-fish-subtwig { stroke: var(--lane-stroke); stroke-width: 1.2; opacity: 0.85; }
    .rd-fish-subcause-text { fill: var(--text-dim); font-size: 10.5px; }
  </style>`,
  `  <defs><marker id="rd-fish-spine-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="var(--lane-stroke)" /></marker><marker id="rd-fish-cause-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="var(--lane-stroke)" /></marker><marker id="rd-fish-bone-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="var(--lane-stroke)" /></marker></defs>`,
  svgParts.join('\n'),
  '    </svg>',
].join('\n');

writeDiagram({
  outPath,
  template,
  diagramType: 'fishbone',
  meta: fishbone.meta,
  svg,
  cards: [],
  source: fishbone,
});
