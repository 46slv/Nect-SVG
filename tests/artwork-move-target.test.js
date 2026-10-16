import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { document, node, point, connect, evaluate, pathBounds } from '../src/core.js';
import { parseFont } from '../src/fonts.js';
import {
  resolveArtworkMoveTarget,
  CURVE_ARTWORK_MOVE_POINT_LIMIT,
} from '../src/artwork-move-target.js';

const bytes = fs.readFileSync(new URL('../public/fonts/DejaVuSans.ttf', import.meta.url));
const fonts = {
  default: parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
};
const image = {
  name: 'red.png',
  mime: 'image/png',
  width: 1,
  height: 1,
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
};
function fixture(type = 'Rectangle', transformed = false) {
  const doc = document(),
    layer = doc.layers[0],
    generator = node(type, 73, 59),
    fill = type === 'Image' ? null : node('Fill', 430, 83),
    transform = transformed ? node('Transform', 301, 161) : null,
    output = node(type === 'Image' ? 'Image Output' : 'Output', 709, 121);
  layer.nodes = [generator, ...(transform ? [transform] : []), ...(fill ? [fill] : []), output];
  layer.output = output.id;
  if (type === 'Image') {
    generator.asset = 'image-test';
    doc.imageAssets = { 'image-test': { ...image } };
    connect(layer, generator.id, output.id, 'path');
  } else {
    if (transform) connect(layer, generator.id, transform.id, 'path');
    connect(layer, (transform || generator).id, fill.id, 'path');
    connect(layer, fill.id, output.id, 'path');
  }
  return { doc, layer, generator, transform, fill, output };
}
const resolve = (f, options = { fonts }) => resolveArtworkMoveTarget(f.doc, f.layer.id, options);
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.00003, `${a} != ${b}`);
function refuse(f, code) {
  const before = structuredClone(f.doc),
    result = resolve(f);
  assert.equal(result.supported, false);
  assert.equal(result.code, code);
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length);
  assert.equal(result.target, undefined);
  assert.deepEqual(f.doc, before);
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
// Test-only application: the production resolver never writes or owns History.
function translatedDocument(doc, target, delta) {
  const copy = structuredClone(doc),
    layer = copy.layers.find((l) => l.id === target.layerId),
    n = layer.nodes.find((n) => n.id === target.nodeId);
  if (target.kind === 'curve-point-positions')
    target.pointIds.forEach((id, i) => {
      n.points.find((pt) => pt.id === id).position.value = target.positions[i].map(
        (v, axis) => v + delta[axis],
      );
    });
  else n.params[target.parameter].value = target.value.map((v, axis) => v + delta[axis]);
  return copy;
}
function proveTranslation(f, delta = [17.25, -31.5]) {
  const beforeDoc = structuredClone(f.doc),
    result = resolve(f);
  assert.equal(result.supported, true, result.reason);
  const before = evaluate(f.layer, fonts, f.doc.imageAssets).path,
    afterDoc = translatedDocument(f.doc, result.target, delta),
    afterLayer = afterDoc.layers.find((l) => l.id === f.layer.id),
    after = evaluate(afterLayer, fonts, afterDoc.imageAssets).path;
  if (before.kind === 'image') {
    assert.equal(after.asset, before.asset);
    assert.deepEqual(after.size, before.size);
    after.position.forEach((v, axis) => near(v, before.position[axis] + delta[axis]));
  } else {
    assert.deepEqual(after.fill, before.fill);
    assert.deepEqual(after.stroke, before.stroke);
    assert.equal(after.contours.length, before.contours.length);
    for (const [ci, contour] of before.contours.entries()) {
      assert.equal(after.contours[ci].id, contour.id);
      for (const [pi, point] of contour.points.entries()) {
        const next = after.contours[ci].points[pi];
        assert.equal(next.id, point.id);
        for (let axis = 0; axis < 2; axis++) {
          near(next.position[axis], point.position[axis] + delta[axis]);
          near(next.handleA[axis], point.handleA[axis]);
          near(next.handleB[axis], point.handleB[axis]);
        }
      }
    }
  }
  for (let axis = 0; axis < 2; axis++)
    pathBounds(before)[axis].forEach((v, i) => near(pathBounds(after)[axis][i], v + delta[axis]));
  // Revert the one described value, then prove all graph cards, connections,
  // authored paint, unrelated layers and every other field stayed identical.
  const restored = afterLayer.nodes.find((n) => n.id === result.target.nodeId);
  if (result.target.kind === 'curve-point-positions')
    restored.points.forEach((pt, i) => {
      pt.position.value = [...result.target.positions[i]];
    });
  else restored.params[result.target.parameter].value = [...result.target.value];
  assert.deepEqual(afterDoc, beforeDoc);
  assert.deepEqual(f.doc, beforeDoc);
  return result.target;
}

