import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
const field = (id, key) =>
  page.locator(`.inspector-body .field[data-node="${id}"][data-key="${key}"]`);
const inspect = (id) => page.locator(`.graph .node[data-id="${id}"] .node-head strong`).click();
async function download(action, path) {
  const waiting = page.waitForEvent('download');
  await page.locator(`[data-action="${action}"]`).click();
  await (await waiting).saveAs(path);
  return fs.readFile(path);
}
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await fs.mkdir('test-results', { recursive: true });
  const ids = await page.evaluate(async () => {
    const { document, node, connect } = await import('/src/core.js');
    const d = document(),
      l = d.layers[0];
    d.name = 'Separate XY — Math — Combine';
    d.width = 400;
    d.height = 300;
    const v = node('Vector', 40, 40),
      s = node('Separate Vector', 340, 40),
      m = node('Math', 640, 40),
      c = node('Combine Vector', 940, 40),
      r = node('Circle', 40, 360),
      f = node('Fill', 340, 360),
      o = node('Output', 640, 360);
    v.params.value.value = [140, 120];
    m.params.b.value = 30;
    r.params.radius.value = 40;
    l.nodes = [v, s, m, c, r, f, o];
    l.output = o.id;
    connect(l, v.id, s.id, 'vector');
    connect(l, m.id, c.id, 'x');
    connect(l, s.id, c.id, 'y', false, 'y');
    connect(l, c.id, r.id, 'center');
    connect(l, r.id, f.id, 'path');
    connect(l, f.id, o.id, 'path');
    window.nect.load(JSON.stringify(d));
    return { v: v.id, s: s.id, m: m.id, c: c.id };
  });
  const value = () => page.evaluate((id) => window.nect.evaluate().run(id), ids.c);
  await page
    .locator(`[data-source="${ids.s}"][data-source-port="x"]`)
    .dragTo(page.locator(`.graph [data-node="${ids.m}"][data-key="a"]`));
  assert.deepEqual(await value(), [170, 120]);
  await inspect(ids.m);
  assert.equal(await field(ids.m, 'a').locator('[data-value]').inputValue(), '140');
  await field(ids.m, 'a').locator('[data-connect-menu]').click();
  await page.locator('dialog select').selectOption(JSON.stringify([ids.s, 'y']));
  await page.locator('dialog [data-confirm]').click();
  assert.deepEqual(await value(), [150, 120]);
  const op = () => page.locator(`.inspector-body [data-operation="${ids.m}"]`);
  await op().selectOption('abs');
  assert.equal(await field(ids.m, 'b').count(), 0);
  await op().selectOption('clamp');
  assert.equal(await field(ids.m, 'min').count(), 1);
  assert.equal(await field(ids.m, 'max').count(), 1);
  await op().selectOption('add');
  assert.equal(await field(ids.m, 'b').locator('[data-value]').inputValue(), '30');
  await page.locator(`[data-collapse="${ids.s}"]`).click();
  const boxes = await Promise.all(
    ['x', 'y'].map((port) =>
      page.locator(`[data-source="${ids.s}"][data-source-port="${port}"]`).boundingBox(),
    ),
  );
  assert.ok(
    boxes[0] && boxes[1] && Math.abs(boxes[0].y - boxes[1].y) >= 20,
    'X/Y must be separate visible hit targets',
  );
  await page
    .locator(`[data-source="${ids.s}"][data-source-port="x"]`)
    .dragTo(page.locator(`.graph [data-node="${ids.m}"][data-key="a"]`));
  assert.deepEqual(await value(), [170, 120]);
  await inspect(ids.m);
  await field(ids.m, 'a').locator('.input').click({ button: 'right' });
  assert.deepEqual(await value(), [30, 120]);
  await page.locator('[data-action="undo"]').click();
  assert.deepEqual(await value(), [170, 120]);
  await page.locator('[data-action="redo"]').click();
  assert.deepEqual(await value(), [30, 120]);
  await page.locator('[data-action="undo"]').click();
  const json = await download('save', 'test-results/workflow-math.json'),
    svg = await download('export', 'test-results/workflow-math.svg');
  assert.match(svg.toString(), /<svg/);
  const saved = JSON.parse(json);
  const ml = saved.layers[0].nodes.find((n) => n.id === ids.m);
  assert.equal(ml.params.a.sourcePort, 'x');
  await page
    .locator('#open-file')
    .setInputFiles({ name: 'math.json', mimeType: 'application/json', buffer: json });
  assert.deepEqual(await value(), [170, 120]);
  await page.screenshot({ path: 'test-results/workflow-math.png', fullPage: true });
  const vectorIds = await page.evaluate(async () => {
    const { document, node, connect, setOperation } = await import('/src/core.js');
    const d = document(),
      l = d.layers[0],
      vm = node('Vector Math', 40, 40),
      r = node('Circle', 350, 40),
      f = node('Fill', 660, 40),
      o = node('Output', 970, 40);
    vm.params.a.value = [3, 4];
    vm.params.b.value = [2, 2];
    vm.params.scale.value = 20;
    l.nodes = [vm, r, f, o];
    l.output = o.id;
    setOperation(l, vm.id, 'length');
    connect(l, vm.id, r.id, 'radius');
    connect(l, r.id, f.id, 'path');
    connect(l, f.id, o.id, 'path');
    window.nect.load(JSON.stringify(d));
    return { vm: vm.id, r: r.id };
  });
  await inspect(vectorIds.vm);
  const vmOp = () => page.locator(`.inspector-body [data-operation="${vectorIds.vm}"]`);
  const vmValue = () => page.evaluate((id) => window.nect.evaluate().run(id), vectorIds.vm);
  assert.equal(await vmValue(), 5);
  await vmOp().selectOption('normalize');
  // Rejected operations restore the select in the deferred render.
  // Wait for that observable rollback instead of racing the render timer.
  await page.waitForFunction(
    (id) => document.querySelector(`.inspector-body [data-operation="${id}"]`)?.value === 'length',
    vectorIds.vm,
  );
  assert.equal(await vmOp().inputValue(), 'length');
  assert.equal(await vmValue(), 5);
  await inspect(vectorIds.r);
  await field(vectorIds.r, 'radius').locator('.input').click({ button: 'right' });
  await inspect(vectorIds.vm);
  await vmOp().selectOption('normalize');
  assert.deepEqual(await vmValue(), [0.6, 0.8]);
  assert.equal(await field(vectorIds.vm, 'b').count(), 0);
  await vmOp().selectOption('scale');
  assert.deepEqual(await vmValue(), [60, 80]);
  assert.equal(await field(vectorIds.vm, 'scale').count(), 1);
  await inspect(vectorIds.r);
  await field(vectorIds.r, 'center').locator('[data-connect-menu]').click();
  await page.locator('dialog select').selectOption(vectorIds.vm);
  await page.locator('dialog [data-confirm]').click();
  await inspect(vectorIds.vm);
  await vmOp().selectOption('dot');
  // This rejected type change rolls the select back in the deferred render too.
  await page.waitForFunction(
    (id) => document.querySelector(`.inspector-body [data-operation="${id}"]`)?.value === 'scale',
    vectorIds.vm,
  );
  assert.equal(await vmOp().inputValue(), 'scale');
  assert.deepEqual(await vmValue(), [60, 80]);
  const vectorJson = await download('save', 'test-results/workflow-vector-math.json');
  await download('export', 'test-results/workflow-vector-math.svg');
  await page
    .locator('#open-file')
    .setInputFiles({ name: 'vector-math.json', mimeType: 'application/json', buffer: vectorJson });
  await page.waitForFunction(() =>
    document.querySelector('.status').textContent.includes('Project restored'),
  );
  assert.deepEqual(await vmValue(), [60, 80]);
  await inspect(vectorIds.vm);
  await page.screenshot({ path: 'test-results/workflow-vector-math.png', fullPage: true });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    'test-results/workflow-math-evidence.json',
    JSON.stringify(
      {
        vectorMathTypedOperationGuard: true,
        vectorMathScaleNormalize: true,
        portsDistinct: true,
        dragBothStates: true,
        menuY: true,
        activeInputs: true,
        undoRedo: true,
        jsonReload: true,
        svgExport: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Separate X/Y, Math, Combine Vector: real Chrome drag, menus, collapse, active inputs, undo/redo and export verified.',
  );
} finally {
  await browser.close();
}
