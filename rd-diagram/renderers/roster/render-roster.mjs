import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import { loadDiagramWithBrandMarks, writeDiagram, svgRootAttrs, svgAccessibleText, focusEdgeAttrs, animateAttr } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';

// Team roster renderer, two layouts:
//  - "org" (default): a classic top-down organization tree built from the
//    reporting edges; leaves are evenly spaced, parents center over children,
//    elbows connect levels. This is the review-ready management view.
//  - "cards": a card wall organized as one column per group, with a
//    reporting-line overlay. This is the staffing/detail view.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: roster, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'roster',
  defaultExample: 'project-team.roster.json',
});

const layout = roster.meta?.layout === 'cards' ? 'cards' : 'org';

const problems = [];
const groups = roster.groups;
const persons = roster.persons;
const reports = roster.reports || [];

function clampText(text, maxUnits) {
  const units = textUnits(String(text));
  if (units <= maxUnits) return String(text);
  return `${String(text).slice(0, maxUnits - 1)}…`;
}

// Structural validation shared by both layouts.
const groupIds = new Set(groups.map((group) => group.id));
const personIds = new Set(persons.map((person) => person.id));
for (const person of persons) {
  if (!groupIds.has(person.group)) {
    problems.push(`Person ${JSON.stringify(person.name)} references unknown group ${JSON.stringify(person.group)}.`);
    if (problems.length > 6) break;
  }
}
const managerOf = new Map();
for (const [index, report] of reports.entries()) {
  if (!personIds.has(report.from) || !personIds.has(report.to)) {
    problems.push(`Report #${index} references an unknown person.`);
  } else if (report.from === report.to) {
    problems.push(`Report #${index} is a self-report.`);
  } else {
    managerOf.set(report.from, report.to);
  }
}
// Cycle / depth check for the org tree.
if (layout === 'org') {
  for (const person of persons) {
    let cursor = person.id;
    const seen = new Set([cursor]);
    while (managerOf.has(cursor)) {
      cursor = managerOf.get(cursor);
      if (seen.has(cursor)) { problems.push(`Reporting edges form a cycle involving ${JSON.stringify(person.name)}.`); break; }
      seen.add(cursor);
      if (seen.size > persons.length) break;
    }
  }
}
if (problems.length) {
  throwDiagnosticProblems('Roster layout constraints violated', problems, {
    code: 'roster/layout',
    subject: { diagramType: 'roster' },
    diagnostics: problems.map((message) => ({
      code: 'roster/layout', severity: 'error', message,
      subject: { diagramType: 'roster' }, evidence: {},
      supportedFixes: ['fix group references, remove self-reports or reporting cycles'],
    })),
  });
}

const TONES = [
  ['--frontend-fill', '--frontend-stroke'],
  ['--backend-fill', '--backend-stroke'],
  ['--database-fill', '--database-stroke'],
  ['--cloud-fill', '--cloud-stroke'],
  ['--security-fill', '--security-stroke'],
  ['--messagebus-fill', '--messagebus-stroke'],
];
const groupTone = new Map(groups.map((group, index) => [group.id, TONES[index % TONES.length]]));
const groupLabelOf = new Map(groups.map((group) => [group.id, group.label]));

const CSS = `
    .rd-roster-person rect { fill: var(--bg); stroke: var(--lane-stroke); stroke-width: 1.4; }
    html[data-theme="light"] .rd-roster-person rect { fill: #ffffff; }
    .rd-roster-avatar { stroke: var(--lane-stroke); stroke-width: 1; }
    .rd-roster-avatar-text { fill: var(--text); font-weight: 700; text-anchor: middle; }
    .rd-roster-name { fill: var(--text); font-weight: 600; }
    .rd-roster-title { fill: var(--text-dim); }
    .rd-roster-skill rect { fill: var(--lane-fill); stroke: var(--lane-stroke); stroke-width: 0.7; }
    .rd-roster-skill text { fill: var(--text-dim); font-size: 9.5px; }
    .rd-roster-elbow { fill: none; stroke: var(--lane-stroke); stroke-width: 1.8; }
    .rd-roster-group-frame { fill: none; stroke: var(--lane-stroke); stroke-width: 1.2; stroke-dasharray: 3 5; opacity: 0.65; }
    .rd-roster-group-header { stroke-width: 1.6; }
    .rd-roster-group-title { fill: var(--text); font-weight: 700; font-size: 14.5px; text-anchor: middle; }
    .rd-roster-card-box { fill: var(--bg); stroke: var(--lane-stroke); stroke-width: 1.4; }
    .rd-roster-report { fill: none; stroke: var(--guide-accent); stroke-width: 1.8; stroke-dasharray: 6 4; opacity: 0.85; }
`;

