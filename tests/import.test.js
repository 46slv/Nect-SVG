import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { importSVG } from '../src/svg-import.js';
import { evaluate, pathArea, exportSVG } from '../src/core.js';
const Parser = new Window().DOMParser;
test('SVG import roundtrips compound holes through Remap and headless export', () => {
  let d = importSVG(
    '<svg viewBox="0 0 200 200"><path fill="#336699" d="M0 0H100V100H0Z M20 20V80H80V20Z"/></svg>',
    Parser,
  );
  assert.equal(d.layers.length, 1);
  assert.ok(Math.abs(pathArea(evaluate(d.layers[0]).path) - 6400) < 0.001);
  assert.match(exportSVG(d), /#336699/);
});
test('SVG supported primitives become editable source nodes', () => {
  let d = importSVG(
    '<svg width="300" height="200"><g fill="#123"><circle cx="50" cy="60" r="20"/><rect x="100" y="20" width="30" height="40"/></g></svg>',
    Parser,
  );
  assert.equal(d.layers.length, 2);
  assert.equal(d.layers[0].nodes[0].type, 'Circle');
  assert.deepEqual(d.layers[1].nodes[0].params.center.value, [115, 40]);
});
test('SVG import refuses executable/external content and unsupported rendering rather than losing it', () => {
  for (const body of [
    '<script>alert(1)</script>',
    '<image href="https://example.com/a"/>',
    '<path d="M0 0L1 1" transform="scale(2)"/>',
    '<rect width="10" height="10" onload="alert(1)"/>',
    '<path fill-rule="evenodd" d="M0 0L1 1"/>',
    '<rect width="10" height="10" style="fill:red"/>',
  ])
    assert.throws(() => importSVG(`<svg>${body}</svg>`, Parser));
});
test('SVG refuses invisible content and nested coordinate systems instead of silently changing appearance', () => {
  for (const body of [
    '<rect display="none" width="10" height="10"/>',
    '<svg x="10"><circle r="5"/></svg>',
    '<g visibility="hidden"><circle r="5"/></g>',
  ])
    assert.throws(() => importSVG(`<svg>${body}</svg>`, Parser));
});
test('the editor imports its own SVG export with layer names and equivalent geometry', () => {
  const original = importSVG(
    '<svg viewBox="0 0 200 200"><circle id="Disc" cx="70" cy="80" r="30" fill="#123456"/></svg>',
    Parser,
  );
  const exported = exportSVG(original),
    roundtrip = importSVG(exported, Parser);
  assert.equal(roundtrip.layers[0].name, 'Disc');
  assert.ok(
    Math.abs(
      pathArea(evaluate(roundtrip.layers[0]).path) - pathArea(evaluate(original.layers[0]).path),
    ) < 0.01,
  );
});
