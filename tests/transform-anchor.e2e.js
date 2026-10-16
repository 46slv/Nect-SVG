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
  await page.evaluate(
    (s) => window.nect.load(s),
    await fs.readFile('examples/right-aligned-typography-group.json', 'utf8'),
  );
  const id = await page.evaluate(
    () => window.nect.document.layers[0].nodes.find((n) => n.type === 'Transform').id,
  );
  await page.locator(`.node[data-id="${id}"] .node-head strong`).click();
  const field = (k) => page.locator(`.inspector-body .field[data-node="${id}"][data-key="${k}"]`);
  assert.equal(await field('anchor').locator('[data-value]').first().inputValue(), '780');
  const children = await page.evaluate(() =>
    JSON.stringify(window.nect.document.layers[0].nodes.slice(0, 2)),
  );
  const input = field('scale').locator('[data-value]');
  await input.fill('0.8');
  await input.press('Tab');
  const rotation = field('rotation').locator('[data-value]');
  await rotation.fill('10');
  await rotation.press('Tab');
  assert.equal(await page.evaluate(() => window.nect.evaluate().error), null);
  // Tab commits before the deferred structural render/fit has settled. Let
  // Playwright wait for the live marker to be stable and receive pointer hits.
  await page.locator('.node-stage-move rect').hover();
  const marker = await page.locator('.node-stage-move rect').boundingBox();
  const pt = { x: marker.x + marker.width / 2, y: marker.y + marker.height / 2 };
  assert.equal(
    await page.evaluate(
      (pt) => !!document.elementFromPoint(pt.x, pt.y)?.closest('.node-stage-move'),
      pt,
    ),
    true,
  );
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x + 30, pt.y + 20, { steps: 4 });
  await page.mouse.up();
  assert.notDeepEqual(
    await page.evaluate(() => window.nect.document.layers[0].nodes[3].params.offset.value),
    [0, 0],
  );
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.nect.document.layers[0].nodes.slice(0, 2))),
    children,
  );
  await page.locator('[data-action="undo"]').click();
  assert.deepEqual(
    await page.evaluate(() => window.nect.document.layers[0].nodes[3].params.offset.value),
    [0, 0],
  );
  await page.locator('[data-action="redo"]').click();
  await fs.mkdir('test-results', { recursive: true });
  for (const [action, ext] of [
    ['save', 'json'],
    ['export', 'svg'],
    ['export-png', 'png'],
  ]) {
    const pending = page.waitForEvent('download');
    await page.locator(`[data-action="${action}"]`).click();
    await (await pending).saveAs(`test-results/workflow-transform-anchor.${ext}`);
  }
  const saved = await fs.readFile('test-results/workflow-transform-anchor.json', 'utf8');
  await page.evaluate((s) => window.nect.load(s), saved);
  assert.deepEqual(
    await page.evaluate(() => window.nect.document.layers[0].nodes[3].params.anchor.value),
    [780, 310],
  );
  assert.equal(await page.evaluate(() => window.nect.evaluate().error), null);
  await page.screenshot({
    path: 'test-results/workflow-transform-anchor-editor.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'PASS existing Transform pivot, joined right-aligned type, group drag, child preservation, history, JSON/SVG/PNG',
  );
} finally {
  await browser.close();
}