let svgBody = '';
let viewBox = [1880, 860];

function personNode(person, x, y, w, h, nameFont, titleFont, step) {
  const [toneFill] = groupTone.get(person.group) || TONES[0];
  const avatar = [...String(person.name)][0] || '?';
  const skills = (person.skills || []).slice(0, 4);
  let chipX = x + 64;
  const chips = skills.map((skill) => {
    const cw = Math.round(10 + textUnits(skill) * 6.2);
    const chip = `<g class="rd-roster-skill" transform="translate(${Math.round(chipX)},0)"><rect x="0" y="${y + h - 17}" width="${cw}" height="14" rx="7" /><text x="5" y="${y + h - 6.5}">${esc(clampText(skill, 12))}</text></g>`;
    chipX += cw + 6;
    return chip;
  }).join('');
  const detailJson = (person.details && person.details.length)
    ? ` data-rd-detail="${esc(JSON.stringify(person.details))}"` : '';
  const groupLabel = groupLabelOf.get(person.group) || '';
  const outlineGroup = groupLabel ? ` data-node-outline-group="${esc(groupLabel)}"` : '';
  return `    <g class="rd-roster-person" data-node-id="${esc(person.id)}" data-node-label="${esc(person.name)} · ${esc(person.title)}"${outlineGroup}${detailJson}${animateAttr(roster.meta, 'node', step)}>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" />
      <circle class="rd-roster-avatar" fill="var(${toneFill})" cx="${x + 26}" cy="${y + h / 2}" r="17" />
      <text class="rd-roster-avatar-text" x="${x + 26}" y="${y + h / 2 + 6}" font-size="15">${esc(avatar)}</text>
      <text class="rd-roster-name" x="${x + 52}" y="${y + 24}" font-size="${nameFont}">${esc(clampText(person.name, 15))}</text>
      <text class="rd-roster-title" x="${x + 52}" y="${y + 42}" font-size="${titleFont}">${esc(clampText(person.title, 16))}</text>
      ${chips}
    </g>`;
}

let globalEdgeIndex = 0;

