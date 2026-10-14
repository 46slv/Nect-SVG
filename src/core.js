import { validateImageAssets, imageURL } from './images.js';
import { validateGuides } from './guides.js';
export {
  guideDefaults,
  guideSettings,
  snapTranslation,
  layoutGridDefaults,
  layoutGridLines,
  setLayoutGrid,
} from './guides.js';
// The full build initializes PaperScript with new Function, which native CSP blocks.
// Geometry needs only the core build; keep script-src free of unsafe-eval.
import paper from 'paper/dist/paper-core.js';
import { validateFontAssets, resolveFonts, MAX_PROJECT_BYTES, utf8ByteLength } from './fonts.js';
import { layoutText } from './text-layout.js';
import { fingerprint } from './fingerprint.js';
const scope = new paper.PaperScope();
scope.setup(new scope.Size(1200, 800));
export const clone = (x) => structuredClone(x);
// Font assets are immutable and shared across snapshots; copying large base64 strings
// for every keystroke would turn a 20 MB font into gigabytes of undo history.
export function cloneDocument(doc) {
  const { fontAssets, imageAssets, ...model } = doc;
  const copy = clone(model);
  if (fontAssets) {
    for (const asset of Object.values(fontAssets)) Object.freeze(asset);
    copy.fontAssets = { ...fontAssets };
  }
  if (imageAssets) {
    for (const asset of Object.values(imageAssets)) Object.freeze(asset);
    copy.imageAssets = { ...imageAssets };
  }
  return copy;
}
export function sameDocument(a, b) {
  const { fontAssets: af = {}, imageAssets: ai = {}, ...am } = a;
  const { fontAssets: bf = {}, imageAssets: bi = {}, ...bm } = b;
  const sameAssets = (left, right) =>
    Object.keys(left).length === Object.keys(right).length &&
    Object.entries(left).every(([id, asset]) => {
      const other = right[id];
      return (
        other &&
        (asset === other ||
          (Object.keys(asset).length === Object.keys(other).length &&
            Object.entries(asset).every(([key, value]) => other[key] === value)))
      );
    });
  return sameAssets(af, bf) && sameAssets(ai, bi) && JSON.stringify(am) === JSON.stringify(bm);
}
export const uid = (prefix = 'id') => `${prefix}-${globalThis.crypto.randomUUID()}`;
const p = (type, value) => ({ type, value, expression: '', locked: false });
export const definitions = {
  Image: { position: p('Vector2', [100, 100]), size: p('Vector2', [320, 240]) },
  'Image Output': { path: p('Image', null) },
  Circle: { center: p('Vector2', [350, 250]), radius: p('Scalar', 120) },
  Ellipse: { center: p('Vector2', [350, 250]), size: p('Vector2', [240, 160]) },
  Rectangle: { center: p('Vector2', [460, 250]), size: p('Vector2', [180, 220]) },
  Polygon: {
    center: p('Vector2', [350, 250]),
    sides: p('Scalar', 6),
    radius: p('Scalar', 120),
    rotation: p('Scalar', 0),
  },
  Star: {
    center: p('Vector2', [350, 250]),
    points: p('Scalar', 5),
    outerRadius: p('Scalar', 120),
    innerRadius: p('Scalar', 60),
    rotation: p('Scalar', 0),
  },
  Curve: { closed: p('Boolean', true) },
  Boolean: { a: p('Path', null), b: p('Path', null) },
  'Join Geometry': { a: p('Path', null), b: p('Path', null) },
  'Convert to Path': { path: p('Path', null) },
  'Path Remap': { path: p('Path', null), offset: p('Vector2', [0, 0]) },
  Transform: {
    path: p('Path', null),
    anchor: p('Vector2', [0, 0]),
    offset: p('Vector2', [0, 0]),
    scale: p('Scalar', 1),
    rotation: p('Scalar', 0),
  },
  'Geometry Repeater': {
    path: p('Path', null),
    count: p('Scalar', 6),
    step: p('Vector2', [60, 0]),
    center: p('Vector2', [480, 270]),
    startAngle: p('Scalar', 0),
    angle: p('Scalar', 360),
  },
  Value: { value: p('Scalar', 100) },
  Math: { a: p('Scalar', 0), b: p('Scalar', 0), min: p('Scalar', 0), max: p('Scalar', 1) },
  'Vector Math': { a: p('Vector2', [0, 0]), b: p('Vector2', [0, 0]), scale: p('Scalar', 1) },
  'Separate Vector': { vector: p('Vector2', [0, 0]) },
  'Combine Vector': { x: p('Scalar', 0), y: p('Scalar', 0) },
  Toggle: { value: p('Boolean', true) },
  Color: { value: p('Color', { hex: '#36434e', alpha: 1 }) },
  Vector: { value: p('Vector2', [300, 250]) },
  Expression: { value: p('Scalar', 100) },
  Fill: { path: p('PaintedPath', null), color: p('Color', { hex: '#36434e', alpha: 1 }) },
  Stroke: {
    path: p('PaintedPath', null),
    color: p('Color', { hex: '#36434e', alpha: 1 }),
    width: p('Scalar', 2),
    miterLimit: p('Scalar', 4),
    dashOffset: p('Scalar', 0),
  },
  Output: { path: p('PaintedPath', null) },
  Text: {
    position: p('Vector2', [200, 300]),
    size: p('Scalar', 100),
    letterSpacing: p('Scalar', 0),
    lineSpacing: p('Scalar', 1.2),
  },
  'Text to Path': { path: p('Path', null) },
  'Imported Path': {},
};
// Keep count validation shared by JSON/direct input and resolved expression/socket input.
export function radialSettings(type, read) {
  const key = type === 'Polygon' ? 'sides' : 'points',
    count = read(key);
  if (!Number.isInteger(count) || count < 3 || count > 256)
    throw Error(`${type} ${key} must be an integer from 3 to 256`);
  const outer = read(type === 'Polygon' ? 'radius' : 'outerRadius'),
    inner = type === 'Star' ? read('innerRadius') : outer;
  if (![outer, inner].every((v) => Number.isFinite(v) && v > 0 && v <= 100000))
    throw Error('Radii must be positive and at most 100000 px');
  if (inner > outer) throw Error('Star innerRadius must not exceed outerRadius');
  return { count, outer, inner };
}
function radialPath(n, read) {
  const { count, outer, inner } = radialSettings(n.type, read),
    center = read('center'),
    rotation = read('rotation') % 360,
    total = n.type === 'Star' ? count * 2 : count,
    identity = `${n.id}:${n.type}:${count}`;
  return {
    contours: [
      {
        id: identity,
        closed: true,
        points: Array.from({ length: total }, (_, i) => {
          const angle = ((rotation - 90 + (i * 360) / total) * Math.PI) / 180,
            radius = n.type === 'Star' && i % 2 ? inner : outer,
            position = [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
          assertValue('Vector2', position);
          return { id: `${identity}:${i}`, position, handleA: [0, 0], handleB: [0, 0] };
        }),
      },
    ],
  };
}
export function parseStrokeDash(value) {
  const raw = value.trim();
  if (!raw || raw === 'none') return [];
  if (/^,|,$|,\s*,/.test(raw)) throw Error('Invalid dash pattern');
  const tokens = raw.split(/[\s,]+/);
  if (
    tokens.length > 32 ||
    tokens.some((t) => !/^[+]?(?:\d*\.)?\d+(?:e[+-]?\d+)?(?:px)?$/i.test(t))
  )
    throw Error('Dash pattern needs up to 32 nonnegative pixel lengths');
  const dash = tokens.map((t) => Number(t.replace(/px$/i, '')));
  validateStrokeStyle({ strokeDash: dash });
  return dash;
}
export function validateStrokeStyle(n) {
  if (n.strokeCap !== undefined && !['butt', 'round', 'square'].includes(n.strokeCap))
    throw Error('Invalid stroke cap');
  if (n.strokeJoin !== undefined && !['miter', 'round', 'bevel'].includes(n.strokeJoin))
    throw Error('Invalid stroke join');
  const dash = n.strokeDash === undefined ? [] : n.strokeDash;
  if (
    !Array.isArray(dash) ||
    dash.length > 32 ||
    dash.some((v) => !Number.isFinite(v) || v < 0 || v > 100000)
  )
    throw Error('Dash pattern needs up to 32 lengths from 0 to 100000 px');
  return { cap: n.strokeCap ?? 'butt', join: n.strokeJoin ?? 'miter', dash: [...dash] };
}
export function point(x, y) {
  return {
    id: uid('point'),
    position: p('Vector2', [x, y]),
    handleA: p('Vector2', [0, 0]),
    handleB: p('Vector2', [0, 0]),
    handleType: 'corner',
  };
}
export function node(type, x = 40, y = 40) {
  if (!definitions[type]) throw Error('Unknown node type');
  return {
    id: uid('node'),
    type,
    name: type,
    position: [x, y],
    width: 264,
    collapsed: false,
    params: clone(definitions[type]),
    points: type === 'Curve' ? [point(250, 150), point(450, 150), point(350, 350)] : [],
    operation:
      type === 'Geometry Repeater'
        ? 'linear'
        : ['Math', 'Vector Math'].includes(type)
          ? 'add'
          : 'subtract',
    edits: [],
    text: 'Nect',
    font: 'default',
    ...(type === 'Text'
      ? {
          writingMode: 'horizontal-tb',
          alignment: 'start',
          kerning: true,
          referenceBounds: 'visible',
          crossAlignment: 'origin',
        }
      : {}),
    rawPath: '',
    ...(type === 'Image' ? { asset: '' } : {}),
  };
}
export function layer(name = 'Composition 1') {
  let a = node('Circle', 40, 50),
    b = node('Rectangle', 40, 460),
    op = node('Boolean', 330, 50),
    remap = node('Path Remap', 620, 50),
    paint = node('Fill', 920, 50),
    out = node('Output', 1220, 50);
  op.params.a.source = a.id;
  op.params.b.source = b.id;
  remap.params.path.source = op.id;
  paint.params.path.source = remap.id;
  out.params.path.source = paint.id;
  return {
    id: uid('layer'),
    name,
    visible: true,
    locked: false,
    fill: '#36434e',
    nodes: [a, b, op, remap, paint, out],
    output: out.id,
  };
}
export function document() {
  return {
    schemaVersion: 2,
    name: 'Untitled composition',
    width: 960,
    height: 540,
    layers: [layer()],
  };
}
export function outputPorts(n) {
  return n.type === 'Separate Vector'
    ? [
        { id: 'x', label: 'X', type: 'Scalar' },
        { id: 'y', label: 'Y', type: 'Scalar' },
      ]
    : [{ id: undefined, label: '', type: outputType(n) }];
}
export function outputType(n, port) {
  if (n.type === 'Separate Vector') return ['x', 'y'].includes(port) ? 'Scalar' : undefined;
  if (port !== undefined) return undefined;
  if (n.type === 'Vector Math')
    return ['length', 'distance', 'dot'].includes(n.operation) ? 'Scalar' : 'Vector2';
  if (['Fill', 'Stroke', 'Output'].includes(n.type)) return 'PaintedPath';
  if (n.type === 'Color') return 'Color';
  if (n.type === 'Image' || n.type === 'Image Output') return 'Image';
  return ['Value', 'Expression', 'Math'].includes(n.type)
    ? 'Scalar'
    : ['Vector', 'Combine Vector'].includes(n.type)
      ? 'Vector2'
      : n.type === 'Toggle'
        ? 'Boolean'
        : 'Path';
}
export function socketCompatible(sourceType, targetType) {
  return sourceType === targetType || (sourceType === 'Path' && targetType === 'PaintedPath');
}
export function parameters(n) {
  const entries = Object.entries(n.params);
  for (const pt of n.points)
    for (const key of ['position', 'handleA', 'handleB'])
      entries.push([`${pt.id}.${key}`, pt[key]]);
  for (const edit of n.edits)
    if (edit.params)
      for (const [key, value] of Object.entries(edit.params))
        entries.push([`remap.${edit.pointId}.${key}`, value]);
  return entries;
}
export const operationOptions = {
  'Geometry Repeater': ['linear', 'radial-fit', 'radial-step'],
  Boolean: ['union', 'subtract', 'intersect', 'difference'],
  Math: ['add', 'subtract', 'multiply', 'divide', 'min', 'max', 'abs', 'clamp'],
  'Vector Math': [
    'add',
    'subtract',
    'multiply',
    'divide',
    'scale',
    'normalize',
    'length',
    'distance',
    'dot',
  ],
};
export function activeParameters(n) {
  const entries = parameters(n);
  if (n.type === 'Geometry Repeater')
    return entries.filter(([key]) =>
      (n.operation === 'linear'
        ? ['path', 'count', 'step']
        : ['path', 'count', 'center', 'startAngle', 'angle']
      ).includes(key),
    );
  if (n.type === 'Vector Math') {
    const keys =
      n.operation === 'scale'
        ? ['a', 'scale']
        : ['normalize', 'length'].includes(n.operation)
          ? ['a']
          : ['a', 'b'];
    return entries.filter(([key]) => keys.includes(key));
  }
  if (n.type !== 'Math') return entries;
  const keys =
    n.operation === 'abs' ? ['a'] : n.operation === 'clamp' ? ['a', 'min', 'max'] : ['a', 'b'];
  return entries.filter(([key]) => keys.includes(key));
}
export function setOperation(layer, nodeId, operation) {
  const n = layer.nodes.find((n) => n.id === nodeId);
  if (!n || !operationOptions[n.type]?.includes(operation)) throw Error('Invalid operation');
  for (const target of layer.nodes)
    for (const [, q] of parameters(target))
      if (
        q.source === nodeId &&
        !socketCompatible(outputType({ ...n, operation }, q.sourcePort), q.type)
      )
        throw Error('Operation would break a connected socket');
  n.operation = operation;
}
function mathValue(operation, read) {
  if (!operationOptions.Math.includes(operation)) throw Error('Invalid Math operation');
  const a = read('a');
  if (operation === 'abs') return Math.abs(a);
  if (operation === 'clamp') {
    const min = read('min'),
      max = read('max');
    if (min > max) throw Error('Clamp minimum exceeds maximum');
    return Math.min(max, Math.max(min, a));
  }
  const b = read('b');
  return {
    add: () => a + b,
    subtract: () => a - b,
    multiply: () => a * b,
    divide: () => (b === 0 ? 0 : a / b),
    min: () => Math.min(a, b),
    max: () => Math.max(a, b),
  }[operation]();
}
function vectorMathValue(operation, read) {
  if (!operationOptions['Vector Math'].includes(operation))
    throw Error('Invalid Vector Math operation');
  const a = read('a');
  if (operation === 'length') return Math.hypot(...a);
  if (operation === 'normalize') {
    // Scale before measuring so both huge and subnormal finite inputs normalize safely.
    const largest = Math.max(...a.map(Math.abs));
    if (largest === 0) return [0, 0];
    const scaled = a.map((v) => v / largest),
      length = Math.hypot(...scaled);
    return scaled.map((v) => v / length);
  }
  if (operation === 'scale') {
    const scale = read('scale');
    return a.map((v) => v * scale);
  }
  const b = read('b');
  if (operation === 'distance') return Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (operation === 'dot') return a[0] * b[0] + a[1] * b[1];
  return a.map((v, i) =>
    ({
      add: () => v + b[i],
      subtract: () => v - b[i],
      multiply: () => v * b[i],
      divide: () => (b[i] === 0 ? 0 : v / b[i]),
    })[operation](),
  );
}
export function enableRemapPoint(n, input, pointId) {
  if (
    n.type !== 'Path Remap' ||
    !input.contours.some((c) => c.points.some((p) => p.id === pointId))
  )
    throw Error('Missing remap target');
  let edit = n.edits.find((e) => e.pointId === pointId);
  if (!edit) {
    edit = { pointId, ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}) };
    n.edits.push(edit);
  }
  if (!edit.params) {
    edit.params = {};
    for (const key of ['position', 'handleA', 'handleB']) {
      edit.params[key] = p('Vector2', edit[key] || [0, 0]);
      delete edit[key];
    }
  }
  return edit;
}
export function rebindRemapPoint(n, input, pointId) {
  const edit = n.edits.find((e) => e.pointId === pointId);
  if (!edit || !input.contours.some((c) => c.points.some((p) => p.id === pointId)))
    throw Error('Missing remap target');
  if (input.fingerprint) edit.fingerprint = input.fingerprint;
  else delete edit.fingerprint;
  return edit;
}
export function translateRemapPoints(n, input, pointIds, delta) {
  assertValue('Vector2', delta);
  if (!Array.isArray(pointIds) || !pointIds.length) throw Error('Select at least one point');
  const draft = clone(n);
  for (const pointId of new Set(pointIds)) {
    const existing = draft.edits.find((e) => e.pointId === pointId);
    if (existing && input.unstable && existing.fingerprint !== input.fingerprint)
      throw Error('Selected edit is suspended; rebind explicitly first');
    const edit = enableRemapPoint(draft, input, pointId);
    const q = edit.params.position;
    if (q.locked || q.source || q.expression) throw Error('Selected position is locked or driven');
    q.value = q.value.map((v, i) => v + delta[i]);
    assertValue('Vector2', q.value);
  }
  n.edits = draft.edits;
}
export function parameter(n, key) {
  return parameters(n).find(([k]) => k === key)?.[1];
}
export function expression(source) {
  if (source.length > 4096) throw Error('Expression exceeds 4096 characters');
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-zA-Z]+|[()+\-*/%,]/g) || [];
  if (tokens.join('') !== source.replace(/\s/g, '')) throw Error('Unsupported expression syntax');
  let i = 0;
  const funcs = {
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    abs: Math.abs,
    sqrt: Math.sqrt,
    min: Math.min,
    max: Math.max,
    round: Math.round,
  };
  function atom() {
    let t = tokens[i++];
    if (t === '-') return -atom();
    if (t === '+') return atom();
    if (t === '(') {
      let v = parse(0);
      if (tokens[i++] !== ')') throw Error('Missing closing parenthesis');
      return v;
    }
    if (t === 'pi') return Math.PI;
    if (t === 'e') return Math.E;
    if (t in funcs) {
      if (tokens[i++] !== '(') throw Error('Function requires parentheses');
      let args = [parse(0)];
      while (tokens[i] === ',') {
        i++;
        args.push(parse(0));
      }
      if (tokens[i++] !== ')') throw Error('Missing closing parenthesis');
      return funcs[t](...args);
    }
    if (t && /^\d|^\./.test(t)) return Number(t);
    throw Error('Expected a number');
  }
  function parse(min) {
    let v = atom();
    while (i < tokens.length) {
      let op = tokens[i],
        prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 }[op];
      if (!prec || prec < min) break;
      i++;
      let r = parse(prec + 1);
      v = op === '+' ? v + r : op === '-' ? v - r : op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  let result = parse(0);
  if (i !== tokens.length || !Number.isFinite(result))
    throw Error('Expression must produce a finite number');
  return result;
}
function assertValue(type, value) {
  if (
    type === 'Color' &&
    (!value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      typeof value.hex !== 'string' ||
      !/^#[0-9a-fA-F]{6}$/.test(value.hex) ||
      !Number.isFinite(value.alpha) ||
      value.alpha < 0 ||
      value.alpha > 1)
  )
    throw Error('Expected Color with hex #RRGGBB and alpha from 0 to 1');
  if (type === 'Scalar' && !Number.isFinite(value)) throw Error('Expected finite Scalar');
  if (
    type === 'Vector2' &&
    (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite))
  )
    throw Error('Expected Vector2');
  if (type === 'Boolean' && typeof value !== 'boolean') throw Error('Expected Boolean');
}
function toPaper(path) {
  let compound = new scope.CompoundPath({ insert: false });
  for (const contour of path.contours) {
    let child = new scope.Path({ insert: false, closed: contour.closed });
    for (const pt of contour.points)
      child.add(new scope.Segment(pt.position, pt.handleA, pt.handleB));
    compound.addChild(child);
  }
  return compound;
}
function contourGroups(path) {
  const groups = new Map();
  for (const c of path.contours) {
    const key = c.group ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return [...groups.values()];
}
function booleanOperand(path) {
  if (!path.contours.some((c) => c.group !== undefined)) return toPaper(path);
  let result = null;
  for (const contours of contourGroups(path)) {
    const item = toPaper({ contours });
    if (!result) {
      result = item;
      continue;
    }
    const union = result.unite(item, { insert: false });
    result.remove();
    item.remove();
    result = union;
  }
  return result || toPaper({ contours: [] });
}
function fromPaper(item, prefix) {
  let children = item.children || [item];
  return {
    contours: children.map((c, ci) => ({
      id: `${prefix}:c${ci}`,
      closed: c.closed,
      points: c.segments.map((s, si) => ({
        id: `${prefix}:c${ci}:p${si}`,
        position: [s.point.x, s.point.y],
        handleA: [s.handleIn.x, s.handleIn.y],
        handleB: [s.handleOut.x, s.handleOut.y],
      })),
    })),
  };
}

export function parsePath(data, prefix = 'imported') {
  if (
    typeof data !== 'string' ||
    data.length > 100000 ||
    !/^[MmLlHhVvCcSsQqTtAaZzEe0-9+.,\s-]*$/.test(data)
  )
    throw Error('Unsupported SVG path data');
  const item = new scope.CompoundPath({ pathData: data, insert: false });
  try {
    const result = fromPaper(item, prefix);
    for (const c of result.contours)
      for (const pt of c.points)
        for (const k of ['position', 'handleA', 'handleB']) assertValue('Vector2', pt[k]);
    return result;
  } finally {
    item.remove();
  }
}
export function signature(path) {
  return JSON.stringify(
    path.contours.map((c) => [
      c.closed,
      c.points.map((p) => [p.position, p.handleA, p.handleB]),
      ...(c.group === undefined ? [] : [c.group]),
    ]),
  );
}
export function pathData(path) {
  const obj = toPaper(path);
  const result = obj.pathData;
  obj.remove();
  return result;
}
export function pathBounds(path) {
  if (path.kind === 'image') {
    const [x, y] = path.position,
      [w, h] = path.size;
    return [
      [x, x + w / 2, x + w],
      [y, y + h / 2, y + h],
    ];
  }
  const obj = toPaper(path);
  const { left, right, top, bottom } = obj.bounds;
  obj.remove();
  return [
    [left, (left + right) / 2, right],
    [top, (top + bottom) / 2, bottom],
  ];
}
export function pathArea(path) {
  const obj = booleanOperand(path);
  obj.reorient(true, true);
  const area = Math.abs(obj.area);
  obj.remove();
  return area;
}
const evaluationCaches = new WeakMap();
let revision = 0;
export function evaluate(layer, fonts = {}, imageAssets = {}) {
  let cache = evaluationCaches.get(layer);
  if (!cache) {
    cache = new Map();
    evaluationCaches.set(layer, cache);
  }
  const values = new Map(),
    warnings = [],
    active = new Set(),
    versions = new Map();
  let computed = 0,
    reused = 0;
  const byId = new Map(layer.nodes.map((n) => [n.id, n]));
  function run(id, port) {
    const n = byId.get(id);
    if (!n || !outputType(n, port)) throw Error('Missing output socket');
    const value = runNode(id);
    return n.type === 'Separate Vector' ? value[port === 'x' ? 0 : 1] : value;
  }
  function runNode(id) {
    if (values.has(id)) return values.get(id);
    if (active.has(id)) throw Error('Cycle detected');
    if (active.size >= 256) throw Error('Graph depth exceeds 256 nodes');
    let n = byId.get(id);
    if (!n) throw Error('Missing source node');
    active.add(id);
    try {
      const inputs = activeParameters(n);
      const deps = inputs.filter(([, q]) => q.source).map(([, q]) => q.source);
      for (const dep of deps) runNode(dep);
      const cacheKey = JSON.stringify([
        n.type,
        inputs,
        n.type === 'Fill' ? layer.fill : null,
        n.points,
        n.operation,
        n.edits,
        n.text,
        n.font,
        n.writingMode,
        n.alignment,
        n.referenceBounds,
        n.crossAlignment,
        n.positionReference,
        n.kerning,
        n.strokeCap,
        n.strokeJoin,
        n.strokeDash,
        n.rawPath,
        n.asset,
        n.asset && imageAssets[n.asset]
          ? [imageAssets[n.asset].width, imageAssets[n.asset].height]
          : null,
        deps.map((dep) => [dep, versions.get(dep)]),
      ]);
      const existing = cache.get(id);
      if (existing && existing.key === cacheKey && existing.font === fonts[n.font]) {
        reused++;
        const result = clone(existing.value);
        values.set(id, result);
        versions.set(id, existing.version);
        active.delete(id);
        warnings.push(...existing.warnings);
        return result;
      }
      const warningStart = warnings.length;
      computed++;
      function read(key) {
        let q = parameter(n, key);
        if (!q) throw Error(`Missing parameter ${key}`);
        if (q.type === 'Color' && q.expression) throw Error('Color expressions are not supported');
        let value = q.source
          ? run(q.source, q.sourcePort)
          : q.expression
            ? q.type === 'Vector2'
              ? q.expression.split(';').map(expression)
              : expression(q.expression)
            : n.type === 'Fill' && key === 'color' && q.value === null
              ? { hex: layer.fill, alpha: 1 }
              : clone(q.value);
        if (q.source && !socketCompatible(outputType(byId.get(q.source), q.sourcePort), q.type))
          throw Error('Incompatible socket types');
        assertValue(q.type, value);
        return value;
      }
      let result;
      if (['Value', 'Vector', 'Expression', 'Toggle', 'Color'].includes(n.type))
        result = read('value');
      else if (n.type === 'Vector Math') {
        result = vectorMathValue(n.operation, read);
        assertValue(outputType(n), result);
      } else if (n.type === 'Separate Vector') result = read('vector');
      else if (n.type === 'Math') {
        result = mathValue(n.operation, read);
        assertValue('Scalar', result);
      } else if (n.type === 'Combine Vector') {
        result = [read('x'), read('y')];
        assertValue('Vector2', result);
      } else if (n.type === 'Polygon' || n.type === 'Star') {
        result = radialPath(n, read);
      } else if (n.type === 'Circle' || n.type === 'Ellipse' || n.type === 'Rectangle') {
        const center = read('center');
        let item;
        if (n.type === 'Circle')
          item = new scope.Path.Circle({
            center,
            radius: Math.max(0, read('radius')),
            insert: false,
          });
        else {
          let size = read('size').map(Math.abs),
            rectangle = new scope.Rectangle(
              center[0] - size[0] / 2,
              center[1] - size[1] / 2,
              ...size,
            );
          item =
            n.type === 'Ellipse'
              ? new scope.Path.Ellipse({ rectangle, insert: false })
              : new scope.Path.Rectangle({ rectangle, insert: false });
        }
        result = fromPaper(item, n.id);
        item.remove();
      } else if (n.type === 'Image') {
        if (!Object.hasOwn(imageAssets, n.asset)) throw Error('Missing image asset');
        const size = read('size');
        if (size.some((v) => v <= 0 || v > 100000))
          throw Error('Image size must be positive and at most 100000');
        result = { kind: 'image', asset: n.asset, position: read('position'), size };
      } else if (n.type === 'Curve')
        result = {
          contours: [
            {
              id: n.id,
              closed: read('closed'),
              points: n.points.map((pt) => ({
                id: pt.id,
                position: read(`${pt.id}.position`),
                handleA: read(`${pt.id}.handleA`),
                handleB: read(`${pt.id}.handleB`),
              })),
            },
          ],
        };
      else if (n.type === 'Text') {
        let font = fonts[n.font];
        if (!font) throw Error('Font is still loading or unavailable');
        const layout = layoutText(font, n.text, {
          position: read('position'),
          size: read('size'),
          writingMode: n.writingMode,
          alignment: n.alignment,
          referenceBounds: n.referenceBounds,
          crossAlignment: n.crossAlignment,
          kerning: n.kerning,
          letterSpacing: n.params.letterSpacing ? read('letterSpacing') : 0,
          lineSpacing: n.params.lineSpacing ? read('lineSpacing') : 1.2,
        });
        warnings.push(...layout.warnings.map((warning) => `${n.name}: ${warning}`));
        const d = layout.path.toPathData(5);
        let item = new scope.CompoundPath({ pathData: d, insert: false });
        result = fromPaper(item, n.id);
        result.unstable = true;
        result.fingerprint = signature(result);
        item.remove();
      } else if (n.type === 'Join Geometry') {
        const a = read('a'),
          b = read('b');
        if (!a || !b) throw Error('Connect both Join Geometry paths');
        const contours = [...a.contours, ...b.contours];
        if (
          contours.length > 10000 ||
          contours.reduce((sum, c) => sum + c.points.length, 0) > 100000
        )
          throw Error('Join exceeds geometry budget');
        const groups = [...contourGroups(a), ...contourGroups(b)];
        if (groups.length > 256) throw Error('Join exceeds 256 independent groups');
        const prefix = fingerprint(n.id);
        result = {
          contours: groups.flatMap((group, gi) =>
            group.map((c, ci) => ({
              ...clone(c),
              id: `${prefix}:g${gi}:c${ci}`,
              group: `${prefix}:g${gi}`,
              points: c.points.map((pt, pi) => ({
                ...clone(pt),
                id: `${prefix}:g${gi}:c${ci}:p${pi}`,
              })),
            })),
          ),
        };
        result.unstable = true;
        result.fingerprint = fingerprint(signature(result));
      } else if (n.type === 'Geometry Repeater') {
        const source = read('path');
        if (!source) throw Error('Connect a Path input');
        const count = read('count');
        if (!Number.isInteger(count) || count < 1 || count > 256)
          throw Error('Repeater count must be an integer from 1 to 256');
        if (
          source.contours.length * count > 10000 ||
          source.contours.reduce((sum, c) => sum + c.points.length, 0) * count > 100000
        )
          throw Error('Repeater exceeds geometry budget');
        const grouped = source.contours.some((c) => c.group !== undefined);
        const groups = grouped
          ? new Map(contourGroups(source).map((group, i) => [group[0].group ?? '', i]))
          : null;
        if (grouped && groups.size * count > 256)
          throw Error('Repeater exceeds 256 independent groups');
        const linear = n.operation === 'linear';
        if (!operationOptions['Geometry Repeater'].includes(n.operation))
          throw Error('Invalid repeater operation');
        const step = linear ? read('step') : [0, 0];
        const center = linear ? [0, 0] : read('center');
        const start = linear ? 0 : read('startAngle');
        const angle = linear ? 0 : read('angle');
        if (n.operation === 'radial-fit' && Math.abs(angle) > 360)
          throw Error('Fit arc must be between -360 and 360 degrees');
        const increment =
          n.operation === 'radial-fit'
            ? angle / (Math.abs(angle) === 360 ? count : Math.max(1, count - 1))
            : angle;
        result = { contours: [] };
        const prefix = fingerprint(n.id);
        for (let copy = 0; copy < count; copy++) {
          const radians = (((start + increment * copy) % 360) * Math.PI) / 180;
          const cos = Math.cos(radians),
            sin = Math.sin(radians);
          function transform(v, handle = false) {
            const x = v[0] - (handle ? 0 : center[0]),
              y = v[1] - (handle ? 0 : center[1]);
            const next = [
              x * cos - y * sin + (handle ? 0 : center[0] + step[0] * copy),
              x * sin + y * cos + (handle ? 0 : center[1] + step[1] * copy),
            ];
            assertValue('Vector2', next);
            return next;
          }
          for (const [ci, c] of source.contours.entries())
            result.contours.push({
              id: `${prefix}:copy${copy}:c${ci}`,
              ...(grouped ? { group: `${prefix}:copy${copy}:g${groups.get(c.group ?? '')}` } : {}),
              closed: c.closed,
              points: c.points.map((pt, pi) => ({
                id: `${prefix}:copy${copy}:c${ci}:p${pi}`,
                position: transform(pt.position),
                handleA: transform(pt.handleA, true),
                handleB: transform(pt.handleB, true),
              })),
            });
        }
        result.unstable = true;
        result.fingerprint = fingerprint(signature(result));
      } else if (n.type === 'Imported Path') {
        result = parsePath(n.rawPath, n.id);
        result.unstable = true;
        result.fingerprint = signature(result);
      } else if (n.type === 'Boolean') {
        let a = read('a'),
          b = read('b');
        if (!a || !b) throw Error('Connect both Boolean paths');
        if ([...a.contours, ...b.contours].some((c) => !c.closed))
          throw Error('Boolean requires closed contours');
        let pa = booleanOperand(a),
          pb = booleanOperand(b);
        let op = {
          union: 'unite',
          subtract: 'subtract',
          intersect: 'intersect',
          difference: 'exclude',
        }[n.operation];
        if (!op) throw Error('Unknown Boolean operation');
        let r = pa[op](pb, { insert: false });
        result = fromPaper(r, n.id);
        result.unstable = true;
        result.fingerprint = signature(result);
        pa.remove();
        pb.remove();
        r.remove();
      } else {
        result = read('path');
        if (!result) throw Error(`Connect a ${n.params.path.type} input`);
        result = clone(result);
        if (n.type === 'Fill') result.fill = read('color');
        if (n.type === 'Stroke') {
          const width = read('width');
          if (width < 0 || width > 100000) throw Error('Stroke width must be from 0 to 100000 px');
          const style = validateStrokeStyle(n),
            miterLimit = n.params.miterLimit ? read('miterLimit') : 4,
            dashOffset = n.params.dashOffset ? read('dashOffset') : 0;
          if (miterLimit < 1 || miterLimit > 10000)
            throw Error('Miter limit must be from 1 to 10000');
          if (Math.abs(dashOffset) > 100000)
            throw Error('Dash offset must be from -100000 to 100000 px');
          result.stroke = { ...read('color'), width, ...style, miterLimit, dashOffset };
        }
        if (n.type === 'Path Remap') {
          let offset = read('offset');
          for (const contour of result.contours)
            for (const pt of contour.points) pt.position = pt.position.map((v, i) => v + offset[i]);
          for (const edit of n.edits) {
            let pt = result.contours.flatMap((c) => c.points).find((p) => p.id === edit.pointId);
            if (!pt || (result.unstable && edit.fingerprint !== result.fingerprint)) {
              warnings.push(
                `${n.name}: vertex edit suspended because its source changed. Rebind explicitly.`,
              );
              continue;
            }
            for (const key of ['position', 'handleA', 'handleB']) {
              const delta = edit.params?.[key] ? read(`remap.${edit.pointId}.${key}`) : edit[key];
              if (delta) pt[key] = pt[key].map((v, i) => v + delta[i]);
            }
          }
        } else if (n.type === 'Transform') {
          let obj = toPaper(result);
          const anchor = n.params.anchor ? read('anchor') : [0, 0];
          obj.scale(read('scale'), anchor);
          obj.rotate(read('rotation'), anchor);
          obj.translate(read('offset'));
          let transformed = fromPaper(obj, n.id);
          transformed.contours.forEach((c, ci) => {
            c.id = result.contours[ci].id;
            if (result.contours[ci].group !== undefined) c.group = result.contours[ci].group;
            c.points.forEach((p, pi) => (p.id = result.contours[ci].points[pi].id));
          });
          transformed.unstable = result.unstable;
          transformed.fingerprint = result.fingerprint;
          result = transformed;
          obj.remove();
        }
      }
      if (
        ['Circle', 'Ellipse', 'Rectangle', 'Polygon', 'Star', 'Image'].includes(n.type) &&
        n.positionReference &&
        n.positionReference !== 'origin'
      ) {
        const [horizontal, vertical] = n.positionReference.split('-');
        const indices = { left: 0, center: 1, right: 2, top: 0, middle: 1, bottom: 2 };
        if (
          !['left', 'center', 'right'].includes(horizontal) ||
          !['top', 'middle', 'bottom'].includes(vertical)
        )
          throw Error('Invalid object Position reference');
        const bounds = pathBounds(result),
          position = read(n.type === 'Image' ? 'position' : 'center');
        const delta = position.map(
          (v, axis) => v - bounds[axis][indices[axis ? vertical : horizontal]],
        );
        if (n.type === 'Image') result.position = result.position.map((v, axis) => v + delta[axis]);
        else
          for (const contour of result.contours)
            for (const point of contour.points)
              point.position = point.position.map((v, axis) => v + delta[axis]);
      }
      active.delete(id);
      values.set(id, result);
      const version = ++revision;
      versions.set(id, version);
      cache.set(id, {
        key: cacheKey,
        font: fonts[n.font],
        value: clone(result),
        version,
        warnings: warnings.slice(warningStart),
      });
      return result;
    } finally {
      active.delete(id);
    }
  }
  let path = null,
    error = null;
  try {
    path = run(layer.output);
  } catch (e) {
    error = e.message;
  }
  for (const id of cache.keys()) if (!byId.has(id)) cache.delete(id);
  return { path, error, warnings, values, run, stats: { computed, reused } };
}
export function connect(layer, sourceId, targetId, key, validating = false, sourcePort) {
  let from = layer.nodes.find((n) => n.id === sourceId),
    to = layer.nodes.find((n) => n.id === targetId),
    q = to && parameter(to, key);
  if (!from || !q) throw Error('Missing socket');
  if (q.locked && !validating) throw Error('Parameter is locked');
  if (!socketCompatible(outputType(from, sourcePort), q.type))
    throw Error(`Cannot connect ${outputType(from, sourcePort)} to ${q.type}`);
  const old = q.source,
    oldPort = q.sourcePort;
  q.source = sourceId;
  if (sourcePort !== undefined) q.sourcePort = sourcePort;
  else delete q.sourcePort;
  const seen = new Set(),
    active = new Set();
  function visit(id) {
    if (active.has(id)) throw Error('Connection would create a cycle');
    if (seen.has(id)) return;
    active.add(id);
    for (const [, p] of parameters(layer.nodes.find((n) => n.id === id)))
      if (p.source) visit(p.source);
    active.delete(id);
    seen.add(id);
  }
  try {
    for (const n of layer.nodes) visit(n.id);
  } catch (e) {
    if (old) q.source = old;
    else delete q.source;
    if (oldPort !== undefined) q.sourcePort = oldPort;
    else delete q.sourcePort;
    throw e;
  }
}
export function disconnect(n, key) {
  const q = parameter(n, key);
  if (q.locked) throw Error('Parameter is locked');
  delete q.source;
  delete q.sourcePort;
}
// Upgrade on load/validation only; storage is never written by migration.
export function migratePaint(doc) {
  if (doc.schemaVersion !== 1) return doc;
  if (!Array.isArray(doc.layers)) throw Error('Invalid layers');
  for (const l of doc.layers) {
    if (!Array.isArray(l.nodes)) throw Error('Invalid composition');
    const outputs = new Map(l.nodes.filter((n) => n.type === 'Output').map((n) => [n.id, n]));
    if (l.nodes.length + outputs.size > 2000)
      throw Error('Invalid composition: migration exceeds 2000 nodes');
    // Legacy Output also exposed geometry. Retain its geometry connections before inserting paint.
    const geometrySource = (source, seen = new Set()) => {
      if (!outputs.has(source)) return source;
      if (seen.has(source)) throw Error('Cycle detected');
      seen.add(source);
      return geometrySource(outputs.get(source).params?.path?.source, seen);
    };
    for (const n of l.nodes) {
      if (!n.params) throw Error('Invalid node');
      for (const [, q] of parameters(n)) {
        if (q.type === 'Path' && outputs.has(q.source) && n.type !== 'Output') {
          const source = geometrySource(q.source);
          if (source) q.source = source;
          else delete q.source;
        }
      }
    }
    for (const out of outputs.values()) {
      if (!out.params?.path || out.params.path.type !== 'Path')
        throw Error('Invalid parameter type');
      if (Object.keys(out.params).some((key) => !['path', 'fill'].includes(key)))
        throw Error('Unexpected parameter');
      const fill = node('Fill', out.position?.[0] ?? 40, (out.position?.[1] ?? 40) + 280);
      fill.params.path = { ...clone(out.params.path), type: 'PaintedPath' };
      fill.params.color = out.params.fill ? clone(out.params.fill) : p('Color', null);
      out.params.path = { ...out.params.path, type: 'PaintedPath', source: fill.id };
      delete out.params.fill;
      l.nodes.splice(l.nodes.indexOf(out), 0, fill);
    }
  }
  doc.schemaVersion = 2;
  return doc;
}
export function validate(doc) {
  const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,180}$/;
  const ids = new Set();
  function id(value) {
    if (typeof value !== 'string' || !idPattern.test(value) || ids.has(value))
      throw Error('Invalid or duplicate ID');
    ids.add(value);
  }
  function text(value) {
    if (typeof value !== 'string' || value.length > 100000) throw Error('Invalid text field');
  }
  function vec(value) {
    assertValue('Vector2', value);
  }
  function param(q, type, layerFillFallback = false) {
    if (!q || q.type !== type) throw Error('Invalid parameter type');
    if (!(layerFillFallback && q.value === null)) assertValue(type, q.value);
    if (['Path', 'PaintedPath', 'Image'].includes(type) && q.value !== null)
      throw Error('Path fallback must be null');
    text(q.expression);
    if (type === 'Color' && q.expression) throw Error('Color expressions are not supported');
    if (typeof q.locked !== 'boolean') throw Error('Invalid lock state');
    if (q.source !== undefined && (typeof q.source !== 'string' || !idPattern.test(q.source)))
      throw Error('Invalid source ID');
    if (q.sourcePort !== undefined && (!q.source || !['x', 'y'].includes(q.sourcePort)))
      throw Error('Invalid source port');
  }
  if (!doc || ![1, 2].includes(doc.schemaVersion)) throw Error('Unsupported project version');
  if (doc.schemaVersion === 1) migratePaint(doc);
  text(doc.name);
  validateFontAssets(doc.fontAssets);
  validateImageAssets(doc.imageAssets);
  validateGuides(doc.editor, id);
  if (!Array.isArray(doc.layers) || doc.layers.length < 1 || doc.layers.length > 100)
    throw Error('Invalid layers');
  for (const key of ['width', 'height'])
    if (!Number.isFinite(doc[key]) || doc[key] <= 0 || doc[key] > 100000)
      throw Error('Invalid artboard size');
  for (const l of doc.layers) {
    id(l.id);
    text(l.name);
    if (
      typeof l.visible !== 'boolean' ||
      typeof l.locked !== 'boolean' ||
      (l.guide !== undefined && typeof l.guide !== 'boolean') ||
      !/^#[0-9a-fA-F]{6}$/.test(l.fill)
    )
      throw Error('Invalid layer state');
    if (!Array.isArray(l.nodes) || l.nodes.length > 2000) throw Error('Invalid composition');
    for (const n of l.nodes) {
      id(n.id);
      text(n.name);
      vec(n.position);
      if (n.width !== undefined && (!Number.isFinite(n.width) || n.width < 220 || n.width > 550))
        throw Error('Invalid node width');
      if (n.collapsed !== undefined && typeof n.collapsed !== 'boolean')
        throw Error('Invalid node collapse state');
      text(n.text);
      text(n.font);
      if (
        n.positionReference !== undefined &&
        (typeof n.positionReference !== 'string' ||
          !['Circle', 'Ellipse', 'Rectangle', 'Polygon', 'Star', 'Image'].includes(n.type) ||
          !/^(origin|(left|center|right)-(top|middle|bottom))$/.test(n.positionReference))
      )
        throw Error('Invalid object Position reference');
      if (n.type === 'Text') {
        if (n.referenceBounds !== undefined && !['visible', 'advance'].includes(n.referenceBounds))
          throw Error('Invalid text reference bounds');
        if (
          n.crossAlignment !== undefined &&
          !['origin', 'start', 'center', 'end'].includes(n.crossAlignment)
        )
          throw Error('Invalid cross-axis reference');
        if (n.alignment !== undefined && !['start', 'center', 'end'].includes(n.alignment))
          throw Error('Invalid text alignment');
        if (n.kerning !== undefined && typeof n.kerning !== 'boolean')
          throw Error('Invalid kerning setting');
        if (n.font !== 'default' && !Object.hasOwn(doc.fontAssets || {}, n.font))
          throw Error('Missing font asset');
        if (
          n.writingMode !== undefined &&
          !['horizontal-tb', 'vertical-rl'].includes(n.writingMode)
        )
          throw Error('Invalid writing mode');
      }
      if (n.type === 'Image' && !Object.hasOwn(doc.imageAssets || {}, n.asset))
        throw Error('Missing image asset');
      if (n.rawPath !== undefined) text(n.rawPath);
      if (n.type === 'Imported Path') parsePath(n.rawPath, n.id);
      if (
        !Object.hasOwn(definitions, n.type) ||
        !n.params ||
        !Array.isArray(n.points) ||
        !Array.isArray(n.edits)
      )
        throw Error('Invalid node');
      if (!(operationOptions[n.type] || operationOptions.Boolean).includes(n.operation))
        throw Error('Invalid operation');
      // Older schema-v1 Text nodes omit spacing; migrate only the documented new fields.
      if (n.type === 'Text')
        for (const key of ['letterSpacing', 'lineSpacing'])
          if (!Object.hasOwn(n.params, key)) n.params[key] = clone(definitions.Text[key]);
      if (n.type === 'Transform' && !Object.hasOwn(n.params, 'anchor'))
        n.params.anchor = clone(definitions.Transform.anchor);
      if (n.type === 'Stroke') {
        validateStrokeStyle(n);
        for (const key of ['miterLimit', 'dashOffset'])
          if (!Object.hasOwn(n.params, key)) n.params[key] = clone(definitions.Stroke[key]);
      }
      if (Object.keys(n.params).length !== Object.keys(definitions[n.type]).length)
        throw Error('Unexpected parameter');
      for (const [key, def] of Object.entries(definitions[n.type]))
        param(n.params[key], def.type, n.type === 'Fill' && key === 'color');
      if (['Polygon', 'Star'].includes(n.type))
        radialSettings(n.type, (key) => n.params[key].value);
      if (
        n.type === 'Geometry Repeater' &&
        (!Number.isInteger(n.params.count.value) ||
          n.params.count.value < 1 ||
          n.params.count.value > 256)
      )
        throw Error('Repeater count must be an integer from 1 to 256');
      if (n.type === 'Stroke' && (n.params.width.value < 0 || n.params.width.value > 100000))
        throw Error('Stroke width must be from 0 to 100000 px');
      if (
        n.type === 'Stroke' &&
        (n.params.miterLimit.value < 1 ||
          n.params.miterLimit.value > 10000 ||
          Math.abs(n.params.dashOffset.value) > 100000)
      )
        throw Error('Invalid stroke miter limit or dash offset');
      if (n.points.length > 10000 || n.edits.length > 10000) throw Error('Too many vertices');
      for (const pt of n.points) {
        id(pt.id);
        for (const k of ['position', 'handleA', 'handleB']) param(pt[k], 'Vector2');
        if (!['corner', 'smooth', 'symmetric'].includes(pt.handleType))
          throw Error('Invalid handle type');
      }
      const editIds = new Set();
      for (const edit of n.edits) {
        if (editIds.has(edit.pointId)) throw Error('Duplicate edit target');
        editIds.add(edit.pointId);
        if (typeof edit.pointId !== 'string' || !idPattern.test(edit.pointId))
          throw Error('Invalid edit target');
        if (edit.fingerprint !== undefined) text(edit.fingerprint);
        if (edit.params) {
          if (Object.keys(edit.params).length !== 3) throw Error('Invalid remap parameters');
          for (const k of ['position', 'handleA', 'handleB']) param(edit.params[k], 'Vector2');
        }
        for (const k of ['position', 'handleA', 'handleB']) if (edit[k] !== undefined) vec(edit[k]);
      }
    }
    if (!l.nodes.some((n) => n.id === l.output && ['Output', 'Image Output'].includes(n.type)))
      throw Error('Missing Output node');
    for (const n of l.nodes)
      for (const [key, q] of parameters(n))
        if (q.source) connect(l, q.source, n.id, key, true, q.sourcePort);
  }
  return doc;
}
export function serialize(doc) {
  const text = JSON.stringify(doc, null, 2);
  if (text.length > MAX_PROJECT_BYTES || utf8ByteLength(text) > MAX_PROJECT_BYTES)
    throw Error('Project exceeds 50 MB');
  return text;
}
export function deserialize(text) {
  if (text.length > MAX_PROJECT_BYTES || utf8ByteLength(text) > MAX_PROJECT_BYTES)
    throw Error('Project exceeds 50 MB');
  return validate(JSON.parse(text));
}
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
  );
