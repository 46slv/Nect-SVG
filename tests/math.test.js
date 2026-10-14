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
