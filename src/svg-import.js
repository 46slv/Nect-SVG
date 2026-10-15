import {
  document,
  layer,
  node,
  parsePath,
  validate,
  parseStrokeDash,
  validateStrokeStyle,
} from './core.js';
import { createLinearGradientFill } from './linear-gradient.js';
import { createRadialGradientFill } from './radial-gradient.js';

// Bound work before geometry construction; referenced and unused definitions are
// validated alike. These limits are deliberately lower than the project format.
export const SVG_IMPORT_LIMITS = Object.freeze({
  bytes: 10000000,
  elements: 4096,
  depth: 64,
  gradients: 256,
  shapes: 2048,
  pathCharacters: 1000000,
  contours: 10000,
  points: 100000,
});
const gradientId = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const localGradient = /^url\(#([A-Za-z_][A-Za-z0-9_.-]{0,127})\)$/;
const solidColor = (raw) => {
  if (raw === 'none') return null;
  if (/^#[0-9a-f]{3}$/i.test(raw)) raw = '#' + [...raw.slice(1)].map((x) => x + x).join('');
  const named = {
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    blue: '#0000ff',
    green: '#008000',
  };
  raw = Object.hasOwn(named, raw) ? named[raw] : raw;
  if (!/^#[0-9a-f]{6}$/i.test(raw))
    throw Error(
      'Import supports solid hex/basic named colors and supported local gradient fills only',
    );
  return raw;
};
/** Conservative SVG adapter. Requires a caller-supplied DOM parser; the core stays DOM-free. */
export function importSVG(text, Parser = globalThis.DOMParser) {
  if (typeof text !== 'string') throw Error('Invalid SVG document');
  if (
    text.length > SVG_IMPORT_LIMITS.bytes ||
    new TextEncoder().encode(text).length > SVG_IMPORT_LIMITS.bytes
  )
    throw Error('SVG exceeds 10 MB');
  if (/<!DOCTYPE|<!ENTITY|<\?(?!xml(?:\s|\?>))/i.test(text))
    throw Error('SVG declarations and external styles are unsupported');
  const xml = new Parser().parseFromString(text, 'image/svg+xml'),
    root = xml.documentElement;
  if (!root || root.localName !== 'svg' || xml.querySelector('parsererror'))
    throw Error('Invalid SVG document');
  if (root.namespaceURI !== null && root.namespaceURI !== 'http://www.w3.org/2000/svg')
    throw Error('Unsupported SVG namespace');
  const allowed = new Set([
    'svg',
    'g',
    'path',
    'circle',
    'ellipse',
    'rect',
    'title',
    'desc',
    'defs',
    'linearGradient',
    'radialGradient',
    'stop',
  ]);
  const elements = [root, ...root.querySelectorAll('*')],
    ids = new Set(),
    gradients = new Map();
  if (elements.length > SVG_IMPORT_LIMITS.elements) throw Error('SVG exceeds element budget');
  let shapeCount = 0,
    pathCharacters = 0;
  for (const el of elements) {
    if (el.namespaceURI !== root.namespaceURI || el.prefix)
      throw Error('Unsupported SVG namespace');
    let depth = 0;
    for (let ancestor = el; ancestor; ancestor = ancestor.parentElement)
      if (++depth > SVG_IMPORT_LIMITS.depth) throw Error('SVG exceeds nesting depth budget');
    const tag = el.localName,
      parent = el.parentElement?.localName;
    if (el !== root) {
      const validParent =
        tag === 'defs'
          ? el.parentElement === root
          : ['linearGradient', 'radialGradient'].includes(tag)
            ? parent === 'defs'
            : tag === 'stop'
              ? ['linearGradient', 'radialGradient'].includes(parent)
              : ['title', 'desc'].includes(tag)
                ? ['svg', 'g', 'path', 'circle', 'ellipse', 'rect'].includes(parent)
                : ['svg', 'g'].includes(parent);
      if (!validParent) throw Error(`Unsupported SVG structure: ${tag}`);
    }
    for (const child of el.childNodes)
      if (
        (child.nodeType === 3 || child.nodeType === 4) &&
        child.textContent.trim() &&
        !['title', 'desc'].includes(tag)
      )
        throw Error('Unsupported SVG text content');
    if (el.hasAttribute('id')) {
      const id = el.getAttribute('id');
      if (!id || ids.has(id)) throw Error('Invalid or duplicate SVG ID');
      ids.add(id);
    }
    if (
      ['path', 'circle', 'ellipse', 'rect'].includes(tag) &&
      ++shapeCount > SVG_IMPORT_LIMITS.shapes
    )
      throw Error('SVG exceeds shape budget');
    pathCharacters += el.getAttribute('d')?.length || 0;
    if (pathCharacters > SVG_IMPORT_LIMITS.pathCharacters)
      throw Error('SVG exceeds path data budget');
    if (!allowed.has(el.localName)) throw Error(`Unsupported SVG element: ${el.localName}`);
    if (el !== root && el.localName === 'svg')
      throw Error('Nested SVG viewports are not supported');
    const common = [
      'id',
      'fill',
      'fill-opacity',
      'fill-rule',
      'stroke',
      'stroke-opacity',
      'stroke-width',
      'stroke-linecap',
      'stroke-linejoin',
      'stroke-miterlimit',
      'stroke-dasharray',
      'stroke-dashoffset',
    ];
    const attrs = {
      svg: ['xmlns', 'width', 'height', 'viewBox'],
      g: ['data-layer'],
      path: ['d', 'data-layer'],
      circle: ['cx', 'cy', 'r'],
      ellipse: ['cx', 'cy', 'rx', 'ry'],
      rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
      title: [],
      desc: [],
      defs: [],
      linearGradient: [
        'id',
        'gradientUnits',
        'x1',
        'y1',
        'x2',
        'y2',
        'spreadMethod',
        'color-interpolation',
      ],
      radialGradient: [
        'id',
        'gradientUnits',
        'cx',
        'cy',
        'r',
        'fx',
        'fy',
        'fr',
        'spreadMethod',
        'color-interpolation',
      ],
      stop: ['offset', 'stop-color', 'stop-opacity'],
    };
    const permitted = ['defs', 'linearGradient', 'radialGradient', 'stop'].includes(tag)
      ? attrs[tag]
      : [...common, ...attrs[tag]];
    for (const attr of el.attributes)
      if (!permitted.includes(attr.name)) throw Error(`Unsupported SVG attribute: ${attr.name}`);
    for (const key of ['fill-opacity', 'stroke-opacity', 'stop-opacity'])
      if (el.hasAttribute(key)) {
        const raw = el.getAttribute(key);
        if (!/^(?:\d*\.)?\d+(?:e[+-]?\d+)?$/i.test(raw) || Number(raw) < 0 || Number(raw) > 1)
          throw Error(`SVG ${key} must be a number from 0 to 1`);
      }
    if (el.hasAttribute('stroke-dasharray') && !el.getAttribute('stroke-dasharray').trim())
      throw Error('Invalid empty stroke-dasharray');
    validateStrokeStyle({
      ...(el.hasAttribute('stroke-linecap')
        ? { strokeCap: el.getAttribute('stroke-linecap') }
        : {}),
      ...(el.hasAttribute('stroke-linejoin')
        ? { strokeJoin: el.getAttribute('stroke-linejoin') }
        : {}),
      ...(el.hasAttribute('stroke-dasharray')
        ? { strokeDash: parseStrokeDash(el.getAttribute('stroke-dasharray')) }
        : {}),
    });
    for (const [key, min, max] of [
      ['stroke-miterlimit', 1, 10000],
      ['stroke-dashoffset', -100000, 100000],
    ])
      if (el.hasAttribute(key)) {
        const raw = el.getAttribute(key);
        if (
          !/^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?(?:px)?$/i.test(raw) ||
          (key === 'stroke-miterlimit' && /px$/i.test(raw))
        )
          throw Error(`Unsupported ${key} units`);
        const value = Number(raw.replace(/px$/i, ''));
        if (!Number.isFinite(value) || value < min || value > max) throw Error(`Invalid ${key}`);
      }
    if (el.hasAttribute('fill-rule') && el.getAttribute('fill-rule') !== 'nonzero')
      throw Error('Even-odd SVG import is not supported yet; use nonzero contours');
  }
  const number = (el, key, fallback) => {
    const raw = el.getAttribute(key);
    if (raw === null) return fallback;
    if (!/^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?(?:px)?$/i.test(raw))
      throw Error(`Unsupported ${key} units`);
    const value = Number(raw.replace(/px$/i, ''));
    if (!Number.isFinite(value)) throw Error(`Invalid ${key}`);
    return value;
  };
  // Collect definitions first so forward references work, without fetching URLs or
  // asking a browser/Paper importer to interpret untrusted paint-server markup.
  for (const el of elements.filter((el) =>
    ['linearGradient', 'radialGradient'].includes(el.localName),
  )) {
    if (gradients.size >= SVG_IMPORT_LIMITS.gradients) throw Error('SVG exceeds gradient budget');
    const id = el.getAttribute('id');
    if (
      !gradientId.test(id || '') ||
      id.trim() !== id ||
      el.getAttribute('gradientUnits') !== 'userSpaceOnUse' ||
      el.getAttribute('spreadMethod') !== 'pad' ||
      el.getAttribute('color-interpolation') !== 'sRGB'
    )
      throw Error('Unsupported gradient: require a local ID, userSpaceOnUse, pad and sRGB');
    const stops = [...el.children];
    if (
      stops.length !== 2 ||
      stops.some(
        (stop, i) => stop.localName !== 'stop' || stop.getAttribute('offset') !== String(i),
      )
    )
      throw Error('Gradient requires exactly two stops at 0 and 1');
    const colors = stops.map((stop) => {
      const hex = solidColor(stop.getAttribute('stop-color') || '');
      if (!hex) throw Error('Gradient stop requires a solid color');
      return { hex, alpha: number(stop, 'stop-opacity', 1) };
    });
    const endpoint = (key) => {
      const raw = el.getAttribute(key);
      // No percentages, units, missing coordinates or inherited defaults.
      if (raw === null || !/^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?$/i.test(raw))
        throw Error('Gradient requires explicit finite coordinates');
      return number(el, key);
    };
    let fill;
    if (el.localName === 'radialGradient') {
      const center = [endpoint('cx'), endpoint('cy')],
        radius = endpoint('r');
      // Our renderer always writes the concentric focal values explicitly.
      // Reject omitted defaults, offset foci and expanding focal circles.
      if (endpoint('fx') !== center[0] || endpoint('fy') !== center[1] || endpoint('fr') !== 0)
        throw Error('Radial gradient requires concentric fx/cx, fy/cy and fr=0');
      fill = createRadialGradientFill({
        center,
        radius,
        startColor: colors[0],
        endColor: colors[1],
      });
    } else {
      fill = createLinearGradientFill({
        start: [endpoint('x1'), endpoint('y1')],
        end: [endpoint('x2'), endpoint('y2')],
        startColor: colors[0],
        endColor: colors[1],
      });
    }
    gradients.set(id, fill);
  }
  const paint = (raw, allowGradient) => {
    const reference = localGradient.exec(raw);
    if (reference && reference[0] === raw && allowGradient) {
      const fill = gradients.get(reference[1]);
      if (!fill) throw Error('Missing local gradient definition');
      return fill;
    }
    return solidColor(raw);
  };
  // Validate even unused inherited paint attributes, not just visible leaves.
  for (const el of elements)
    for (const key of ['fill', 'stroke'])
      if (el.hasAttribute(key)) paint(el.getAttribute(key), key === 'fill');
  const result = document();
  result.name = root.querySelector('title')?.textContent || 'Imported SVG';
  result.layers = [];
  const bundles = [];
  let viewBox = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    viewBox &&
    (viewBox.length !== 4 ||
      !viewBox.every(Number.isFinite) ||
      viewBox[0] !== 0 ||
      viewBox[1] !== 0)
  )
    throw Error('Only zero-origin SVG viewBox is supported');
  result.width = viewBox?.[2] ?? number(root, 'width', 960);
  result.height = viewBox?.[3] ?? number(root, 'height', 540);
  let importedIndex = 0,
    contours = 0,
    points = 0;
  for (const el of root.querySelectorAll('path,circle,ellipse,rect')) {
    importedIndex++;
    const inherited = (key, fallback) => {
      let ancestor = el;
      while (ancestor) {
        if (ancestor.hasAttribute(key)) return ancestor.getAttribute(key);
        ancestor = ancestor.parentElement;
      }
      return fallback;
    };
    const fill = paint(inherited('fill', '#000000'), true),
      stroke = paint(inherited('stroke', 'none'), false),
      alpha = Number(inherited('fill-opacity', '1')),
      strokeAlpha = Number(inherited('stroke-opacity', '1'));
    const widthRaw = inherited('stroke-width', '1');
    if (!/^(?:\d*\.)?\d+(?:e[+-]?\d+)?(?:px)?$/i.test(widthRaw))
      throw Error('Unsupported stroke-width units');
    const width = Number(widthRaw.replace(/px$/i, ''));
    if (!Number.isFinite(width) || width < 0 || width > 100000) throw Error('Invalid stroke width');
    let n;
    if (el.localName === 'path') {
      n = node('Imported Path');
      n.rawPath = el.getAttribute('d') || '';
      const parsed = parsePath(n.rawPath, n.id);
      contours += parsed.contours.length;
      points += parsed.contours.reduce((sum, c) => sum + c.points.length, 0);
    } else if (el.localName === 'circle') {
      n = node('Circle');
      n.params.center.value = [number(el, 'cx', 0), number(el, 'cy', 0)];
      n.params.radius.value = number(el, 'r', 0);
      if (n.params.radius.value < 0) throw Error('Negative circle radius');
    } else if (el.localName === 'ellipse') {
      n = node('Ellipse');
      n.params.center.value = [number(el, 'cx', 0), number(el, 'cy', 0)];
      n.params.size.value = [number(el, 'rx', 0) * 2, number(el, 'ry', 0) * 2];
      if (n.params.size.value.some((v) => v < 0)) throw Error('Negative ellipse radius');
    } else {
      if (number(el, 'rx', 0) || number(el, 'ry', 0))
        throw Error('Rounded rectangles are not supported for import yet');
      n = node('Rectangle');
      let w = number(el, 'width', 0),
        h = number(el, 'height', 0);
      if (w < 0 || h < 0) throw Error('Negative rectangle size');
      n.params.size.value = [w, h];
      n.params.center.value = [number(el, 'x', 0) + w / 2, number(el, 'y', 0) + h / 2];
    }
    // Supported primitives each have one contour and four vertices, including
    // their degenerate zero-size form. Count them in the same aggregate budget.
    if (el.localName !== 'path') {
      contours++;
      points += 4;
    }
    if (contours > SVG_IMPORT_LIMITS.contours || points > SVG_IMPORT_LIMITS.points)
      throw Error('SVG exceeds geometry budget');
    const l = layer(
        el.getAttribute('data-layer') || el.getAttribute('id') || `Imported ${importedIndex}`,
      ),
      remap = node('Path Remap', 350, 40),
      out = node('Output', 1250, 40);
    remap.params.path.source = n.id;
    l.nodes = [n, remap];
    let source = remap.id;
    for (const [type, hex, opacity] of [
      ['Fill', fill, alpha],
      ['Stroke', stroke, strokeAlpha],
    ]) {
      if (!hex) continue;
      const isGradient =
        type === 'Fill' && ['linear-gradient', 'radial-gradient'].includes(hex.kind);
      const paint = node(
        isGradient
          ? hex.kind === 'radial-gradient'
            ? 'Radial Gradient Fill'
            : 'Linear Gradient Fill'
          : type,
        type === 'Fill' ? 650 : 950,
        40,
      );
      paint.params.path.source = source;
      if (isGradient) {
        if (hex.kind === 'radial-gradient') {
          paint.params.center.value = [...hex.center];
          paint.params.radius.value = hex.radius;
        } else {
          paint.params.start.value = [...hex.start];
          paint.params.end.value = [...hex.end];
        }
        paint.params.startColor.value = {
          ...hex.startColor,
          alpha: hex.startColor.alpha * opacity,
        };
        paint.params.endColor.value = { ...hex.endColor, alpha: hex.endColor.alpha * opacity };
      } else paint.params.color.value = { hex, alpha: opacity };
      if (type === 'Stroke') {
        paint.params.width.value = width;
        paint.strokeCap = inherited('stroke-linecap', 'butt');
        paint.strokeJoin = inherited('stroke-linejoin', 'miter');
        paint.strokeDash = parseStrokeDash(inherited('stroke-dasharray', 'none'));
        paint.params.miterLimit.value = Number(inherited('stroke-miterlimit', '4'));
        paint.params.dashOffset.value = Number(
          inherited('stroke-dashoffset', '0').replace(/px$/i, ''),
        );
      }
      l.nodes.push(paint);
      source = paint.id;
    }
    out.params.path.source = source;
    l.nodes.push(out);
    l.output = out.id;
    const owner = el.closest('g[data-layer]');
    if (owner) l.name = owner.getAttribute('data-layer') || l.name;
    const paintKey = JSON.stringify(
      l.nodes
        .filter((n) =>
          ['Fill', 'Linear Gradient Fill', 'Radial Gradient Fill', 'Stroke'].includes(n.type),
        )
        .map((n) => [
          n.type,
          ...Object.entries(n.params).filter(([key]) => key !== 'path'),
          n.strokeCap,
          n.strokeJoin,
          n.strokeDash,
        ]),
    );
    const last = bundles.at(-1);
    if (owner && last?.owner === owner && last.paintKey === paintKey) last.layers.push(l);
    else bundles.push({ owner, paintKey, layers: [l] });
  }
  for (const bundle of bundles) {
    const l = bundle.layers[0];
    if (bundle.layers.length > 1) {
      if (bundle.layers.length > 256) throw Error('SVG group exceeds 256 independent paths');
      const paints = l.nodes.slice(2),
        nodes = bundle.layers.flatMap((child) => child.nodes.slice(0, 2));
      bundle.layers.forEach((child, index) =>
        child.nodes.slice(0, 2).forEach((n, column) => {
          n.position = [40 + column * 310, 40 + index * 160];
          n.collapsed = true;
        }),
      );
      let sources = bundle.layers.map((child) => child.nodes[1].id),
        depth = 0;
      while (sources.length > 1) {
        const next = [];
        for (let i = 0; i < sources.length; i += 2) {
          if (i + 1 === sources.length) {
            next.push(sources[i]);
            continue;
          }
          const join = node('Join Geometry', 650 + depth * 300, 40 + i * 160);
          join.collapsed = true;
          join.params.a.source = sources[i];
          join.params.b.source = sources[i + 1];
          nodes.push(join);
          next.push(join.id);
        }
        sources = next;
        depth++;
      }
      paints[0].params.path.source = sources[0];
      paints.forEach((paint, i) => {
        paint.position = [650 + (depth + i) * 300, 40];
      });
      l.nodes = [...nodes, ...paints];
      l.name = bundle.owner.getAttribute('data-layer') || l.name;
    }
    result.layers.push(l);
  }
  if (!result.layers.length) throw Error('SVG contains no supported shapes');
  return validate(result);
}