test('descriptor identifies the final artwork by stable IDs and a parameter path, not node order', () => {
  const f = fixture(),
    unrelated = node('Null', 13, 19);
  unrelated.params.position.value = [999, -888];
  f.layer.nodes = [unrelated, f.output, f.fill, f.generator];
  const expected = {
    supported: true,
    bounds: pathBounds(evaluate(f.layer, fonts, f.doc.imageAssets).path),
    target: {
      scope: 'artwork',
      kind: 'shape-center',
      layerId: f.layer.id,
      outputNodeId: f.output.id,
      nodeId: f.generator.id,
      parameter: 'center',
      parameterType: 'Vector2',
      parameterPath: ['params', 'center', 'value'],
      coordinateSpace: 'artboard',
      value: [...f.generator.params.center.value],
      route: [f.generator, f.fill, f.output].map((n) => ({ nodeId: n.id, type: n.type })),
    },
  };
  assert.deepEqual(resolve(f), expected);
  f.layer.nodes.reverse();
  assert.deepEqual(resolve(f), expected);
  f.generator.name = 'An unrelated name';
  f.fill.name = 'Not a type identifier';
  assert.deepEqual(resolve(f), expected);
  refuse({ ...f, layer: { id: f.generator.id } }, 'missing-artwork');
  proveTranslation(f);
});

for (const type of ['Circle', 'Ellipse', 'Rectangle', 'Polygon', 'Star', 'Text', 'Image'])
  test(`${type} descriptor translates the complete final output without other edits`, () => {
    const f = fixture(type);
    f.doc.layers.push(document().layers[0]);
    if (type !== 'Text') f.generator.positionReference = 'right-bottom';
    if (f.fill) f.fill.params.color.value = { hex: '#123456', alpha: 0.6 };
    const target = proveTranslation(f, [-52.125, 83.75]);
    assert.equal(target.parameter, ['Image', 'Text'].includes(type) ? 'position' : 'center');
    assert.equal(
      target.kind,
      type === 'Image' ? 'image-position' : type === 'Text' ? 'text-position' : 'shape-center',
    );
  });

test('terminal Transform offset uses final artboard axes with positive/negative scale and rotation', () => {
  for (const type of ['Rectangle', 'Text'])
    for (const scale of [1.6, -2])
      for (const rotation of [0, 37, -91]) {
        const f = fixture(type, true);
        f.transform.params.anchor.value = [151, -73];
        f.transform.params.offset.value = [41, 29];
        f.transform.params.scale.value = scale;
        f.transform.params.rotation.value = rotation;
        f.generator.params[type === 'Text' ? 'position' : 'center'].locked = true;
        f.layer.nodes.reverse();
        const source = structuredClone(f.generator),
          target = proveTranslation(f);
        assert.equal(target.kind, 'terminal-transform-offset');
        assert.equal(target.nodeId, f.transform.id);
        assert.equal(target.parameter, 'offset');
        assert.deepEqual(target.parameterPath, ['params', 'offset', 'value']);
        assert.deepEqual(target.value, [41, 29]);
        assert.deepEqual(f.generator, source);
      }
});

