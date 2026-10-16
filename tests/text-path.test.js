import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildTextPathSampler,
  sampleTextPath,
  projectTextPath,
  validateTextPathAttachment,
  validateTextPathMode,
} from '../src/text-path.js';
import {
  document,
  node,
  point,
  connect,
  clone,
  evaluate,
  setTextPathAttachment,
  assertTextPathChange,
  textPathTargets,
  History,
  serialize,
  deserialize,
  exportSVG,
  duplicateNodes,
  setCharacterStyles,
  setCharacterOffsets,
  setCharacterTransforms,
  enableRemapPoint,
} from '../src/core.js';
import { layoutText } from '../src/text-layout.js';
import { parseFont } from '../src/fonts.js';
const bytes = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
const font = parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const fonts = { default: font };
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const pair = (a, b, tolerance) => a.forEach((v, i) => near(v, b[i], tolerance));
const pt = (x, y, a = [0, 0], b = [0, 0]) => ({ position: [x, y], handleA: a, handleB: b });
const contour = (points, closed = false) => ({ id: 'path-contour', points, closed });
const line = contour([pt(0, 0), pt(600, 0)]);
const attachment = (extra = {}) => ({
  nodeId: 'path-node',
  contourId: 'path-contour',
  startMode: 'distance',
  start: 0,
  reversed: false,
  ...extra,
});
const flat = (text = 'A B', extra = {}) =>
  layoutText(font, text, { position: [0, 0], size: 40, ...extra });
function scene() {
  const doc = document(),
    l = doc.layers[0],
    t = node('Text'),
    c = node('Curve'),
    out = node('Output');
  doc.schemaVersion = 7;
  t.text = 'A B';
  t.params.size.value = 40;
  t.params.position.value = [150, 250];
  c.points = [point(0, 100), point(600, 100)];
  c.params.closed.value = false;
  l.nodes = [c, t, out];
  l.output = out.id;
  connect(l, t.id, out.id, 'path');
  const attach = (extra = {}) =>
    setTextPathAttachment(l, t.id, attachment({ nodeId: c.id, contourId: c.id, ...extra }), fonts);
  return { doc, l, t, c, out, attach };
}