export function renderElement(value, l, assets = {}, attributes = '') {
  if (value.kind === 'image') {
    const asset = assets[value.asset];
    if (!asset) throw Error('Missing image asset');
    return `<image ${attributes} data-layer="${escape(l.name)}" x="${value.position[0]}" y="${value.position[1]}" width="${value.size[0]}" height="${value.size[1]}" preserveAspectRatio="none" href="${imageURL(asset)}"/>`;
  }
  if (value.contours.some((c) => c.group !== undefined))
    return `<g ${attributes} data-layer="${escape(l.name)}">${contourGroups(value)
      .map((contours) =>
        renderElement({ ...value, contours: contours.map(({ group, ...c }) => c) }, l, assets),
      )
      .join('')}</g>`;
  const fill = value.fill,
    stroke = value.stroke;
  if (fill) assertValue('Color', fill);
  if (stroke) {
    assertValue('Color', { hex: stroke.hex, alpha: stroke.alpha });
    if (!Number.isFinite(stroke.width) || stroke.width < 0 || stroke.width > 100000)
      throw Error('Invalid stroke width');
  }
  return `<path ${attributes} data-layer="${escape(l.name)}" d="${escape(pathData(value))}" fill="${fill ? escape(fill.hex) : 'none'}"${fill ? ` fill-opacity="${fill.alpha}"` : ''} fill-rule="nonzero"${stroke ? ` stroke="${escape(stroke.hex)}" stroke-opacity="${stroke.alpha}" stroke-width="${stroke.width}" stroke-linecap="${stroke.cap}" stroke-linejoin="${stroke.join}" stroke-miterlimit="${stroke.miterLimit}" stroke-dasharray="${stroke.dash.length ? stroke.dash.join(' ') : 'none'}" stroke-dashoffset="${stroke.dashOffset}"` : ''}/>`;
}
export function exportScene(doc, fonts = {}) {
  validate(doc);
  fonts = resolveFonts(doc, fonts);
  return doc.layers
    .filter((l) => l.visible && !l.guide)
    .map((l) => {
      const result = evaluate(l, fonts, doc.imageAssets);
      if (result.error) throw Error(`${l.name}: ${result.error}`);
      return { layer: l, value: result.path };
    });
}
export function exportSVG(doc, fonts = {}) {
  const scene = exportScene(doc, fonts);
  let bytes = 512;
  const elements = [];
  for (const { layer, value } of scene) {
    const element = renderElement(value, layer, doc.imageAssets);
    bytes += utf8ByteLength(element);
    if (bytes > MAX_PROJECT_BYTES)
      throw Error('SVG export exceeds 50 MB; reduce embedded image size or repetitions');
    elements.push(element);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">${elements.join('')}</svg>`;
}
export class History {
  constructor(doc) {
    this.past = [];
    this.future = [];
    this.doc = doc;
  }
  apply(fn) {
    let before = cloneDocument(this.doc);
    try {
      fn(this.doc);
    } catch (e) {
      this.doc = before;
      throw e;
    }
    if (sameDocument(before, this.doc)) return;
    this.record(before);
  }
  record(before) {
    this.past.push(before);
    this.future = [];
    const retainedFontBytes = () => {
      const data = new Set(
        [this.doc, ...this.past].flatMap((doc) =>
          [...Object.values(doc.fontAssets || {}), ...Object.values(doc.imageAssets || {})].map(
            (asset) => asset.data,
          ),
        ),
      );
      return [...data].reduce((sum, value) => sum + value.length * 0.75, 0);
    };
    while (this.past.length > 100 || (this.past.length > 1 && retainedFontBytes() > 96_000_000))
      this.past.shift();
  }
  undo() {
    if (this.past.length) {
      this.future.push(this.doc);
      this.doc = this.past.pop();
    }
  }
  redo() {
    if (this.future.length) {
      this.past.push(this.doc);
      this.doc = this.future.pop();
    }
  }
}