test('resolver has no mutation, freeze, alias, selection or graph-card side effects', () => {
  const f = fixture('Image');
  f.doc.editor = { selectedNodeId: 'unrelated-ui-state', zoom: 0.25 };
  const before = structuredClone(f.doc);
  freeze(f.doc);
  const result = resolve(f);
  assert.equal(result.supported, true);
  result.target.value[0] = -999;
  result.target.parameterPath[0] = 'incorrect';
  result.target.route[0].nodeId = 'incorrect';
  assert.deepEqual(f.doc, before);
  assert.equal(resolve(f).target.value[0], f.generator.params.position.value[0]);
  const unfrozen = fixture('Image');
  assert.equal(resolve(unfrozen).supported, true);
  assert.equal(Object.isFrozen(unfrozen.doc.imageAssets['image-test']), false);
});

test('layer visibility, guide and lock policies are explicit', () => {
  for (const [key, value, code] of [
    ['locked', true, 'locked-artwork'],
    ['visible', false, 'hidden-artwork'],
    ['guide', true, 'hidden-artwork'],
  ]) {
    const f = fixture();
    f.layer[key] = value;
    refuse(f, code);
  }
  const f = fixture();
  f.generator.locked = true;
  refuse(f, 'locked-node');
});

test('locked, driven and expression target positions refuse instead of editing fallbacks', () => {
  for (const [type, transformed] of [
    ['Rectangle', false],
    ['Text', false],
    ['Image', false],
    ['Rectangle', true],
  ])
    for (const kind of ['lock', 'source', 'expression']) {
      const f = fixture(type, transformed),
        q = (f.transform || f.generator).params[
          transformed ? 'offset' : type === 'Rectangle' ? 'center' : 'position'
        ];
      if (kind === 'lock') q.locked = true;
      if (kind === 'source') {
        const control = node('Null');
        f.layer.nodes.unshift(control);
        q.source = control.id;
      }
      if (kind === 'expression') q.expression = '100; 200';
      refuse(
        f,
        kind === 'lock'
          ? 'locked-position'
          : kind === 'source'
            ? 'driven-position'
            : 'expression-position',
      );
    }
});

test('non-finite, malformed, stale source-port and missing positions fail closed', () => {
  for (const value of [[NaN, 1], [1, Infinity], [, 1], [1], '1,2', [1, 2, 3]]) {
    const f = fixture();
    f.generator.params.center.value = value;
    refuse(f, 'invalid-position');
  }
  const f = fixture();
  f.generator.params.center.sourcePort = 'position';
  refuse(f, 'driven-position');
  delete f.generator.params.center;
  refuse(f, 'invalid-position');
});

test('output-affecting non-path dependencies and references are conservatively refused', () => {
  for (const transformed of [false, true]) {
    const f = fixture('Text', transformed),
      reference = node('Reference'),
      separate = node('Separate Vector');
    reference.reference = { nodeId: f.generator.id, portId: 'position' };
    separate.params.vector.source = reference.id;
    f.generator.params.size.source = separate.id;
    f.generator.params.size.sourcePort = 'x';
    f.layer.nodes.unshift(reference, separate);
    refuse(f, 'side-dependency');
  }
  const f = fixture('Text', true),
    reference = node('Reference');
  reference.reference = { nodeId: f.generator.id, portId: 'position' };
  f.layer.nodes.push(reference);
  f.transform.params.anchor.source = reference.id;
  refuse(f, 'side-dependency');
  delete f.transform.params.anchor.source;
  assert.equal(
    resolve(f).supported,
    true,
    'disconnected references do not choose or block a target',
  );
  const color = node('Color');
  f.layer.nodes.push(color);
  f.fill.params.color.source = color.id;
  refuse(f, 'side-dependency');
});

test('non-target literal expressions and locks remain unchanged when translation is provable', () => {
  const f = fixture('Rectangle', true);
  f.generator.params.size.expression = '200 + 20; 70 * 2';
  f.generator.params.size.locked = true;
  f.transform.params.rotation.expression = '10 + 27';
  f.transform.params.scale.expression = '-2';
  f.fill.params.color.locked = true;
  proveTranslation(f);
});

