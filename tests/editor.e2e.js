import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
let errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.node').count(), 5);
  let initial = await page.locator('.shape').getAttribute('d');
  await page
    .locator('.node')
    .filter({ has: page.locator('strong', { hasText: /^Circle$/ }) })
    .getByLabel('Circle radius', { exact: true })
    .fill('90');
  await page.keyboard.press('Tab');
  assert.notEqual(await page.locator('.shape').getAttribute('d'), initial);
  await page.getByTitle('Ctrl+Z', { exact: true }).click();
  assert.equal(await page.locator('.shape').getAttribute('d'), initial);
  await page.getByTitle('Ctrl+Shift+Z', { exact: true }).click();
  assert.notEqual(await page.locator('.shape').getAttribute('d'), initial);
  await page.getByLabel('Add node', { exact: true }).selectOption('Value');
  const valId = await page.evaluate(() => window.nect.document.layers[0].nodes.at(-1).id);
  let valueNode = page.locator(`.node[data-id="${valId}"]`);
  await valueNode.getByLabel('Value value', { exact: true }).fill('45');
  await page.keyboard.press('Tab');
  const circleId = await page.evaluate(() => window.nect.document.layers[0].nodes[0].id);
  await page.locator('.graph-scroll').evaluate((el) => {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  });
  // Place the new node visibly beside the generator via a real node-header drag.
  await valueNode.scrollIntoViewIfNeeded();
  let header = await valueNode.locator('.node-head').boundingBox();
  await page.mouse.move(header.x + 40, header.y + 15);
  await page.mouse.down();
  await page.mouse.move(header.x - 400, header.y - 180, { steps: 8 });
  await page.mouse.up();
  // Dynamic socket use through DOM pointer events permits offscreen graph targets, then independently checks visible DOM.
  await page.locator(`[data-source="${valId}"]`).dispatchEvent('pointerdown', { button: 0 });
  await page
    .locator(`.graph .field[data-node="${circleId}"][data-key="radius"]`)
    .dispatchEvent('pointerup', { button: 0 });
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[0].nodes[0].params.radius.source),
    valId,
  );
  assert.equal(
    await page.locator(`.graph .field[data-node="${circleId}"][data-key="radius"] .input`).count(),
    1,
  );
  await page
    .locator(`.graph .field[data-node="${circleId}"][data-key="radius"] .input`)
    .dispatchEvent('contextmenu');
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[0].nodes[0].params.radius.source),
    undefined,
  );
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[0].nodes[0].params.radius.value),
    90,
  );
  await page.getByRole('button', { name: 'Pen / Curve', exact: true }).click();
  let box = await page.locator('.artboard').boundingBox();
  let a = [box.x + box.width * 0.3, box.y + box.height * 0.25],
    b = [box.x + box.width * 0.65, box.y + box.height * 0.3],
    c = [box.x + box.width * 0.5, box.y + box.height * 0.7];
  await page.mouse.click(...a);
  await page.mouse.move(...b);
  await page.mouse.down();
  await page.mouse.move(b[0] + 20, b[1] + 15, { steps: 5 });
  await page.mouse.up();
  await page.mouse.click(...c);
  await page.mouse.click(...a);
  let curve = await page.evaluate(() =>
    window.nect.document.layers[0].nodes.findLast((n) => n.type === 'Curve'),
  );
  assert.equal(curve.points.length, 3);
  assert.equal(curve.params.closed.value, true);
  assert.ok(curve.points[1].handleB.value[0] > 0);
  // Connect the freshly drawn curve through Boolean and Remap with form controls.
  let boolId = await page.evaluate(
      () => window.nect.document.layers[0].nodes.find((n) => n.type === 'Boolean').id,
    ),
    remapId = await page.evaluate(
      () => window.nect.document.layers[0].nodes.find((n) => n.type === 'Path Remap').id,
    );
  await page.locator(`.node[data-id="${boolId}"] [data-key="a"] select`).selectOption(curve.id);
  await page.locator(`[data-preview="${remapId}"]`).click();
  assert.equal(await page.evaluate(() => window.nect.evaluate().error), null);
  let before = await page.evaluate(() => window.nect.export()),
    saved = await page.evaluate(() => JSON.stringify(window.nect.document));
  await page.evaluate((text) => window.nect.load(text), saved);
  assert.equal(await page.evaluate(() => window.nect.export()), before);
  // Invalid load leaves the existing project intact.
  await page.evaluate(() => {
    try {
      window.nect.load('{"schemaVersion":999}');
    } catch {}
  });
  assert.equal(await page.evaluate(() => window.nect.export()), before);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG', exact: true }).click();
  assert.equal((await dl).suggestedFilename(), 'nect-artwork.svg');
  await page.locator('.graph-scroll').evaluate((el) => {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  });
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/editor-1600x900.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: render, parameter propagation, undo/redo, dynamic socket connection/disconnection, pen handles/close, Curve → Boolean → Remap → Output, save/reload, rejected load preservation, SVG download. No page errors.',
  );
} finally {
  await browser.close();
}
