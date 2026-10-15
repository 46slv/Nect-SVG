import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const sample = await fs.readFile('examples/transform-canvas-handles.json', 'utf8');
const load = async (s = sample) => {
  await page.evaluate((s) => window.nect.load(s), s);
  await page.locator('[data-transform-handle="scale"]').waitFor();
};
const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
const params = () => page.evaluate(() => window.nect.document.layers[0].nodes[0].params);
const geo = () =>
  page.evaluate(async () => {
    const { transformHandleGeometry, pathBounds } = await import('/src/core.js');
    const r = window.nect.evaluate(),
      s = r.transformState(window.nect.document.layers[0].nodes[0].id),
      m = document.querySelector('.artboard').getScreenCTM();
    return transformHandleGeometry(s, pathBounds(s.input), Math.hypot(m.a, m.b));
  });
const screen = (p) =>
  page.locator('.artboard').evaluate((el, p) => {
    const q = new DOMPoint(...p).matrixTransform(el.getScreenCTM());
    return [q.x, q.y];
  }, p);
const start = async (key) => {
  const g = await geo();
  await page.mouse.move(...(await screen(g[key])));
  await page.mouse.down();
  return g;
};
const move = async (p) => page.mouse.move(...(await screen(p)), { steps: 5 });
const undo = () => page.locator('[data-action="undo"]').click();
const redo = () => page.locator('[data-action="redo"]').click();
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.0001, `${a} != ${b}`);
const rotate = (g, p, degrees) => {
  const a = (degrees * Math.PI) / 180,
    x = p[0] - g.pivot[0],
    y = p[1] - g.pivot[1];
  return [
    g.pivot[0] + x * Math.cos(a) - y * Math.sin(a),
    g.pivot[1] + x * Math.sin(a) + y * Math.cos(a),
  ];
};
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await load();
  const original = await saved(),
    originalParams = await params(),
    children = await page.evaluate(() =>
      JSON.stringify(window.nect.document.layers[0].nodes.slice(1)),
    );
  assert.match(await page.locator('.hint').textContent(), /Selected Transform output/);
  let g = await start('scale');
  await move(g.scale.map((v, i) => v - g.axis[i] * g.radius * 0.2));
  await page.mouse.up();
  near((await params()).scale.value, 0.8);
  assert.deepEqual((await params()).anchor, originalParams.anchor);
  assert.deepEqual((await params()).offset, originalParams.offset);
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.nect.document.layers[0].nodes.slice(1))),
    children,
  );
  await undo();
  assert.equal(await saved(), original);
  assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  await redo();
  near((await params()).scale.value, 0.8);
  await undo();
  await page.keyboard.down('Shift');
  g = await start('rotation');
  await move(rotate(g, g.rotation, -31));
  await page.mouse.up();
  await page.keyboard.up('Shift');
  near((await params()).rotation.value, -30);
  await undo();
  for (const key of ['scale', 'rotation'])
    for (const end of ['escape', 'cancel', 'capture', 'blur']) {
      const before = await saved();
      g = await start(key);
      await move(
        key === 'scale' ? g.scale.map((v, i) => v - g.axis[i] * 40) : rotate(g, g.rotation, -20),
      );
      assert.notEqual(await saved(), before);
      if (end === 'escape') await page.keyboard.press('Escape');
      else
        await page.evaluate((end) => {
          const el = document.querySelector('.canvas-stage');
          if (end === 'blur') window.dispatchEvent(new Event('blur'));
          else if (end === 'capture') el.releasePointerCapture(1);
          else el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
        }, end);
      await page.mouse.up();
      assert.equal(await saved(), before, end);
      assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
    }
  // Exact precision survives jitter and an out-and-back gesture.
  await page.evaluate(() => {
    const d = window.nect.document;
    d.layers[0].nodes[0].params.scale.value = 0.912345678901234;
    d.layers[0].nodes[0].params.rotation.value = 3.9876543210123;
    window.nect.load(JSON.stringify(d));
  });
  for (const key of ['scale', 'rotation']) {
    const before = await saved();
    g = await start(key);
    const p = await screen(g[key]);
    await page.mouse.move(p[0] + 1, p[1] + 1);
    await page.mouse.up();
    assert.equal(await saved(), before);
    g = await start(key);
    await move(
      key === 'scale' ? g.scale.map((v, i) => v - g.axis[i] * 35) : rotate(g, g.rotation, -20),
    );
    await move(g[key]);
    await page.mouse.up();
    // CTM roundtrip may add sub-ulp noise; the implementation retains the original within its tiny no-op tolerance.
    assert.equal(await saved(), before, key + ' out/back');
  }
  await load();
  const diameter = await page
    .locator('[data-transform-handle="rotation"] circle')
    .evaluate((el) => el.getBoundingClientRect().width);
  await page.locator('[data-action="zoom-in"]').click();
  await page.locator('[data-action="zoom-in"]').click();
  near(
    await page
      .locator('[data-transform-handle="rotation"] circle')
      .evaluate((el) => el.getBoundingClientRect().width),
    diameter,
  );
  let before = await saved();
  g = await geo();
  let p = await screen(g.scale);
  const panHandle = await page.locator('[data-transform-handle="scale"]').elementHandle();
  await page.mouse.move(...p);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(p[0] + 40, p[1] + 25);
  assert.equal(
    await panHandle.evaluate((el) => el.isConnected),
    true,
    'a pan retains the existing SVG handle at fractional zoom',
  );
  await page.mouse.up({ button: 'middle' });
  await panHandle.dispose();
  assert.equal(await saved(), before);
  g = await start('scale');
  await move(g.scale.map((v, i) => v - g.axis[i] * g.radius * 0.1));
  await page.mouse.up();
  near((await params()).scale.value, 0.9);
  await undo();
  await page.locator('[data-action="fit"]').click();
  // Numeric draft commits before the snapshot; a handle drag becomes a second undo step.
  const field = page.locator('.inspector-body .field[data-key="scale"] [data-value]');
  await field.fill('0.95');
  g = await start('scale');
  await move(g.scale.map((v, i) => v - g.axis[i] * g.radius * 0.1));
  await page.mouse.up();
  near((await params()).scale.value, 0.85);
  await undo();
  near((await params()).scale.value, 0.95);
  await undo();
  near((await params()).scale.value, 1);
  for (const key of ['scale', 'rotation'])
    for (const kind of ['expression', 'parameter', 'source', 'layer']) {
      await load();
      await page.evaluate(
        async ({ key, kind }) => {
          const d = window.nect.document,
            l = d.layers[0],
            n = l.nodes[0];
          if (kind === 'layer') l.locked = true;
          else if (kind === 'parameter') n.params[key].locked = true;
          else if (kind === 'expression') n.params[key].expression = key === 'scale' ? '0.9' : '5';
          else {
            const { node, connect } = await import('/src/core.js');
            const v = node('Value');
            v.params.value.value = key === 'scale' ? 0.9 : 5;
            l.nodes.push(v);
            connect(l, v.id, n.id, key);
          }
          window.nect.load(JSON.stringify(d));
        },
        { key, kind },
      );
      before = await saved();
      g = await start(key);
      await move(
        key === 'scale' ? g.scale.map((v, i) => v - g.axis[i] * 40) : rotate(g, g.rotation, -20),
      );
      await page.mouse.up();
      assert.equal(await saved(), before);
      assert.equal(await page.locator(`[data-transform-handle="${key}"].readonly`).count(), 1);
    }
  // Small centered geometry keeps negative/zero controls inside the viewport.
  await page.evaluate(async () => {
    const { document: makeDoc, node, connect } = await import('/src/core.js');
    const d = makeDoc(),
      l = d.layers[0],
      t = node('Transform'),
      r = node('Rectangle'),
      o = node('Output');
    r.params.center.value = [350, 250];
    r.params.size.value = [100, 60];
    t.params.anchor.value = [350, 250];
    l.nodes = [t, r, o];
    l.output = o.id;
    connect(l, r.id, t.id, 'path');
    connect(l, t.id, o.id, 'path');
    window.nect.load(JSON.stringify(d));
  });
  for (const scale of [-1, 0, 1e-12, -1e-12]) {
    await page.evaluate((scale) => {
      const d = window.nect.document;
      d.layers[0].nodes[0].params.scale.value = scale;
      window.nect.load(JSON.stringify(d));
    }, scale);
    g = await start('scale');
    await move(g.scale.map((v, i) => v + g.axis[i] * g.radius * 0.5));
    await page.mouse.up();
    near((await params()).scale.value, scale + g.sign * 0.5);
    assert.equal(await page.evaluate(() => window.nect.evaluate().error), null);
  }
  await load();
  await fs.mkdir('test-results', { recursive: true });
  // Save/export a real changed group; overlays never enter SVG or PNG.
  g = await start('scale');
  await move(g.scale.map((v, i) => v - g.axis[i] * g.radius * 0.15));
  await page.mouse.up();
  for (const [action, ext] of [
    ['save', 'json'],
    ['export', 'svg'],
    ['export-png', 'png'],
  ]) {
    const wait = page.waitForEvent('download');
    await page.locator(`[data-action="${action}"]`).click();
    await (await wait).saveAs(`test-results/workflow-transform-handles.${ext}`);
  }
  assert.doesNotMatch(
    await fs.readFile('test-results/workflow-transform-handles.svg', 'utf8'),
    /transform-overlay|Selected Transform output/,
  );
  const textId = await page.evaluate(
    () => window.nect.document.layers[0].nodes.find((n) => n.type === 'Text').id,
  );
  await page.locator(`.node[data-id="${textId}"] .node-head strong`).click();
  const png = page.waitForEvent('download');
  await page.locator('[data-action="export-png"]').click();
  await (await png).saveAs('test-results/workflow-transform-handles-no-overlay.png');
  assert.deepEqual(
    await fs.readFile('test-results/workflow-transform-handles.png'),
    await fs.readFile('test-results/workflow-transform-handles-no-overlay.png'),
  );
  await load(await fs.readFile('test-results/workflow-transform-handles.json', 'utf8'));
  near((await params()).scale.value, 0.85);
  await page
    .locator('.artboard')
    .screenshot({ path: 'test-results/workflow-transform-handles-artboard.png' });
  await page.screenshot({
    path: 'test-results/workflow-transform-handles-editor.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'PASS Transform handles: selected-stage uniform scale/rotation, fixed pivot/children, Shift snap, history/no-op/cancel, pan/zoom, draft commit, driven locks, negative/zero recovery, JSON/SVG/PNG',
  );
} finally {
  await browser.close();
}