test('bypassed route nodes are selection-only, including a bypassed terminal Transform', () => {
  for (const where of ['generator', 'fill', 'transform', 'output']) {
    const f = fixture('Rectangle', true);
    f[where].bypassed = true;
    refuse(f, 'bypassed-route');
  }
  const f = fixture('Rectangle', true);
  f.transform.bypassed = 'yes';
  refuse(f, 'invalid-bypass');
  f.transform.bypassed = false;
  proveTranslation(f);
});

test('Boolean, Repeater, Remap and arbitrary converters never pick an upstream seed', () => {
  for (const type of [
    'Boolean',
    'Join Geometry',
    'Geometry Repeater',
    'Path Remap',
    'Closed Path Offset',
    'Convert to Path',
    'Text to Path',
  ])
    for (const bypassed of [false, true]) {
      const f = fixture(),
        effect = node(type);
      if (type === 'Geometry Repeater') effect.operation = 'radial-fit';
      effect.bypassed = bypassed;
      effect.params[['Boolean', 'Join Geometry'].includes(type) ? 'a' : 'path'].source =
        f.generator.id;
      f.fill.params.path.source = effect.id;
      f.layer.nodes.unshift(effect);
      refuse(f, 'unsupported-graph');
    }
  const f = fixture('Rectangle', true),
    second = node('Transform');
  second.params.path.source = f.generator.id;
  f.transform.params.path.source = second.id;
  f.layer.nodes.push(second);
  refuse(f, 'unsupported-graph');
});

test('gradients stay selection-only even if a later solid Fill would replace their channel', () => {
  for (const type of ['Linear Gradient Fill', 'Radial Gradient Fill'])
    for (const beforeFill of [false, true]) {
      const f = fixture('Rectangle', true),
        gradient = node(type);
      gradient.params.path.source = f.transform.id;
      f.layer.nodes.push(gradient);
      if (beforeFill) f.fill.params.path.source = gradient.id;
      else f.output.params.path.source = gradient.id;
      refuse(f, 'artboard-gradient');
    }
});

test('bare geometry, extra solid paint and Transform after paint are outside the exact capsule', () => {
  const f = fixture();
  f.output.params.path.source = f.generator.id;
  refuse(f, 'unsupported-graph');
  f.output.params.path.source = f.fill.id;
  const stroke = node('Stroke');
  stroke.params.path.source = f.fill.id;
  f.layer.nodes.push(stroke);
  f.output.params.path.source = stroke.id;
  refuse(f, 'unsupported-graph');
  const g = fixture('Rectangle', true);
  g.transform.params.path.source = g.fill.id;
  g.output.params.path.source = g.transform.id;
  refuse(g, 'unsupported-graph');
});

test('attached Text refuses before loading its font or tracing an attachment', () => {
  for (const transformed of [false, true]) {
    const f = fixture('Text', transformed);
    f.generator.pathAttachment = { nodeId: 'do-not-trace', contourId: 'some-contour' };
    refuse(f, 'attached-text');
  }
});

test('missing, ambiguous and mistyped final outputs or source sockets fail closed', () => {
  for (const mutation of [
    (f) => {
      f.layer.output = 'missing';
    },
    (f) => {
      f.output.type = 'Rectangle';
    },
  ]) {
    const f = fixture();
    mutation(f);
    refuse(f, 'missing-output');
  }
  for (const mutation of [
    (f) => {
      delete f.output.params.path.source;
    },
    (f) => {
      f.output.params.path.source = 'missing';
    },
    (f) => {
      f.output.params.path.sourcePort = 'position';
    },
    (f) => {
      f.output.params.path.type = 'Path';
    },
  ]) {
    const f = fixture();
    mutation(f);
    refuse(f, 'missing-source');
  }
  const f = fixture();
  f.layer.nodes.push(structuredClone(f.generator));
  refuse(f, 'invalid-graph');
  const g = fixture();
  g.doc.layers.push(structuredClone(g.layer));
  refuse(g, 'missing-artwork');
  assert.equal(resolveArtworkMoveTarget(null, 'missing').supported, false);
});

