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
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  const example = await fs.readFile('examples/right-aligned-typography-group.json', 'utf8');
  await page.evaluate((s) => window.nect.load(s), example);
  const id = await page.evaluate(() => window.nect.document.layers[0].nodes[0].id);
  const inspector = page.locator('.inspector-body');
  assert.equal(await inspector.locator('[data-text-alignment]').count(), 1);
  assert.equal(await inspector.locator('[data-reference-bounds]').inputValue(), 'visible');
  const bounds = () =>
    page.evaluate(async () => {
      const { pathBounds } = await import('/src/core.js');
      const r = window.nect.evaluate();
      return window.nect.document.layers[0].nodes
        .filter((n) => n.type === 'Text')
        .map((n) => pathBounds(r.run(n.id)));
    });
  for (const b of await bounds()) assert.ok(Math.abs(b[0][2] - 780) < 0.00002);
  const size = inspector.locator(`[data-node="${id}"][data-key="size"] [data-value]`);
  await size.fill('100');
  await size.press('Tab');
  for (const b of await bounds()) assert.ok(Math.abs(b[0][2] - 780) < 0.00002);
  await inspector.locator('[data-text]').fill('A much longer headline');
  await inspector.locator('[data-text]').press('Tab');
  for (const b of await bounds()) assert.ok(Math.abs(b[0][2] - 780) < 0.00002);
  await inspector.locator('[data-cross-alignment]').selectOption('end');
  assert.ok(Math.abs((await bounds())[0][1][2] - 260) < 0.00002);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await inspector.locator('[data-cross-alignment]').inputValue(), 'origin');
  await page.locator('[data-action="redo"]').click();
  await inspector.locator('[data-reference-bounds]').selectOption('advance');
  assert.ok(Math.abs((await bounds())[0][0][2] - 780) > 0.01);
  await page.evaluate((s) => window.nect.load(s), example);
  // Canvas drag uses the unchanged Position parameter; snap resolves the generated visible bounds.
  await page.getByRole('button', { name: 'Guides', exact: true }).click();
  await page.getByRole('button', { name: '+ Vertical', exact: true }).click();
  const guide = page.getByRole('spinbutton', { name: 'Guide 1 position', exact: true });
  await guide.fill('800');
  await guide.press('Tab');
  const snap = page.getByRole('button', { name: 'Snap', exact: true });
  if ((await snap.getAttribute('aria-pressed')) !== 'true') await snap.click();
  await page.getByRole('button', { name: 'Guides', exact: true }).click();
  const screen = async (x, y) =>
    page.locator('.artboard').evaluate(
      (el, [x, y]) => {
        const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM());
        return { x: p.x, y: p.y };
      },
      [x, y],
    );
  const marker = await page.locator('.node-stage-move rect').boundingBox(),
    from = { x: marker.x + marker.width / 2, y: marker.y + marker.height / 2 },
    origin = await screen(0, 0),
    delta = await screen(19, 0),
    to = { x: from.x + delta.x - origin.x, y: from.y + delta.y - origin.y };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  const moved = await page.evaluate(
    () => window.nect.document.layers[0].nodes[0].params.position.value,
  );
  assert.ok(Math.abs(moved[0] - 800) < 0.1, JSON.stringify(moved));
  assert.ok(Math.abs((await bounds())[0][0][2] - 800) < 0.1);
  await page.locator('[data-action="undo"]').click();
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[0].nodes[0].params.position.value[0]),
    780,
  );
  // Shape's reference remains stable through resize and a connected Position.
  await page.evaluate(async () => {
    const { document, node, connect } = await import('/src/core.js');
    const d = document(),
      l = d.layers[0],
      n = node('Rectangle'),
      out = node('Output');
    n.params.center.value = [500, 300];
    n.positionReference = 'right-bottom';
    l.nodes = [n, out];
    l.output = out.id;
    connect(l, n.id, out.id, 'path');
    window.nect.load(JSON.stringify(d));
  });
  await inspector.locator('[data-position-reference]').selectOption('left-top');
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[0].nodes[0].params.center.value[0]),
    500,
  );
  await page.locator('[data-action="undo"]').click();
  assert.equal(await inspector.locator('[data-position-reference]').inputValue(), 'right-bottom');
  await page.evaluate((s) => window.nect.load(s), example);
  await fs.mkdir('test-results', { recursive: true });
  for (const [action, ext] of [
    ['save', 'json'],
    ['export', 'svg'],
    ['export-png', 'png'],
  ]) {
    const pending = page.waitForEvent('download');
    await page.locator(`[data-action="${action}"]`).click();
    await (await pending).saveAs(`test-results/workflow-object-position-references.${ext}`);
  }
  await page
    .locator('.artboard')
    .screenshot({ path: 'test-results/workflow-object-position-references-artwork.png' });
  await page.screenshot({
    path: 'test-results/workflow-object-position-references-editor.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'PASS object Position references: ink alignment, edit, size, cross-axis, legacy, Undo/Redo, canvas snap/drag, shape UI and JSON/SVG/PNG',
  );
} finally {
  await browser.close();
}
