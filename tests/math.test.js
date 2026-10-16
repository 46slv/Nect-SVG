import test from 'node:test';
import assert from 'node:assert/strict';
import {
  document,
  node,
  connect,
  disconnect,
  evaluate,
  setOperation,
  activeParameters,
  outputType,
  outputPorts,
  serialize,
  deserialize,
  validate,
  History,
  exportSVG,
} from '../src/core.js';
function scene() {
  const doc = document(),
    l = doc.layers[0];
  const add = (type) => {
    const n = node(type);
    l.nodes.push(n);
    return n;
  };
  return { doc, l, add };
}
test('Math operations, bounded clamp, finite errors, zero division, and legacy Expression', () => {
  const { l, add } = scene(),
    m = add('Math');
  m.params.a.value = -6;
  m.params.b.value = 2;
  for (const [op, value] of Object.entries({
    add: -4,
    subtract: -8,
    multiply: -12,
    divide: -3,
    min: -6,
    max: 2,
    abs: 6,
    clamp: 0,
  })) {
    setOperation(l, m.id, op);
    assert.equal(evaluate(l).run(m.id), value);
  }
  m.params.min.value = 3;
  m.params.max.value = 2;
  assert.throws(() => evaluate(l).run(m.id), /minimum/);
  m.params.min.value = m.params.max.value = -6;
  assert.equal(evaluate(l).run(m.id), -6);
  setOperation(l, m.id, 'divide');
  m.params.b.value = 0;
  assert.equal(evaluate(l).run(m.id), 0);
  setOperation(l, m.id, 'multiply');
  m.params.a.value = Number.MAX_VALUE;
  m.params.b.value = 2;
  assert.throws(() => evaluate(l).run(m.id), /finite|Scalar/);
  m.params.a.value = Infinity;
  assert.throws(() => evaluate(l).run(m.id), /finite|Scalar/);
  const e = add('Expression');
  e.params.value.expression = '1/0';
  assert.throws(() => evaluate(l).run(e.id), /finite/);
  assert.throws(() => setOperation(l, m.id, 'sin'), /Invalid/);
});
test('only active inputs evaluate/cache; dormant sources and structural cycles are retained', () => {
  const { doc, l, add } = scene(),
    m = add('Math'),
    bad = add('Expression');
  bad.params.value.expression = '1/0';
  connect(l, bad.id, m.id, 'b');
  setOperation(l, m.id, 'abs');
  m.params.a.value = -12;
  connect(l, m.id, l.nodes.find((n) => n.type === 'Circle').id, 'radius');
  const first = evaluate(l);
  assert.equal(first.run(m.id), 12);
  assert.deepEqual(
    activeParameters(m).map(([k]) => k),
    ['a'],
  );
  bad.params.value.expression = 'sqrt(-1)';
  const next = evaluate(l);
  assert.equal(next.error, null);
  assert.equal(next.stats.computed, 0);
  assert.ok(next.stats.reused > 0);
  assert.equal(m.params.b.source, bad.id);
  assert.throws(() => connect(l, m.id, bad.id, 'value'), /cycle/);
  setOperation(l, m.id, 'add');
  const result = evaluate(l);
  assert.throws(() => result.run(m.id), /finite/);
  assert.throws(() => result.run(m.id), /finite/);
  assert.doesNotThrow(() => validate(doc));
});
test('Separate X/Y → Math → Combine preserves port identity through cache, history and JSON', () => {
  const { doc, l, add } = scene(),
    v = add('Vector'),
    s = add('Separate Vector'),
    m = add('Math'),
    c = add('Combine Vector');
  v.params.value.value = [10, 20];
  connect(l, v.id, s.id, 'vector');
  connect(l, s.id, m.id, 'a', false, 'x');
  m.params.b.value = 5;
  connect(l, m.id, c.id, 'x');
  connect(l, s.id, c.id, 'y', false, 'y');
  const shape = l.nodes.find((n) => n.type === 'Circle');
  connect(l, c.id, shape.id, 'center');
  assert.deepEqual(evaluate(l).run(c.id), [15, 20]);
  assert.equal(outputType(s, 'x'), 'Scalar');
  assert.equal(outputType(s), undefined);
  assert.deepEqual(
    outputPorts(s).map((p) => p.id),
    ['x', 'y'],
  );
  assert.throws(() => connect(l, s.id, m.id, 'a'), /Cannot connect/);
  assert.equal(m.params.a.sourcePort, 'x');
  assert.throws(() => connect(l, v.id, m.id, 'a', false, 'x'), /Cannot connect/);
  assert.throws(() => connect(l, s.id, v.id, 'value', false, 'y'), /Cannot connect/);
  v.params.value.value = [30, 40];
  assert.deepEqual(evaluate(l).run(c.id), [35, 40]);
  connect(l, s.id, m.id, 'a', false, 'y');
  assert.deepEqual(evaluate(l).run(c.id), [45, 40]);
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  assert.match(exportSVG(doc), /<svg/);
  const history = new History(doc);
  history.apply((d) =>
    disconnect(
      d.layers[0].nodes.find((n) => n.id === m.id),
      'a',
    ),
  );
  let q = history.doc.layers[0].nodes.find((n) => n.id === m.id).params.a;
  assert.equal(q.sourcePort, undefined);
  history.undo();
  q = history.doc.layers[0].nodes.find((n) => n.id === m.id).params.a;
  assert.equal(q.sourcePort, 'y');
  history.redo();
  assert.equal(history.doc.layers[0].nodes.find((n) => n.id === m.id).params.a.source, undefined);
  m.params.a.sourcePort = 'z';
  assert.throws(() => deserialize(serialize(doc)), /port/);
});
test('source beats expression, disconnect restores expression then fallback; point and dormant ports validate', () => {
  const { doc, l, add } = scene(),
    s = add('Separate Vector'),
    m = add('Math'),
    c = add('Combine Vector');
  s.params.vector.value = [3, 7];
  m.params.a.value = 99;
  m.params.a.expression = '2*4';
  connect(l, s.id, m.id, 'a', false, 'x');
  assert.equal(evaluate(l).run(m.id), 3);
  disconnect(m, 'a');
  assert.equal(evaluate(l).run(m.id), 8);
  m.params.a.expression = '';
  assert.equal(evaluate(l).run(m.id), 99);
  connect(l, s.id, m.id, 'b', false, 'y');
  setOperation(l, m.id, 'abs');
  m.params.b.locked = true;
  assert.doesNotThrow(() => validate(doc));
  connect(l, m.id, c.id, 'x');
  assert.throws(() => connect(l, c.id, s.id, 'vector'), /cycle/);
  assert.equal(s.params.vector.source, undefined);
  const curve = add('Curve');
  curve.points[0].position.source = s.id;
  curve.points[0].position.sourcePort = 'x';
  assert.throws(() => validate(doc), /Cannot connect/);
});