test('empty, degenerate, invisible and unavailable final outputs return reasons without side effects', () => {
  for (const text of ['', '   ', '\n\n']) {
    const f = fixture('Text');
    f.generator.text = text;
    refuse(f, 'empty-output');
  }
  const circle = fixture('Circle');
  circle.generator.params.radius.value = 0;
  refuse(circle, 'empty-output');
  const collapsed = fixture('Rectangle', true);
  collapsed.transform.params.scale.value = 0;
  refuse(collapsed, 'empty-output');
  const transparent = fixture();
  transparent.fill.params.color.value.alpha = 0;
  refuse(transparent, 'empty-output');
  const text = fixture('Text'),
    before = structuredClone(text.doc);
  assert.equal(resolve(text, {}).code, 'unavailable-output');
  assert.deepEqual(text.doc, before);
  const missingImage = fixture('Image');
  missingImage.generator.asset = 'missing';
  refuse(missingImage, 'unavailable-output');
  const error = fixture();
  error.generator.params.size.expression = 'unknown; 100';
  refuse(error, 'unavailable-output');
});

test('a resolved descriptor is observational only; exact zero has no automatic writes or history', () => {
  const f = fixture(),
    before = structuredClone(f.doc),
    result = resolve(f);
  assert.equal(result.supported, true);
  assert.deepEqual(translatedDocument(f.doc, result.target, [0, 0]), before);
  assert.deepEqual(f.doc, before);
  assert.equal(result.apply, undefined);
  assert.equal(result.history, undefined);
});

function curveFixture(closed = false) {
  const f = fixture('Curve');
  f.generator.points = [point(120, 100), point(330, 140), point(260, 310)];
  f.generator.points[0].handleB.value = [45, -30];
  f.generator.points[1].handleA.value = [-20, -35];
  f.generator.points[1].handleB.value = [20, 35];
  f.generator.points[1].handleType = 'symmetric';
  f.generator.points[2].handleA.value = [15, -40];
  f.generator.params.closed.value = closed;
  return f;
}

test('direct open/closed Bezier artwork describes all ordered anchor Positions and translates rigidly', () => {
  for (const closed of [false, true]) {
    const f = curveFixture(closed),
      before = structuredClone(f.doc);
    f.layer.nodes.reverse();
    const target = proveTranslation(f);
    assert.equal(target.kind, 'curve-point-positions');
    assert.equal(target.nodeId, f.generator.id);
    assert.deepEqual(
      target.pointIds,
      f.generator.points.map((pt) => pt.id),
    );
    assert.deepEqual(
      target.positions,
      f.generator.points.map((pt) => pt.position.value),
    );
    assert.deepEqual(target.closed, f.generator.params.closed);
    assert.equal(target.parameter, undefined);
    assert.equal(target.value, undefined);
    target.pointIds.reverse();
    target.positions[0][0] = -999;
    target.closed.value = !closed;
    assert.deepEqual(f.generator, before.layers[0].nodes[0]);
    proveTranslation(f, [-92, 67]);
    freeze(f.doc);
    assert.equal(resolve(f).supported, true);
  }
});

test('every Curve anchor Position is required literal, finite and unlocked', () => {
  for (const index of [0, 1, 2])
    for (const [code, mutate] of [
      [
        'invalid-position',
        (p) => {
          p.position.value = [Infinity, 0];
        },
      ],
      [
        'invalid-position',
        (p) => {
          p.position.value = [1, NaN];
        },
      ],
      [
        'invalid-position',
        (p) => {
          p.position.value = [1];
        },
      ],
      [
        'invalid-position',
        (p) => {
          p.position.type = 'Number';
        },
      ],
      [
        'invalid-position',
        (p) => {
          delete p.position;
        },
      ],
      [
        'locked-position',
        (p) => {
          p.position.locked = true;
        },
      ],
      [
        'locked-position',
        (p) => {
          delete p.position.locked;
        },
      ],
      [
        'driven-position',
        (p) => {
          p.position.source = 'node-controller';
        },
      ],
      [
        'driven-position',
        (p) => {
          p.position.sourcePort = 'position';
        },
      ],
      [
        'expression-position',
        (p) => {
          p.position.expression = '10; 20';
        },
      ],
      [
        'expression-position',
        (p) => {
          delete p.position.expression;
        },
      ],
    ]) {
      const f = curveFixture();
      mutate(f.generator.points[index]);
      refuse(f, code);
    }
});