if (layout === 'org') {
  const NODE_W = 196;
  const NODE_H = 60;
  const LEAF_W = 214;
  const LEVEL_H = 138;

  const childrenOf = new Map();
  for (const [child] of managerOf) {
    const manager = managerOf.get(child);
    if (!childrenOf.has(manager)) childrenOf.set(manager, []);
    childrenOf.get(manager).push(child);
  }
  const byId = new Map(persons.map((person) => [person.id, person]));
  const roots = persons.filter((person) => !managerOf.has(person.id)).map((person) => person.id);

  const leafCounts = new Map();
  function leavesOf(id) {
    const children = childrenOf.get(id) || [];
    if (!children.length) return 1;
    const total = children.reduce((sum, child) => sum + leavesOf(child), 0);
    leafCounts.set(id, total);
    return total;
  }
  const totalLeaves = roots.reduce((sum, id) => sum + leavesOf(id), 0) || 1;

  const positions = new Map(); // id -> {x, y}
  let cursorX = 0;
  function place(id, level) {
    const children = childrenOf.get(id) || [];
    if (!children.length) {
      const x = cursorX + LEAF_W / 2;
      cursorX += LEAF_W;
      positions.set(id, { x, y: level });
      return x;
    }
    const centers = children.map((child) => place(child, level + 1));
    const x = (centers[0] + centers[centers.length - 1]) / 2;
    positions.set(id, { x, y: level });
    return x;
  }
  roots.forEach((id) => place(id, 0));

  const maxLevel = Math.max(...[...positions.values()].map((p) => p.y), 0);
  const contentW = Math.max(cursorX, 1);
  const VIEW_W2 = Math.max(1880, contentW + 80);
  const VIEW_H2 = Math.max(760, (maxLevel + 1) * LEVEL_H + 40);
  viewBox = [VIEW_W2, VIEW_H2];

  const nodes = [];
  const elbows = [];
  let nodeStep = 0;
  for (const [id, { x, y }] of positions) {
    const person = byId.get(id);
    const px = x - NODE_W / 2;
    const py = 30 + y * LEVEL_H;
    nodes.push(personNode(person, px, py, NODE_W, NODE_H, 13, 11, nodeStep++));
    for (const child of (childrenOf.get(id) || [])) {
      const cp = positions.get(child);
      const cx = cp.x;
      const cy = 30 + cp.y * LEVEL_H;
      elbows.push(
        `    <path ${focusEdgeAttrs(child, id, '汇报', globalEdgeIndex++, `report-${child}`)}${animateAttr(roster.meta, 'edge', globalEdgeIndex)} class="rd-roster-elbow" d="M ${x} ${py + NODE_H} L ${x} ${py + NODE_H + (LEVEL_H - NODE_H) / 2} L ${cx} ${py + NODE_H + (LEVEL_H - NODE_H) / 2} L ${cx} ${cy}" />`,
      );
    }
  }
  svgBody = elbows.join('\n') + '\n' + nodes.join('\n');
} else {
  const VIEW_W = 1880;
  const VIEW_H = 860;
  const COL_GAP = 30;
  const MARGIN_X = 24;
  const HEADER_H = 46;
  const CARD_H = 92;
  const CARD_GAP = 14;
  viewBox = [VIEW_W, VIEW_H];

  const byGroup = new Map(groups.map((group) => [group.id, []]));
  for (const person of persons) {
    if (byGroup.has(person.group)) byGroup.get(person.group).push(person);
  }
  const tallest = Math.max(...[...byGroup.values()].map((list) => list.length), 1);
  if (HEADER_H + tallest * (CARD_H + CARD_GAP) + 24 > VIEW_H) {
    throwDiagnosticProblems('Roster layout constraints violated', ['Group column exceeds the card-wall canvas.'], {
      code: 'roster/layout',
      subject: { diagramType: 'roster' },
      diagnostics: [{ code: 'roster/layout', severity: 'error', message: 'Group column exceeds the card-wall canvas.', subject: { diagramType: 'roster' }, evidence: {}, supportedFixes: ['balance persons across groups or switch layout to org'] }],
    });
  }
  const colCount = groups.length;
  const colW = Math.floor((VIEW_W - MARGIN_X * 2 - COL_GAP * (colCount - 1)) / colCount);
  const cardRects = new Map();
  const groupParts = [];
  const cardParts = [];
  groups.forEach((group, groupIndex) => {
    const x = MARGIN_X + groupIndex * (colW + COL_GAP);
    const [toneFill, toneStroke] = TONES[groupIndex % TONES.length];
    groupParts.push(
      `  <g class="rd-roster-group" data-node-id="group-${esc(group.id)}" data-node-label="${esc(group.label)}" data-node-outline-group="${esc(group.label)}">`,
      `    <rect class="rd-roster-group-frame" x="${x}" y="20" width="${colW}" height="${HEADER_H + byGroup.get(group.id).length * (CARD_H + CARD_GAP) + 8}" rx="12" />`,
      `    <rect class="rd-roster-group-header" fill="var(${toneFill})" stroke="var(${toneStroke})" x="${x}" y="20" width="${colW}" height="38" rx="9" />`,
      `    <text class="rd-roster-group-title" x="${x + colW / 2}" y="45">${esc(clampText(group.label, 18))}</text>`,
      '  </g>',
    );
    byGroup.get(group.id).forEach((person, personIndex) => {
      const y = 20 + HEADER_H + personIndex * (CARD_H + CARD_GAP);
      cardRects.set(person.id, { x, y, w: colW, h: CARD_H });
      cardParts.push(
        `  <g class="rd-roster-cardwrap">${personNode(person, x + 10, y, colW - 20, CARD_H, 13.5, 12, personIndex)}</g>`,
      );
    });
  });
  const reportParts = [];
  for (const report of reports) {
    const from = cardRects.get(report.from);
    const to = cardRects.get(report.to);
    if (!from || !to) continue;
    const fx = from.x + from.w - 6;
    const fy = from.y + from.h / 2;
    const tx = to.x + to.w - 6;
    const ty = to.y + to.h / 2;
    const laneX = Math.min(fx, tx) - 26;
    reportParts.push(
      `    <path class="rd-roster-report" d="M ${fx} ${fy} C ${laneX} ${fy}, ${laneX} ${ty}, ${tx} ${ty}" marker-end="url(#rd-roster-arrow)" />`,
    );
  }
  svgBody = [
    reportParts.join('\n'),
    groupParts.join('\n'),
    cardParts.join('\n'),
  ].join('\n');
}

const svg = [
  `    <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(roster.meta)} data-diagram-type="roster" data-reader-fit="authored-height" xmlns="http://www.w3.org/2000/svg">`,
  `      ${svgAccessibleText(roster.meta, 'title')}`,
  `      ${svgAccessibleText(roster.meta, 'description')}`,
  `  <style>${CSS}
  </style>`,
  `  <defs><marker id="rd-roster-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" fill="var(--guide-accent)" /></marker></defs>`,
  renderDefinitions(),
  svgBody,
  '    </svg>',
].join('\n');

writeDiagram({
  outPath,
  template,
  diagramType: 'roster',
  meta: roster.meta,
  svg,
  cards: [],
  source: roster,
});
