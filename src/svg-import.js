import { document, layer, node, parsePath, validate } from './core.js';
/** Conservative SVG adapter. Requires a caller-supplied DOM parser; the core stays DOM-free. */
export function importSVG(text, Parser = globalThis.DOMParser) {
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text))
    throw Error('SVG declarations and external styles are unsupported');
  if (text.length > 10000000) throw Error('SVG exceeds 10 MB');
  const xml = new Parser().parseFromString(text, 'image/svg+xml'),
    root = xml.documentElement;
  if (root.localName !== 'svg' || xml.querySelector('parsererror'))
    throw Error('Invalid SVG document');
  const allowed = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'title', 'desc']);
  for (const el of [root, ...root.querySelectorAll('*')]) {
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
    ];
    const attrs = {
      svg: ['xmlns', 'width', 'height', 'viewBox'],
      g: [],
      path: ['d', 'data-layer'],
      circle: ['cx', 'cy', 'r'],
      ellipse: ['cx', 'cy', 'rx', 'ry'],
      rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
      title: [],
      desc: [],
    };
    for (const attr of el.attributes)
      if (![...common, ...attrs[el.localName]].includes(attr.name))
        throw Error(`Unsupported SVG attribute: ${attr.name}`);
    for (const key of ['fill-opacity', 'stroke-opacity'])
      if (el.hasAttribute(key)) {
        const raw = el.getAttribute(key);
        if (!/^(?:\d*\.)?\d+(?:e[+-]?\d+)?$/i.test(raw) || Number(raw) < 0 || Number(raw) > 1)
          throw Error('SVG fill-opacity must be a number from 0 to 1');
      }
    for (const [key, supported] of [
      ['stroke-linecap', 'butt'],
      ['stroke-linejoin', 'miter'],
    ])
      if (el.hasAttribute(key) && el.getAttribute(key) !== supported)
        throw Error(`Unsupported SVG ${key}`);
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
  const result = document();
  result.name = root.querySelector('title')?.textContent || 'Imported SVG';
  result.layers = [];
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
  for (const el of root.querySelectorAll('path,circle,ellipse,rect')) {
    const inherited = (key, fallback) => {
      let ancestor = el;
      while (ancestor) {
        if (ancestor.hasAttribute(key)) return ancestor.getAttribute(key);
        ancestor = ancestor.parentElement;
      }
      return fallback;
    };
    const color = (raw) => {
      if (raw === 'none') return null;
      if (/^#[0-9a-f]{3}$/i.test(raw)) raw = '#' + [...raw.slice(1)].map((x) => x + x).join('');
      const named = {
        black: '#000000',
        white: '#ffffff',
        red: '#ff0000',
        blue: '#0000ff',
        green: '#008000',
      };
      raw = named[raw] || raw;
      if (!/^#[0-9a-f]{6}$/i.test(raw))
        throw Error('Import currently supports solid hex fills and strokes and basic named colors');
      return raw;
    };
    const fill = color(inherited('fill', '#000000')),
      stroke = color(inherited('stroke', 'none')),
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
      parsePath(n.rawPath, n.id);
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
    const l = layer(
        el.getAttribute('data-layer') ||
          el.getAttribute('id') ||
          `Imported ${result.layers.length + 1}`,
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
      const paint = node(type, type === 'Fill' ? 650 : 950, 40);
      paint.params.path.source = source;
      paint.params.color.value = { hex, alpha: opacity };
      if (type === 'Stroke') paint.params.width.value = width;
      l.nodes.push(paint);
      source = paint.id;
    }
    out.params.path.source = source;
    l.nodes.push(out);
    l.output = out.id;
    result.layers.push(l);
  }
  if (!result.layers.length) throw Error('SVG contains no supported shapes');
  return validate(result);
}