test('sampler exact horizontal, vertical, reversed and outgoing/incoming knot oracles', () => {
  for (const points of [
    [pt(0, 0), pt(200, 0)],
    [pt(0, 0), pt(0, 200)],
  ]) {
    const s = buildTextPathSampler(contour(points)),
      vertical = points[1].position[0] === 0;
    near(s.length, 200);
    for (const d of [0, 50, 100, 200]) {
      pair(sampleTextPath(s, d).position, vertical ? [0, d] : [d, 0]);
      pair(sampleTextPath(s, d).tangent, vertical ? [0, 1] : [1, 0]);
      pair(sampleTextPath(s, d, true).position, vertical ? [0, 200 - d] : [200 - d, 0]);
      pair(sampleTextPath(s, d, true).tangent, vertical ? [0, -1] : [-1, 0]);
    }
    assert.throws(() => sampleTextPath(s, 201), /TEXT_PATH_RANGE/);
  }
  const s = buildTextPathSampler(contour([pt(0, 0), pt(100, 0), pt(100, 100)]));
  pair(sampleTextPath(s, 100).tangent, [0, 1]);
  pair(sampleTextPath(s, 100, true).tangent, [-1, 0]);
  pair(sampleTextPath(s, 200).tangent, [0, 1]);
});
test('curved position and analytic tangent match an independent 200000-step oracle', () => {
  const s = buildTextPathSampler(contour([pt(0, 0, [0, 0], [0, 90]), pt(200, 0, [0, 90])]));
  const at = (t) => [600 * (1 - t) * t * t + 200 * t ** 3, 270 * (1 - t) * t];
  const samples = [at(0)];
  let length = 0;
  for (let i = 1; i <= 200000; i++) {
    const p = at(i / 200000);
    length += Math.hypot(...p.map((v, k) => v - samples.at(-1)[k]));
    samples.push(p);
  }
  near(s.length, length, 0.05);
  for (const fraction of [0.01, 0.1, 0.37, 0.5, 0.9, 0.99]) {
    const wanted = length * fraction;
    let walked = 0,
      oracle,
      t;
    for (let i = 1; i < samples.length; i++) {
      const step = Math.hypot(...samples[i].map((v, k) => v - samples[i - 1][k]));
      if (walked + step >= wanted) {
        const ratio = (wanted - walked) / step;
        oracle = samples[i].map((v, k) => samples[i - 1][k] + (v - samples[i - 1][k]) * ratio);
        t = (i - 1 + ratio) / 200000;
        break;
      }
      walked += step;
    }
    const actual = sampleTextPath(s, wanted),
      d = [1200 * (1 - t) * t, 270 * (1 - 2 * t)],
      norm = Math.hypot(...d);
    pair(actual.position, oracle, 0.1);
    pair(
      actual.tangent,
      d.map((v) => v / norm),
      1e-4,
    );
  }
});
test('closed seam wraps, preserves directed knots and rejects invalid/budgeted geometry', () => {
  const s = buildTextPathSampler(contour([pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)], true));
  pair(sampleTextPath(s, 450).position, [50, 0]);
  pair(sampleTextPath(s, -50).position, [0, 50]);
  pair(sampleTextPath(s, 0, true).tangent, [0, 1]);
  assert.throws(() => buildTextPathSampler(contour([pt(0, 0), pt(0, 0)])), /ZERO_LENGTH/);
  assert.throws(() => buildTextPathSampler(contour([pt(0, 0), pt(Infinity, 0)])), /NONFINITE/);
  assert.throws(
    () => buildTextPathSampler(contour(Array.from({ length: 4098 }, (_, i) => pt(i, 0)))),
    /BUDGET/,
  );
  assert.throws(
    () => buildTextPathSampler(contour([pt(0, 0, [0, 0], [0, 1e20]), pt(1e20, 0, [0, 1e20])])),
    /BUDGET/,
  );
});
test('flat projection preserves shaped geometry, kerning, whitespace, ligatures and advances', () => {
  for (const text of ['AV A ', 'ffi', '   ', '']) {
    const layout = flat(text),
      projected = projectTextPath(layout, line, attachment());
    assert.deepEqual(projected.advances, layout.advances);
    assert.equal(projected.path.commands.length, layout.path.commands.length);
    layout.path.commands.forEach((command, i) => {
      for (const [key, value] of Object.entries(command))
        if (key !== 'type') near(projected.path.commands[i][key], value);
    });
    assert.equal(projected.placements.length, layout.glyphs.length);
    assert.deepEqual(
      projected.characters.map((c) => c.id),
      layout.characters.map((c) => c.id),
    );
  }
});
test('start/center/end and normalized/reverse use advance span, with explicit whitespace overflow', () => {
  const layout = flat('A B '),
    span = Math.max(...layout.glyphs.map((g) => g.x + g.advance));
  for (const [alignment, expected] of [
    ['start', 300],
    ['center', 300 - span / 2],
    ['end', 300 - span],
  ]) {
    const p = projectTextPath(
      layout,
      line,
      attachment({ startMode: 'normalized', start: 0.5 }),
      alignment,
    );
    pair(p.placements[0].baseline, [expected, 0]);
  }
  pair(
    projectTextPath(layout, line, attachment({ reversed: true })).placements[0].baseline,
    [600, 0],
  );
  assert.throws(() => projectTextPath(flat('A'.repeat(100)), line, attachment()), /OVERFLOW/);
  assert.throws(() => projectTextPath(flat(' '.repeat(100)), line, attachment()), /OVERFLOW/);
  assert.throws(() => projectTextPath(layout, line, attachment(), 'center'), /OVERFLOW/);
  assert.throws(() => projectTextPath(layout, line, attachment({ start: -1 })), /OVERFLOW/);
  const closed = contour([pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)], true);
  assert.ok(projectTextPath(layout, closed, attachment({ start: 395 })).path.commands.length);
  assert.throws(() => projectTextPath(flat('A'.repeat(100)), closed, attachment()), /OVERFLOW/);
});
test('typography reflows first; shape transforms/XY project rigidly in the tangent frame without reflow', () => {
  let record = setCharacterStyles('A B', undefined, {
    c1: { width: 1.5, height: 0.7, baselineShift: 8, tracking: 7 },
    c2: { width: 2 },
    c3: { size: 65 },
  });
  record = setCharacterOffsets('A B', record, { c1: [9, -4] });
  record = setCharacterTransforms('A B', record, { c1: { rotation: 30, scale: 1.4 } });
  const layout = flat('A B', { characterPositions: record }),
    p = projectTextPath(layout, contour([pt(20, 0), pt(20, 600)]), attachment());
  assert.deepEqual(p.advances, layout.advances);
  for (let i = 0; i < layout.path.commands.length; i++)
    for (const suffix of ['', '1', '2']) {
      const c = layout.path.commands[i],
        projected = p.path.commands[i];
      if ('x' + suffix in c)
        pair(
          [projected['x' + suffix], projected['y' + suffix]],
          [20 - c['y' + suffix], c['x' + suffix]],
        );
    }
  assert.deepEqual(
    p.characters.map((c) => c.id),
    ['c1', 'c2', 'c3'],
  );
  assert.deepEqual(p.characters[0].offset, [9, -4]);
  assert.equal(p.characters[0].rotation, 30);
  assert.equal(p.characters[0].scale, 1.4);
  assert.equal(p.characters[1].whitespace, true);
});
test('attachment validation rejects malformed settings, multiline, vertical and RTL explicitly', () => {
  for (const patch of [
    { nodeId: null },
    { contourId: '' },
    { start: NaN },
    { start: 100001 },
    { startMode: 'percent' },
    { reversed: 1 },
    { bad: true },
  ])
    assert.throws(() => validateTextPathAttachment(attachment(patch)), /ATTACHMENT/);
  assert.throws(() => validateTextPathMode('A\nB'), /MULTILINE/);
  assert.throws(() => validateTextPathMode('A\u2028B'), /MULTILINE/);
  assert.throws(() => validateTextPathMode('A', 'vertical-rl'), /MODE/);
  assert.throws(() => validateTextPathMode('אבג'), /DIRECTION/);
});
test('retained lifecycle: exact IDs/styles/content, one-step undo/redo, cold reopen, SVG, detach', () => {
  const { doc, l, t, c, attach } = scene();
  t.characterPositions = setCharacterStyles(t.text, undefined, { c2: { width: 1.5 } });
  const h = new History(doc),
    before = serialize(doc),
    flatPath = exportSVG(doc, fonts);
  h.apply(() => attach());
  const saved = serialize(h.doc),
    attachedSVG = exportSVG(h.doc, fonts);
  assert.equal(t.text, 'A B');
  assert.deepEqual(t.params.position.value, [150, 250]);
  assert.equal(t.pathAttachment.contourId, c.id);
  assert.equal(h.past.length, 1);
  h.undo();
  assert.equal(serialize(h.doc), before);
  h.redo();
  assert.equal(serialize(h.doc), saved);
  const reopened = deserialize(saved);
  assert.equal(serialize(reopened), saved);
  assert.equal(exportSVG(reopened, fonts), attachedSVG);
  const layer = h.doc.layers[0];
  h.apply(() => setTextPathAttachment(layer, t.id, null, fonts));
  assert.equal(exportSVG(h.doc, fonts), flatPath);
  assert.equal(layer.nodes.find((n) => n.id === t.id).pathAttachment, undefined);
  assert.equal(h.past.length, 2);
  const old = JSON.parse(before);
  old.schemaVersion = 6;
  assert.equal(
    deserialize(JSON.stringify(old)).layers[0].nodes.find((n) => n.id === t.id).pathAttachment,
    undefined,
  );
  const illegal = JSON.parse(saved);
  illegal.schemaVersion = 6;
  assert.throws(() => deserialize(JSON.stringify(illegal)), /schemaVersion 7/);
});
test('path edits/transforms invalidate cache and shared projection; disconnected Text Position stays authored', () => {
  const { l, t, c, attach } = scene();
  attach();
  const first = evaluate(l, fonts).textLayout(t.id);
  pair(first.placements[0].baseline, [0, 100]);
  c.points[1].position.value = [0, 700];
  const second = evaluate(l, fonts).textLayout(t.id);
  pair(second.placements[0].baseline, [0, 100]);
  pair(second.placements[0].tangent, [0, 1]);
  const transform = node('Transform');
  l.nodes.push(transform);
  connect(l, c.id, transform.id, 'path');
  transform.params.offset.value = [50, 20];
  transform.params.rotation.value = 90;
  setTextPathAttachment(l, t.id, { ...t.pathAttachment, nodeId: transform.id }, fonts);
  const third = evaluate(l, fonts);
  pair(third.textLayout(t.id).placements[0].baseline, [-50, 20]);
  pair(third.textLayout(t.id).placements[0].tangent, [-1, 0]);
  pair(third.run(t.id, 'position'), [150, 250]);
  const oldPath = third.textLayout(t.id);
  t.params.position.value = [999, 555];
  assert.deepEqual(evaluate(l, fonts).textLayout(t.id), oldPath);
});
test('wrong, stale, cross-layer, cyclic and unstable sources reject atomically; no first-contour fallback', () => {
  const { doc, l, t, c, attach } = scene();
  const before = serialize(doc);
  for (const patch of [
    { nodeId: 'missing' },
    { contourId: 'stale' },
    { nodeId: t.id },
    { nodeId: l.output },
  ]) {
    assert.throws(() => attach(patch));
    assert.equal(serialize(doc), before);
  }
  const imported = node('Imported Path');
  imported.rawPath = 'M0 0L100 0L100 100Z';
  l.nodes.push(imported);
  assert.throws(() => attach({ nodeId: imported.id, contourId: `${imported.id}:c0` }), /UNSTABLE/);
  const transform = node('Transform');
  l.nodes.push(transform);
  connect(l, t.id, transform.id, 'path');
  assert.throws(() => attach({ nodeId: transform.id, contourId: c.id }), /cycle/);
  attach();
  const saved = serialize(doc);
  const copy = JSON.parse(saved),
    other = clone(copy.layers[0]);
  other.id = 'other-layer';
  other.nodes = [other.nodes[0]];
  copy.layers[0].nodes = copy.layers[0].nodes.filter((n) => n.id !== c.id);
  copy.layers.push(other);
  assert.throws(() => deserialize(JSON.stringify(copy)));
  l.nodes.reverse();
  c.name = 'Renamed';
  assert.equal(evaluate(l, fonts).error, null);
});
test('source deletion, overflow, vertical/multiline and source point edits rollback document and history', () => {
  const { doc, attach, t, c } = scene();
  attach();
  const h = new History(doc);
  const edit = (fn) =>
    h.apply((d) => {
      const l = d.layers[0],
        before = clone(l);
      fn(l);
      assertTextPathChange(l, before, fonts);
    });
  for (const fn of [
    (l) => {
      l.nodes = l.nodes.filter((n) => n.id !== c.id);
    },
    (l) => {
      l.nodes.find((n) => n.id === t.id).text = 'X'.repeat(100);
    },
    (l) => {
      l.nodes.find((n) => n.id === t.id).writingMode = 'vertical-rl';
    },
    (l) => {
      l.nodes.find((n) => n.id === t.id).text = 'A\nB';
    },
    (l) => {
      l.nodes.find((n) => n.id === c.id).points[1].position.value = [1, 100];
    },
  ]) {
    const before = serialize(h.doc);
    assert.throws(() => edit(fn));
    assert.equal(serialize(h.doc), before);
    assert.equal(h.past.length, 0);
  }
  edit((l) => {
    l.nodes = l.nodes.filter((n) => ![c.id, t.id].includes(n.id));
  });
  assert.equal(h.past.length, 1);
});
test('valid Path Remap is sampled; stale edits reject; nonzero Offset remains unstable, zero is passthrough', () => {
  const { l, t, c, attach } = scene();
  const remap = node('Path Remap');
  l.nodes.push(remap);
  connect(l, c.id, remap.id, 'path');
  const input = evaluate(l, fonts).run(c.id),
    edit = enableRemapPoint(remap, input, c.points[0].id);
  edit.params.position.value = [0, -50];
  attach({ nodeId: remap.id });
  assert.ok(evaluate(l, fonts).textLayout(t.id).placements[0].tangent[1] > 0);
  remap.edits[0].pointId = 'stale';
  assert.match(evaluate(l, fonts).error, /REMAP/);
  remap.edits = [];
  const rect = node('Rectangle'),
    off = node('Closed Path Offset');
  l.nodes.push(rect, off);
  connect(l, rect.id, off.id, 'path');
  off.params.amount.value = 0;
  setTextPathAttachment(l, t.id, attachment({ nodeId: off.id, contourId: `${rect.id}:c0` }), fonts);
  assert.equal(evaluate(l, fonts).error, null);
  off.params.amount.value = 10;
  assert.match(evaluate(l, fonts).error, /UNSTABLE/);
  assert.equal(
    textPathTargets(l, t.id, fonts).some((t) => t.nodeId === off.id),
    false,
  );
});
test('duplication remaps selected path and text identities; copying either alone keeps original attachment semantics', () => {
  const { l, t, c, attach } = scene();
  attach();
  const copies = duplicateNodes(l, [t.id, c.id]),
    copiedText = copies.find((n) => n.type === 'Text'),
    copiedCurve = copies.find((n) => n.type === 'Curve');
  assert.equal(copiedText.pathAttachment.nodeId, copiedCurve.id);
  assert.equal(copiedText.pathAttachment.contourId, copiedCurve.id);
  assert.equal(evaluate(l, fonts).run(copiedText.id).contours.length > 0, true);
  assert.equal(duplicateNodes(l, [t.id])[0].pathAttachment.nodeId, c.id);
  duplicateNodes(l, [c.id]);
  assert.equal(t.pathAttachment.nodeId, c.id);
});