test('Curve point identity, handles, modes and bounded direct route fail closed without mutation', () => {
  for (const mutate of [
    (f) => {
      delete f.generator.points[1].id;
    },
    (f) => {
      f.generator.points[1].id = '';
    },
    (f) => {
      f.generator.points[1].id = f.generator.points[0].id;
    },
    (f) => {
      f.generator.points[1].id = f.fill.id;
    },
    (f) => {
      f.generator.points[1] = null;
    },
    (f) => {
      f.generator.points[1].handleType = 'unknown';
    },
    (f) => {
      f.generator.points[1].handleA.value = [0, Infinity];
    },
    (f) => {
      f.generator.points = [];
    },
    (f) => {
      delete f.generator.points;
    },
    (f) => {
      f.generator.points = Array(10001).fill(f.generator.points[0]);
    },
  ]) {
    const f = curveFixture();
    mutate(f);
    refuse(f, 'invalid-points');
  }
  const dependent = curveFixture();
  dependent.generator.points[2].handleA.source = 'node-controller';
  refuse(dependent, 'side-dependency');
  const transformed = fixture('Curve', true);
  refuse(transformed, 'unsupported-graph');
  for (const [code, mutate] of [
    [
      'hidden-artwork',
      (f) => {
        f.layer.visible = false;
      },
    ],
    [
      'locked-artwork',
      (f) => {
        f.layer.locked = true;
      },
    ],
    [
      'bypassed-route',
      (f) => {
        f.fill.bypassed = true;
      },
    ],
    [
      'locked-node',
      (f) => {
        f.generator.locked = true;
      },
    ],
    [
      'side-dependency',
      (f) => {
        f.generator.params.closed.source = 'node-controller';
      },
    ],
    [
      'side-dependency',
      (f) => {
        f.fill.params.color.source = 'node-controller';
      },
    ],
  ]) {
    const f = curveFixture();
    mutate(f);
    refuse(f, code);
  }
  const sparse = curveFixture();
  sparse.generator.points[1].position.value = [, 10];
  refuse(sparse, 'invalid-position');
  sparse.generator.points[1].position.value = [10, 10];
  sparse.generator.points[2].handleA.value = [, 10];
  refuse(sparse, 'invalid-points');
});

test('Curve movement-only budget is explicit at 128/129 and never truncates larger curves', () => {
  assert.equal(CURVE_ARTWORK_MOVE_POINT_LIMIT, 128);
  const boundary = curveFixture(true);
  boundary.generator.points = Array.from({ length: 128 }, (_, i) =>
    point(
      200 + Math.cos((i * Math.PI * 2) / 128) * 100,
      200 + Math.sin((i * Math.PI * 2) / 128) * 100,
    ),
  );
  assert.equal(proveTranslation(boundary).pointIds.length, 128);
  boundary.generator.points.push(point(200, 100));
  refuse(boundary, 'curve-move-limit');
  assert.match(resolve(boundary).reason, /128 anchors.*graph Curve.*Save\/export/);
  boundary.fill.params.color.expression = 'must_not_evaluate';
  refuse(boundary, 'curve-move-limit');
  const maximum = curveFixture();
  maximum.generator.points = Array.from({ length: 10000 }, (_, i) => {
    const p = point(i, i % 2);
    p.id = 'point-bound-' + i;
    return p;
  });
  refuse(maximum, 'curve-move-limit');
});
