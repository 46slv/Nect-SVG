import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
  errors = [];
let accept = true;
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => (accept ? d.accept() : d.dismiss()));
const snapshot = () => page.evaluate(() => JSON.stringify(window.nect.document));
const load = (s) => page.evaluate((s) => window.nect.load(s), s);
const click = (action) => page.locator(`[data-action="${action}"]`).click();
const xy = (p) =>
  page.locator('.artboard').evaluate((svg, p) => {
    const q = new DOMPoint(...p).matrixTransform(svg.getScreenCTM());
    return [q.x, q.y];
  }, p);
const point = async (p, handle) => {
  await page.mouse.move(...(await xy(p)));
  await page.mouse.down();
  if (handle) await page.mouse.move(...(await xy(handle)), { steps: 4 });
  await page.mouse.up();
};
const download = async (action, ext) => {
  const pending = page.waitForEvent('download');
  await click(action);
  const path = `test-results/workflow-blank-start.${ext}`;
  await (await pending).saveAs(path);
  return fs.readFile(path);
};
try {
  await fs.mkdir('test-results', { recursive: true });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  const demo = await snapshot();
  assert.equal(
    JSON.parse(demo).layers[0].nodes.length,
    6,
    'launch demo remains explicit compatibility behavior',
  );
  accept = false;
  await click('new');
  assert.equal(await snapshot(), demo);
  accept = true;
  await click('new');
  const blank = await snapshot(),
    empty = JSON.parse(blank),
    emptyLayer = empty.layers[0];
  assert.equal(empty.layers.length, 1);
  assert.equal(emptyLayer.nodes.length, 1);
  assert.equal(emptyLayer.nodes[0].type, 'Output');
  assert.equal(emptyLayer.allowEmptyOutput, true);
  assert.equal(
    await page
      .locator('.shape,.artwork-selection,.vertex,[data-object-resize],.node-stage-move')
      .count(),
    0,
  );
  assert.equal(await page.locator('.node.selected').count(), 0);
  assert.equal(await page.locator('.warning').count(), 0);
  assert.equal(await page.locator('.inspector-body h3').innerText(), 'Empty composition');
  assert.equal(await page.evaluate(() => document.activeElement.matches('.canvas-stage')), true);
  await point([300, 260]);
  await page.locator('.canvas-stage').press('ArrowRight');
  assert.equal(await snapshot(), blank);
  await click('undo');
  assert.equal(await snapshot(), demo);
  assert.equal(await page.locator('.node.selected').count(), 1);
  await click('redo');
  assert.equal(await snapshot(), blank);
  assert.equal(await page.locator('.shape').count(), 0);
  const saved = await download('save', 'json'),
    svg = await download('export', 'svg'),
    png = await download('export-png', 'png');
  assert.deepEqual(JSON.parse(saved.toString()), empty);
  assert.equal(
    svg.toString(),
    '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"></svg>',
  );
  const pixels = await page.evaluate(async (data) => {
    const i = new Image();
    i.src = 'data:image/png;base64,' + data;
    await i.decode();
    const c = document.createElement('canvas');
    c.width = i.width;
    c.height = i.height;
    const x = c.getContext('2d');
    x.drawImage(i, 0, 0);
    const bytes = x.getImageData(0, 0, c.width, c.height).data;
    return { width: c.width, height: c.height, nonzero: bytes.some((v) => v !== 0) };
  }, png.toString('base64'));
  assert.deepEqual(pixels, { width: 960, height: 540, nonzero: false });
  await page.reload();
  await page.waitForSelector('.shape');
  await load(saved.toString());
  assert.equal(await snapshot(), blank);
  assert.equal(await page.locator('.shape,.warning').count(), 0);
  for (const tool of ['Circle', 'Rectangle', 'Polygon', 'Star', 'Text', 'pen']) {
    await load(blank);
    await page.locator(`[data-tool="${tool}"]`).click();
    if (tool === 'pen') {
      await point([250, 110]);
      await point([430, 220], [460, 250]);
      await point([300, 330]);
      await page.keyboard.press('Enter');
    }
    const after = await snapshot(),
      d = JSON.parse(after);
    assert.equal(d.layers.length, 2);
    assert.deepEqual(d.layers[0], emptyLayer);
    assert.equal(await page.locator('.shape').count(), 1);
    await click('undo');
    assert.equal(await snapshot(), blank);
    assert.equal(await page.locator('.shape').count(), 0);
    await click('redo');
    assert.equal(await snapshot(), after);
    await load(after);
    assert.equal(await snapshot(), after);
  }
  // Cancelled New cannot finish or discard a released or actively pressed draft.
  for (const pressed of [false, true]) {
    await load(blank);
    await page.locator('[data-tool="pen"]').click();
    await point([200, 100]);
    await point([360, 180], [390, 210]);
    if (pressed) {
      await page.mouse.move(...(await xy([440, 300])));
      await page.mouse.down();
      await page.mouse.move(...(await xy([470, 330])), { steps: 3 });
    }
    const before = await snapshot(),
      drawing = await page.locator('.artboard').innerHTML();
    accept = false;
    await page.locator('[data-action="new"]').press('Enter');
    accept = true;
    assert.equal(await snapshot(), before);
    assert.equal(await page.locator('.artboard').innerHTML(), drawing);
    assert.equal(await page.locator('[data-pen-draft]').count(), 1);
    if (pressed) await page.mouse.up();
    await page.locator('[data-pen-cancel]').click();
    assert.equal(await snapshot(), before);
  }
  await page.locator('[data-tool="pen"]').click();
  await point([200, 100]);
  await point([360, 180]);
  await click('new');
  assert.equal(JSON.parse(await snapshot()).layers[0].nodes.length, 1);
  assert.equal(await page.locator('[data-pen-draft]').count(), 0);
  await click('undo');
  assert.equal(JSON.parse(await snapshot()).layers.length, 2);
  assert.equal(await page.locator('.inspector-body h3').innerText(), 'Artwork · Curve');
  await click('redo');
  assert.equal(await page.locator('.shape').count(), 0);
  // +Blank appends from hidden/locked old work; +Demo remains an explicit separate action.
  await load(demo);
  const oldId = JSON.parse(demo).layers[0].id;
  await page.locator(`[data-layer-lock="${oldId}"]`).click();
  await page.locator(`[data-visible="${oldId}"]`).click();
  const prior = await snapshot();
  await click('add-blank-layer');
  const appended = await snapshot(),
    d = JSON.parse(appended);
  assert.equal(d.layers.length, 2);
  assert.deepEqual(d.layers[0], JSON.parse(prior).layers[0]);
  assert.equal(d.layers[1].nodes.length, 1);
  assert.equal(await page.locator('.shape').count(), 0);
  await page.locator(`[data-select-layer="${d.layers[1].id}"]`).click();
  assert.equal(await page.locator('.artwork-selection').count(), 0);
  await click('undo');
  assert.equal(await snapshot(), prior);
  await click('redo');
  assert.equal(await snapshot(), appended);
  await click('add-layer');
  assert.equal(JSON.parse(await snapshot()).layers.at(-1).nodes.length, 6);
  // A keyboard-activated +Blank cannot carry a pressed old-layer drag into its new graph.
  await load(demo);
  const handle = page.locator('.node-stage-move rect'),
    rect = await handle.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 25, rect.y + rect.height / 2 + 15, { steps: 3 });
  assert.notEqual(await snapshot(), demo);
  await page.locator('[data-action="add-blank-layer"]').press('Enter');
  assert.deepEqual(JSON.parse(await snapshot()).layers[0], JSON.parse(demo).layers[0]);
  const afterInterrupted = await snapshot();
  await page.mouse.move(rect.x + 90, rect.y + 70);
  await page.mouse.up();
  assert.equal(await snapshot(), afterInterrupted);
  await click('undo');
  assert.equal(await snapshot(), demo);
  const capacity = await page.evaluate(async () => {
    const { blankDocument, blankLayer } = await import('/src/core.js');
    const d = blankDocument();
    while (d.layers.length < 100) d.layers.push(blankLayer('Blank ' + d.layers.length));
    window.nect.load(JSON.stringify(d));
    return JSON.stringify(window.nect.document);
  });
  await click('add-blank-layer');
  assert.equal(await snapshot(), capacity);
  assert.match(await page.locator('.status .message').innerText(), /100/);
  for (const size of [
    { width: 1280, height: 800 },
    { width: 1600, height: 1000 },
  ]) {
    await page.setViewportSize(size);
    await load(blank);
    await click('new');
    await click('fit');
    assert.equal(await page.locator('.inspector-body h3').innerText(), 'Empty composition');
    assert.equal(await page.locator('.node.selected').count(), 0);
    const button = page.locator('[data-action="add-blank-layer"]'),
      box = await button.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height);
    assert.equal(
      await button.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el;
      }),
      true,
    );
    await page.screenshot({
      path: `test-results/blank-start-${size.width}x${size.height}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS blank start: confirmed/cancelled New, exact Undo/Redo, empty selection and no phantom hits, Save/reload/transparent SVG+PNG, every independent tool/Pen, draft preservation, +Blank atomicity/capacity, explicit +Demo and 1280/1600 layout',
  );
} finally {
  await browser.close();
}