test('Vector Math operations return typed finite outputs and componentwise zero division', () => {
  const { l, add } = scene(),
    v = add('Vector Math');
  v.params.a.value = [3, 4];
  v.params.b.value = [2, 0];
  v.params.scale.value = 2;
  const expected = {
    add: [5, 4],
    subtract: [1, 4],
    multiply: [6, 0],
    divide: [1.5, 0],
    scale: [6, 8],
    normalize: [0.6, 0.8],
    length: 5,
    distance: Math.sqrt(17),
    dot: 6,
  };
  for (const [op, result] of Object.entries(expected)) {
    setOperation(l, v.id, op);
    assert.deepEqual(evaluate(l).run(v.id), result);
    assert.equal(outputType(v), Array.isArray(result) ? 'Vector2' : 'Scalar');
  }
  setOperation(l, v.id, 'normalize');
  v.params.a.value = [0, 0];
  assert.deepEqual(evaluate(l).run(v.id), [0, 0]);
  for (const value of [Number.MAX_VALUE, Number.MIN_VALUE]) {
    v.params.a.value = [value, value];
    const r = evaluate(l).run(v.id);
    assert.ok(r.every((x) => Math.abs(x - Math.SQRT1_2) < 1e-15));
  }
  setOperation(l, v.id, 'length');
  v.params.a.value = [3e200, 4e200];
  assert.ok(Math.abs(evaluate(l).run(v.id) / 5e200 - 1) < 1e-15);
  v.params.a.value = [Number.MAX_VALUE, Number.MAX_VALUE];
  assert.throws(() => evaluate(l).run(v.id), /Scalar|finite/);
  setOperation(l, v.id, 'scale');
  v.params.scale.value = 2;
  assert.throws(() => evaluate(l).run(v.id), /Vector2/);
  v.params.a.value = [Infinity, 1];
  assert.throws(() => evaluate(l).run(v.id), /Vector2/);
  assert.throws(() => setOperation(l, v.id, 'cross'), /Invalid/);
});
test('Vector Math output type changes reject every stored outgoing edge atomically', () => {
  const { doc, l, add } = scene(),
    v = add('Vector Math'),
    target = add('Vector Math');
  connect(l, v.id, target.id, 'b');
  setOperation(l, target.id, 'normalize');
  target.params.b.locked = true;
  const saved = serialize(doc);
  assert.throws(() => setOperation(l, v.id, 'length'), /break/);
  assert.equal(serialize(doc), saved);
  target.params.b.locked = false;
  disconnect(target, 'b');
  const curve = add('Curve');
  connect(l, v.id, curve.id, `${curve.points[0].id}.handleA`);
  curve.points[0].handleA.locked = true;
  assert.throws(() => setOperation(l, v.id, 'dot'), /break/);
  assert.equal(v.operation, 'add');
  curve.points[0].handleA.locked = false;
  disconnect(curve, `${curve.points[0].id}.handleA`);
  const remap = l.nodes.find((n) => n.type === 'Path Remap');
  remap.edits = [
    {
      pointId: 'test-point',
      params: {
        position: { type: 'Vector2', value: [0, 0], expression: '', locked: true, source: v.id },
      },
    },
  ];
  assert.throws(() => setOperation(l, v.id, 'distance'), /break/);
  remap.edits = [];
  setOperation(l, v.id, 'length');
  const math = add('Math');
  connect(l, v.id, math.id, 'b');
  setOperation(l, math.id, 'abs');
  math.params.b.locked = true;
  assert.throws(() => setOperation(l, v.id, 'normalize'), /break/);
  assert.equal(v.operation, 'length');
  setOperation(l, v.id, 'dot');
  assert.equal(math.params.b.source, v.id);
  assert.doesNotThrow(() => validate(doc));
  math.params.b.locked = false;
  disconnect(math, 'b');
  setOperation(l, v.id, 'normalize');
  assert.equal(outputType(v), 'Vector2');
});
test('Vector Math active dependencies, cache, source priority, history and roundtrip', () => {
  const { doc, l, add } = scene(),
    v = add('Vector Math'),
    bad = add('Vector'),
    scale = add('Value');
  v.params.a.value = [3, 4];
  bad.params.value.expression = '1/0;2';
  connect(l, bad.id, v.id, 'b');
  const circle = l.nodes.find((n) => n.type === 'Circle');
  connect(l, v.id, circle.id, 'center');
  setOperation(l, v.id, 'normalize');
  assert.equal(evaluate(l).error, null);
  bad.params.value.expression = 'sqrt(-1);0';
  assert.equal(evaluate(l).stats.computed, 0);
  assert.equal(v.params.b.source, bad.id);
  assert.throws(() => connect(l, v.id, bad.id, 'value'), /cycle/);
  setOperation(l, v.id, 'scale');
  scale.params.value.value = 2;
  connect(l, scale.id, v.id, 'scale');
  v.params.scale.expression = '3';
  v.params.scale.value = 4;
  assert.deepEqual(evaluate(l).run(v.id), [6, 8]);
  disconnect(v, 'scale');
  assert.deepEqual(evaluate(l).run(v.id), [9, 12]);
  v.params.scale.expression = '';
  assert.deepEqual(evaluate(l).run(v.id), [12, 16]);
  assert.equal(serialize(deserialize(serialize(doc))), serialize(doc));
  const h = new History(doc);
  h.apply((d) => setOperation(d.layers[0], v.id, 'normalize'));
  assert.equal(h.doc.layers[0].nodes.find((n) => n.id === v.id).operation, 'normalize');
  h.undo();
  assert.equal(h.doc.layers[0].nodes.find((n) => n.id === v.id).operation, 'scale');
  h.redo();
  assert.equal(h.doc.layers[0].nodes.find((n) => n.id === v.id).operation, 'normalize');
});
