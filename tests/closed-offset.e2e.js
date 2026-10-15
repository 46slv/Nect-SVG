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
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
const inspect = (id) => page.locator(`.graph .node[data-id="${id}"] .node-head strong`).click();
const field = (id, key) =>
  page.locator(
    `${key === 'path' ? '.graph' : '.inspector-body'} .field[data-node="${id}"][data-key="${key}"]`,
  );
const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.locator('#add-node').selectOption('Closed Path Offset');
  const added = await page.evaluate(
    () => window.nect.document.layers[0].nodes.find((n) => n.type === 'Closed Path Offset').id,
  );
  await inspect(added);
  assert.equal(await field(added, 'path').getAttribute('data-type'), 'Path');
  const ids = await page.evaluate(async () => {
    const { document, node, connect } = await import('/src/core.js');
    const doc = document(),
      l = doc.layers[0],
      r = node('Rectangle', 40, 40),
      o = node('Closed Path Offset', 350, 40),
      fill = node('Fill', 660, 40),
      out = node('Output', 970, 40),
      value = node('Value', 40, 430),
      curve = node('Curve', 350, 650),
      v = node('Vector', 660, 430);
    doc.width = 240;
    doc.height = 180;
    r.params.center.value = [120, 90];
    r.params.size.value = [100, 60];
    fill.params.color.value = { hex: '#ff0000', alpha: 0.5 };
    value.params.value.value = -10;
    curve.params.closed.value = false;
    l.nodes = [r, o, fill, out, value, curve, v];
    l.output = out.id;
    connect(l, r.id, o.id, 'path');
    connect(l, o.id, fill.id, 'path');
    connect(l, fill.id, out.id, 'path');
    window.nect.load(JSON.stringify(doc));
    return { r: r.id, o: o.id, fill: fill.id, value: value.id, curve: curve.id, v: v.id };
  });
  await inspect(ids.o);
  assert.match(await page.locator('.inspector-body').innerText(), /not a final offset error bound/);
  const amount = () => field(ids.o, 'amount').locator('[data-value]');
  const write = async (n) => {
    await amount().fill(n);
    await amount().press('Tab');
  };
  const original = await saved();
  await write('-10');
  assert.equal(await amount().inputValue(), '-10');
  await page.locator('[data-action="undo"]').click();
  assert.equal(await saved(), original);
  await page.locator('[data-action="redo"]').click();
  assert.equal(await amount().inputValue(), '-10');
  for (const bad of ['0.00001', '1000000000']) {
    const before = await saved();
    await write(bad);
    assert.equal(await saved(), before);
  }
  const before = await saved();
  await field(ids.o, 'path').locator('select').selectOption(ids.curve);
  assert.equal(await saved(), before);
  assert.match(await page.locator('.status .message').innerText(), /closed/);
  await field(ids.o, 'amount').locator('[data-connect-menu]').click();
  assert.equal(await page.locator(`dialog option[value="${ids.v}"]`).count(), 0);
  await page.locator('dialog select').selectOption(ids.value);
  await page.locator('dialog [data-confirm]').click();
  assert.equal(await amount().isDisabled(), true);
  await field(ids.o, 'amount').locator('.input').click({ button: 'right' });
  assert.equal(await amount().isDisabled(), false);
  await field(ids.o, 'amount').locator('[data-lock]').click();
  assert.equal(await amount().isDisabled(), true);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await amount().isDisabled(), false);
  await page.locator('[data-action="redo"]').click();
  assert.equal(await amount().isDisabled(), true);
  await field(ids.o, 'amount').locator('[data-lock]').click();
  for (const join of ['bevel', 'round', 'miter']) {
    await page.locator(`.inspector-body [data-operation="${ids.o}"]`).selectOption(join);
    assert.equal(await page.evaluate(() => window.nect.evaluate().error), null);
  }
  await write('10');
  // The numeric commit replaces controls asynchronously. Wait for the rendered
  // value attribute (fill changes only the old property) before measuring a drag.
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(`.inspector-body [data-node="${id}"][data-key="amount"] [data-value]`)
        ?.getAttribute('value') === '10',
    ids.o,
  );
  const baseline = await saved(),
    bounds = await amount().boundingBox();
  assert.ok(bounds, 'Committed Offset control is visible for cancellation drag');
  await page.mouse.move(bounds.x + 30, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 50, bounds.y + bounds.height / 2);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await saved(), baseline);
  // Rejected amount cannot replace the last valid preview or create history.
  await write('1000000000');
  assert.equal(await saved(), baseline);
  const svg = await page.evaluate(() => window.nect.export());
  const pixels = await page.evaluate(async (svg) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(svg);
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return [
      ctx.getImageData(61, 90, 1, 1),
      ctx.getImageData(59, 90, 1, 1),
      ctx.getImageData(120, 90, 1, 1),
    ].map((x) => [...x.data]);
  }, svg);
  assert.deepEqual(pixels, [
    [255, 0, 0, 128],
    [0, 0, 0, 0],
    [255, 0, 0, 128],
  ]);
  await write('-30');
  assert.equal(await page.evaluate(() => window.nect.evaluate().path.contours.length), 0);
  await write('0');
  assert.equal(await page.evaluate(() => window.nect.evaluate().path.contours[0].points.length), 4);
  await fs.mkdir('test-results', { recursive: true });
  const sample = await fs.readFile('examples/closed-path-offset.json', 'utf8');
  await page.evaluate((sample) => window.nect.load(sample), sample);
  const sampleOffset = await page.evaluate(
    () => window.nect.document.layers[0].nodes.find((n) => n.type === 'Closed Path Offset').id,
  );
  await inspect(sampleOffset);
  const json = await saved(),
    sampleSVG = await page.evaluate(() => window.nect.export());
  await page.evaluate((json) => window.nect.load(json), json);
  assert.equal(await saved(), json);
  assert.equal(await page.evaluate(() => window.nect.export()), sampleSVG);
  await inspect(sampleOffset);
  await page.screenshot({ path: 'test-results/closed-path-offset-1600x1000.png', fullPage: true });
  await fs.writeFile(
    'test-results/workflow-closed-path-offset.json',
    JSON.stringify(
      {
        pixels,
        typedSockets: true,
        rollback: true,
        history: true,
        zero: true,
        emptyErosion: true,
        jsonRoundtrip: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  await fs.writeFile('test-results/workflow-closed-path-offset.svg', sampleSVG);
  assert.deepEqual(errors, []);
  console.log(
    'Closed Path Offset: real controls, rejects/rollback, history, zero/erosion, alpha pixels and editable sample verified.',
  );
} catch (error) {
  await fs.mkdir('test-results', { recursive: true });
  const diagnostic = await page.evaluate(() => ({
    status: document.querySelector('.status .message')?.textContent,
    inspector: document.querySelector('.inspector-body')?.textContent,
    nodeTypes: window.nect?.document.layers[0].nodes.map((n) => n.type),
  }));
  console.error('Offset browser diagnostic:', JSON.stringify(diagnostic));
  await fs.writeFile(
    'test-results/workflow-closed-path-offset-failure.json',
    JSON.stringify(diagnostic, null, 2),
  );
  await page.screenshot({ path: 'test-results/closed-path-offset-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
}
