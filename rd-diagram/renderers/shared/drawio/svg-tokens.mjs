// Token-level SVG parsing for the draw.io exporter.
//
// Generated artifacts embed exactly one semantic diagram SVG whose node and
// edge groups carry data-* attributes and absolute-coordinate geometry. A
// lightweight regex tokenizer (the same proven shape as the tag walker in
// scripts/check-render-output.mjs) is sufficient and keeps the exporter free
// of DOM dependencies. Rendered artifacts are well-formed by contract, so a
// forgiving tokenizer plus structural guards is the right robustness level.

const SVG_TAG_TOKEN = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<(\/?)([A-Za-z][\w:-]*)(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const HTML_ATTRIBUTE = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

function parseAttrs(tag) {
  const attrs = {};
  for (const match of tag.matchAll(HTML_ATTRIBUTE)) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4];
  }
  return attrs;
}

function isSelfClosing(tag) {
  return /\/\s*>$/.test(tag);
}

/**
 * Parse an SVG fragment into a lightweight tree of
 * `{ tag, attrs, children, text }` nodes. Text between tags is captured on
 * the enclosing element's `text` field when it is not pure whitespace.
 * Comments and CDATA are skipped. Malformed input never throws here; the
 * extractor's structural guards decide whether the result is usable.
 */
export function parseSvgTree(svgMarkup) {
  const root = { tag: '#fragment', attrs: {}, children: [], text: '' };
  const stack = [root];
  let cursor = 0;
  SVG_TAG_TOKEN.lastIndex = 0;
  for (let match = SVG_TAG_TOKEN.exec(svgMarkup); match; match = SVG_TAG_TOKEN.exec(svgMarkup)) {
    const between = svgMarkup.slice(cursor, match.index);
    if (between.trim()) {
      const parent = stack[stack.length - 1];
      parent.text = (parent.text + between).trim();
    }
    cursor = match.index + match[0].length;
    if (match[0].startsWith('<!')) continue; // comment or CDATA
    const [full, closingSlash, tagName] = match;
    if (closingSlash) {
      // Pop until the matching open tag; tolerate stray closers.
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tagName) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const element = { tag: tagName, attrs: parseAttrs(full), children: [], text: '' };
    stack[stack.length - 1].children.push(element);
    if (!isSelfClosing(full)) stack.push(element);
  }
  return root;
}

/** Depth-first walk; visit(element, parent) receives every element. */
export function walkTree(root, visit, parent = null) {
  for (const child of root.children) {
    visit(child, parent);
    walkTree(child, visit, child);
  }
}

export function findElements(root, predicate) {
  const found = [];
  walkTree(root, (element) => {
    if (predicate(element)) found.push(element);
  });
  return found;
}

export function numberAttr(attrs, name) {
  const value = Number.parseFloat(attrs?.[name]);
  return Number.isFinite(value) ? value : null;
}

/**
 * First direct-child <rect> with usable absolute geometry (x/y/width/height
 * all finite, width and height > 0). Renderers put the node box first; mask
 * duplicates share the same coordinates and are equivalent.
 */
export function firstRectBox(element) {
  for (const child of element.children) {
    if (child.tag !== 'rect') continue;
    const box = rectBox(child);
    if (box) return box;
  }
  return null;
}

export function rectBox(element) {
  const x = numberAttr(element.attrs, 'x');
  const y = numberAttr(element.attrs, 'y');
  const width = numberAttr(element.attrs, 'width');
  const height = numberAttr(element.attrs, 'height');
  if (x === null || y === null || width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}
