import paper from 'paper';
const scope = new paper.PaperScope();
scope.setup(new scope.Size(1200, 800));
export const clone = (x) => structuredClone(x);
export const uid = (prefix = 'id') => `${prefix}-${globalThis.crypto.randomUUID()}`;
const p = (type, value) => ({ type, value, expression: '', locked: false });
export const definitions = {
  Circle: { center: p('Vector2', [350, 250]), radius: p('Scalar', 120) },
  Ellipse: { center: p('Vector2', [350, 250]), size: p('Vector2', [240, 160]) },
  Rectangle: { center: p('Vector2', [460, 250]), size: p('Vector2', [180, 220]) },
  Curve: { closed: p('Boolean', true) },
  Boolean: { a: p('Path', null), b: p('Path', null) },
  'Convert to Path': { path: p('Path', null) },
  'Path Remap': { path: p('Path', null), offset: p('Vector2', [0, 0]) },
  Transform: {
    path: p('Path', null),
    offset: p('Vector2', [0, 0]),
    scale: p('Scalar', 1),
    rotation: p('Scalar', 0),
  },
  Value: { value: p('Scalar', 100) },
  Vector: { value: p('Vector2', [300, 250]) },
  Expression: { value: p('Scalar', 100) },
  Output: { path: p('Path', null) },
  Text: { position: p('Vector2', [200, 300]), size: p('Scalar', 100) },
  'Text to Path': { path: p('Path', null) },
  'Imported Path': {},
};
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
    params: clone(definitions[type]),
    points: type === 'Curve' ? [point(250, 150), point(450, 150), point(350, 350)] : [],
    operation: 'subtract',
    edits: [],
    text: 'Nect',
    font: 'default',
    rawPath: '',
  };
}
export function layer(name = 'Composition 1') {
  let a = node('Circle', 40, 50),
    b = node('Rectangle', 40, 280),
    op = node('Boolean', 330, 50),
    remap = node('Path Remap', 620, 50),
    out = node('Output', 920, 50);
  op.params.a.source = a.id;
  op.params.b.source = b.id;
  remap.params.path.source = op.id;
  out.params.path.source = remap.id;
  return {
    id: uid('layer'),
    name,
    visible: true,
    locked: false,
    fill: '#36434e',
    nodes: [a, b, op, remap, out],
    output: out.id,
  };
}
export function document() {
  return {
    schemaVersion: 1,
    name: 'Untitled composition',
    width: 960,
    height: 540,
    layers: [layer()],
  };
}
export function outputType(n) {
  return n.type === 'Value' || n.type === 'Expression'
    ? 'Scalar'
    : n.type === 'Vector'
      ? 'Vector2'
      : 'Path';
}
export function parameters(n) {
  const entries = Object.entries(n.params);
  for (const pt of n.points)
    for (const key of ['position', 'handleA', 'handleB'])
      entries.push([`${pt.id}.${key}`, pt[key]]);
  return entries;
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
    path.contours.map((c) => [c.closed, c.points.map((p) => [p.position, p.handleA, p.handleB])]),
  );
}
export function pathData(path) {
  const obj = toPaper(path);
  const result = obj.pathData;
  obj.remove();
  return result;
}
export function pathArea(path) {
  const obj = toPaper(path);
  obj.reorient(true, true);
  const area = Math.abs(obj.area);
  obj.remove();
  return area;
}
const evaluationCaches = new WeakMap();
let revision = 0;
export function evaluate(layer, fonts = {}) {
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
  function run(id) {
    if (values.has(id)) return values.get(id);
    if (active.has(id)) throw Error('Cycle detected');
    if (active.size >= 256) throw Error('Graph depth exceeds 256 nodes');
    let n = byId.get(id);
    if (!n) throw Error('Missing source node');
    active.add(id);
    const deps = parameters(n)
      .filter(([, q]) => q.source)
      .map(([, q]) => q.source);
    for (const dep of deps) run(dep);
    const cacheKey = JSON.stringify([
      n.type,
      n.params,
      n.points,
      n.operation,
      n.edits,
      n.text,
      n.font,
      n.rawPath,
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
      let value = q.source
        ? run(q.source)
        : q.expression
          ? q.type === 'Vector2'
            ? q.expression.split(';').map(expression)
            : expression(q.expression)
          : clone(q.value);
      if (q.source && outputType(byId.get(q.source)) !== q.type)
        throw Error('Incompatible socket types');
      assertValue(q.type, value);
      return value;
    }
    let result;
    if (['Value', 'Vector', 'Expression'].includes(n.type)) result = read('value');
    else if (n.type === 'Circle' || n.type === 'Ellipse' || n.type === 'Rectangle') {
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
      let pos = read('position'),
        d = font.getPath(n.text, pos[0], pos[1], read('size')).toPathData(5);
      let item = new scope.CompoundPath({ pathData: d, insert: false });
      result = fromPaper(item, n.id);
      result.unstable = true;
      result.fingerprint = signature(result);
      item.remove();
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
      let pa = toPaper(a),
        pb = toPaper(b);
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
      if (!result) throw Error('Connect a Path input');
      result = clone(result);
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
          for (const key of ['position', 'handleA', 'handleB'])
            if (edit[key]) pt[key] = pt[key].map((v, i) => v + edit[key][i]);
        }
      } else if (n.type === 'Transform') {
        let obj = toPaper(result);
        obj.scale(read('scale'), [0, 0]);
        obj.rotate(read('rotation'), [0, 0]);
        obj.translate(read('offset'));
        let transformed = fromPaper(obj, n.id);
        transformed.contours.forEach((c, ci) => {
          c.id = result.contours[ci].id;
          c.points.forEach((p, pi) => (p.id = result.contours[ci].points[pi].id));
        });
        transformed.unstable = result.unstable;
        transformed.fingerprint = result.fingerprint;
        result = transformed;
        obj.remove();
      }
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
export function connect(layer, sourceId, targetId, key, validating = false) {
  let from = layer.nodes.find((n) => n.id === sourceId),
    to = layer.nodes.find((n) => n.id === targetId),
    q = to && parameter(to, key);
  if (!from || !q) throw Error('Missing socket');
  if (q.locked && !validating) throw Error('Parameter is locked');
  if (outputType(from) !== q.type) throw Error(`Cannot connect ${outputType(from)} to ${q.type}`);
  const old = q.source;
  q.source = sourceId;
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
    throw e;
  }
}
export function disconnect(n, key) {
  const q = parameter(n, key);
  if (q.locked) throw Error('Parameter is locked');
  delete q.source;
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
  function param(q, type) {
    if (!q || q.type !== type) throw Error('Invalid parameter type');
    assertValue(type, q.value);
    if (type === 'Path' && q.value !== null) throw Error('Path fallback must be null');
    text(q.expression);
    if (typeof q.locked !== 'boolean') throw Error('Invalid lock state');
    if (q.source !== undefined && (typeof q.source !== 'string' || !idPattern.test(q.source)))
      throw Error('Invalid source ID');
  }
  if (!doc || doc.schemaVersion !== 1) throw Error('Unsupported project version');
  text(doc.name);
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
      !/^#[0-9a-fA-F]{6}$/.test(l.fill)
    )
      throw Error('Invalid layer state');
    if (!Array.isArray(l.nodes) || l.nodes.length > 2000) throw Error('Invalid composition');
    for (const n of l.nodes) {
      id(n.id);
      text(n.name);
      vec(n.position);
      text(n.text);
      text(n.font);
      if (n.rawPath !== undefined) text(n.rawPath);
      if (n.type === 'Imported Path') parsePath(n.rawPath, n.id);
      if (
        !Object.hasOwn(definitions, n.type) ||
        !n.params ||
        !Array.isArray(n.points) ||
        !Array.isArray(n.edits)
      )
        throw Error('Invalid node');
      if (!['union', 'subtract', 'intersect', 'difference'].includes(n.operation))
        throw Error('Invalid Boolean operation');
      if (Object.keys(n.params).length !== Object.keys(definitions[n.type]).length)
        throw Error('Unexpected parameter');
      for (const [key, def] of Object.entries(definitions[n.type])) param(n.params[key], def.type);
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
        for (const k of ['position', 'handleA', 'handleB']) if (edit[k] !== undefined) vec(edit[k]);
      }
    }
    if (!l.nodes.some((n) => n.id === l.output && n.type === 'Output'))
      throw Error('Missing Output node');
    for (const n of l.nodes)
      for (const [key, q] of parameters(n)) if (q.source) connect(l, q.source, n.id, key, true);
  }
  return doc;
}
export function serialize(doc) {
  return JSON.stringify(doc, null, 2);
}
export function deserialize(text) {
  if (text.length > 10000000) throw Error('Project exceeds 10 MB');
  return validate(JSON.parse(text));
}
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
  );
export function exportSVG(doc, fonts = {}) {
  let paths = [];
  for (const l of doc.layers) {
    if (!l.visible) continue;
    let r = evaluate(l, fonts);
    if (r.error) throw Error(`${l.name}: ${r.error}`);
    paths.push(
      `<path data-layer="${escape(l.name)}" d="${escape(pathData(r.path))}" fill="${escape(l.fill)}" fill-rule="nonzero"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">${paths.join('')}</svg>`;
}
export class History {
  constructor(doc) {
    this.past = [];
    this.future = [];
    this.doc = doc;
  }
  apply(fn) {
    let before = clone(this.doc);
    try {
      fn(this.doc);
    } catch (e) {
      this.doc = before;
      throw e;
    }
    if (JSON.stringify(before) === JSON.stringify(this.doc)) return;
    this.past.push(before);
    if (this.past.length > 100) this.past.shift();
    this.future = [];
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