test('duplicate contour remapping follows the selected reference route, never an unrelated selected generator', () => {
  const { l, t, c, attach } = scene(),
    transform = node('Transform');
  l.nodes.push(transform);
  connect(l, c.id, transform.id, 'path');
  attach({ nodeId: transform.id });
  const detachedRoute = duplicateNodes(l, [t.id, c.id]).find((n) => n.type === 'Text');
  assert.equal(detachedRoute.pathAttachment.nodeId, transform.id);
  assert.equal(detachedRoute.pathAttachment.contourId, c.id);
  assert.ok(evaluate(l, fonts).run(detachedRoute.id).contours.length);
  const half = duplicateNodes(l, [t.id, transform.id]),
    halfText = half.find((n) => n.type === 'Text');
  assert.equal(halfText.pathAttachment.contourId, c.id);
  assert.ok(evaluate(l, fonts).run(halfText.id).contours.length);
  const all = duplicateNodes(l, [t.id, transform.id, c.id]),
    allText = all.find((n) => n.type === 'Text'),
    allCurve = all.find((n) => n.type === 'Curve');
  assert.equal(allText.pathAttachment.contourId, allCurve.id);
  assert.ok(evaluate(l, fonts).run(allText.id).contours.length);
});
test('mixed Japanese and Latin shaping/styles retain their own advances and IDs through projection', () => {
  const data = fs.readFileSync(
      new URL('./fixtures/fonts/NectJPFixture-Regular.otf', import.meta.url),
    ),
    jp = parseFont(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  const record = setCharacterStyles('A日 A', undefined, {
    c2: { font: 'font-jp', size: 64, width: 1.2 },
    c3: { width: 2 },
  });
  const layout = flat('A日 A', { characterPositions: record, fonts: { ...fonts, 'font-jp': jp } }),
    projected = projectTextPath(layout, line, attachment());
  assert.deepEqual(projected.advances, layout.advances);
  assert.equal(projected.characters[1].font, 'font-jp');
  assert.equal(projected.characters[2].whitespace, true);
  assert.deepEqual(
    projected.characters.map((c) => c.id),
    ['c1', 'c2', 'c3', 'c4'],
  );
});

test('exact reversing cusps reject numerical tangent roundoff; stationary monotone inflections remain resolvable', () => {
  for (const scale of [1e-5, 1, 1e4]) {
    const cusp = buildTextPathSampler(
      contour([pt(0, 0, [0, 0], [100 * scale, 100 * scale]), pt(0, 0, [100 * scale, 100 * scale])]),
    );
    for (const reverse of [false, true])
      assert.throws(() => sampleTextPath(cusp, cusp.length / 2, reverse), /TEXT_PATH_TANGENT/);
  }
  const monotone = buildTextPathSampler(
    contour([pt(0, 0, [0, 0], [100, 0]), pt(100, 0, [-100, 0])]),
  );
  const middle = sampleTextPath(monotone, monotone.length / 2);
  pair(middle.position, [50, 0]);
  pair(middle.tangent, [1, 0]);
  pair(sampleTextPath(monotone, monotone.length / 2, true).tangent, [-1, 0]);
});
test('negative tracking never silently shifts first-advance start alignment', () => {
  const layout = flat('AB', { letterSpacing: -100 });
  assert.ok(layout.glyphs[1].x < 0);
  assert.throws(() => projectTextPath(layout, line, attachment()), /TEXT_PATH_OVERFLOW/);
  const projected = projectTextPath(layout, line, attachment({ start: 150 }));
  pair(projected.placements[0].baseline, [150, 0]);
});

test('a non-midpoint reversing cusp is rejected at its analytic arc distance', () => {
  // B(t) = (60t - 100t², 60t - 100t²), stationary at t=.3, B(.3)=(9,9).
  const s = buildTextPathSampler(
    contour([pt(0, 0, [0, 0], [20, 20]), pt(-40, -40, [140 / 3, 140 / 3])]),
  );
  near(s.length, 58 * Math.SQRT2);
  assert.throws(() => sampleTextPath(s, 9 * Math.SQRT2), /TEXT_PATH_TANGENT/);
  assert.throws(() => sampleTextPath(s, 49 * Math.SQRT2, true), /TEXT_PATH_TANGENT/);
});

test('two-axis cusp roots survive ill-conditioned double roots and asymmetric positions at multiple scales', () => {
  for (const r of [0.001, 0.13, 0.8, 0.999])
    for (const scale of [0.001, 1, 10000]) {
      const controls = [
        [r * r, -(r ** 3)],
        [r * r - (2 * r) / 3, -(r ** 3) + r * r],
        [r * r - (4 * r) / 3 + 1 / 3, -(r ** 3) + 2 * r * r - r],
        [(1 - r) ** 2, (1 - r) ** 3],
      ].map((p) => p.map((v) => v * scale));
      const c = contour([
        pt(
          ...controls[0],
          [0, 0],
          controls[1].map((v, i) => v - controls[0][i]),
        ),
        pt(
          ...controls[3],
          controls[2].map((v, i) => v - controls[3][i]),
        ),
      ]);
      const s = buildTextPathSampler(c),
        cuspDistance = (((4 + 9 * r * r) ** 1.5 - 8) / 27) * scale;
      assert.equal(s.stationary.length, 1, `stationary root r=${r}, scale=${scale}`);
      near(s.stationary[0].distance, cuspDistance, 0.05);
      assert.throws(
        () => sampleTextPath(s, s.stationary[0].distance),
        /TEXT_PATH_TANGENT/,
        `forward cusp r=${r}, scale=${scale}`,
      );
      assert.throws(
        () => sampleTextPath(s, s.length - s.stationary[0].distance, true),
        /TEXT_PATH_TANGENT/,
        `reverse cusp r=${r}, scale=${scale}`,
      );
    }
});
