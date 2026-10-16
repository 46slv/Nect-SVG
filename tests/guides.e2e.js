import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const model = () => page.evaluate(() => structuredClone(window.nect.document));
const snapshot = () => page.evaluate(() => JSON.stringify(window.nect.document));
const position = async (x, y) =>
  page.locator('.artboard').evaluate(
    (el, [x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM());
      return { x: p.x, y: p.y };
    },
    [x, y],
  );
const move = async (x, y) => {
  const p = await position(x, y);
  await page.mouse.move(p.x, p.y);
};
const edit = async (label, value) => {
  const el = page.getByRole('spinbutton', { name: label, exact: true });
  await el.fill(String(value));
  await el.press('Tab');
};
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.waitForTimeout(300);
  const originalSVG = await page.evaluate(() => window.nect.export());
  await page.getByRole('button', { name: 'Guides', exact: true }).click();
  await page.getByRole('button', { name: '+ Vertical', exact: true }).click();
  await edit('Guide 1 position', 600);
  await page.getByRole('button', { name: '+ Horizontal', exact: true }).click();
  await edit('Guide 2 position', 200);
  await page.getByLabel('Show grid', { exact: true }).check();
  await edit('Grid spacing', 20);
  await page.getByRole('button', { name: 'Snap', exact: true }).click();
  assert.equal(await page.evaluate(() => window.nect.export()), originalSVG);
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/guides-panel-1600x1000.png', fullPage: true });
  await page.getByRole('button', { name: 'Guides', exact: true }).click();
  const before = await snapshot();
  await move(600, 400);
  await page.mouse.down();
  await move(650, 400);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await snapshot(), before);
  await move(600, 400);
  await page.mouse.down();
  await move(650, 400);
  await page.mouse.up();
  assert.ok(Math.abs((await model()).editor.guides[0].position - 650) < 0.01);
  await page.getByTitle('Ctrl+Z', { exact: true }).click();
  assert.equal((await model()).editor.guides[0].position, 600);
  await page.getByTitle('Ctrl+Shift+Z', { exact: true }).click();
  assert.ok(Math.abs((await model()).editor.guides[0].position - 650) < 0.01);
  await page.getByRole('button', { name: 'Guides', exact: true }).click();
  await page.getByRole('button', { name: 'Lock guide 1', exact: true }).click();
  assert.ok(
    await page.getByRole('spinbutton', { name: 'Guide 1 position', exact: true }).isDisabled(),
  );
  await page.getByRole('button', { name: 'Guides', exact: true }).click();
  const locked = await snapshot();
  await move(650, 400);
  await page.mouse.down();
  await move(680, 400);
  await page.mouse.up();
  assert.equal(await snapshot(), locked);
  // Pointing at the shape away from its center still aligns its actual right bound.
  await page.evaluate(() => {
    const d = structuredClone(window.nect.document);
    d.editor.guides[0].position = 480;
    d.editor.guides[1].position = 400;
    d.editor.snapGrid = false;
    d.editor.snapArtboard = false;
    window.nect.load(JSON.stringify(d));
  });
  const sourcePointAt = () =>
    page.locator('.node-stage-move').evaluate((el) => {
      const p = new DOMPoint(0, 0)
        .matrixTransform(el.getScreenCTM())
        .matrixTransform(document.querySelector('.artboard').getScreenCTM().inverse());
      return [p.x, p.y];
    });
  let sourcePoint = await sourcePointAt();
  await move(...sourcePoint);
  await page.mouse.down();
  await move(sourcePoint[0] + 8, sourcePoint[1]);
  await page.waitForTimeout(60);
  assert.equal((await model()).layers[0].nodes[0].params.center.value[0], 360);
  assert.ok(await page.locator('[data-snap-kind="guide"]').count());
  await page.screenshot({
    path: 'test-results/guides-snap-feedback-1600x1000.png',
    fullPage: true,
  });
  await page.mouse.up();
  await page.getByTitle('Ctrl+Z', { exact: true }).click();
  // Alt bypasses snapping without disabling the stored snap mode.
  await page.keyboard.down('Alt');
  await move(...sourcePoint);
  await page.mouse.down();
  await move(sourcePoint[0] + 8, sourcePoint[1]);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  assert.ok(Math.abs((await model()).layers[0].nodes[0].params.center.value[0] - 358) < 0.01);
  await page.getByTitle('Ctrl+Z', { exact: true }).click();
  // Visibility and lock semantics survive JSON reload; hidden guides cannot attract.
  await page.getByRole('button', { name: 'Guides', exact: true }).click();
  await page.getByLabel('Show guides', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Guides', exact: true }).click();
  assert.equal(await page.locator('.editing-guide').count(), 0);
  await move(...sourcePoint);
  await page.mouse.down();
  await move(sourcePoint[0] + 8, sourcePoint[1]);
  await page.mouse.up();
  assert.ok(Math.abs((await model()).layers[0].nodes[0].params.center.value[0] - 358) < 0.01);
  await page.getByTitle('Ctrl+Z', { exact: true }).click();
  await page.getByRole('button', { name: 'Guides', exact: true }).click();
  await page.getByLabel('Show guides', { exact: true }).check();
  await page.getByLabel('Snap artboard', { exact: true }).check();
  await page.getByLabel('Snap guides', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Guides', exact: true }).click();
  await move(...sourcePoint);
  await page.mouse.down();
  await move(sourcePoint[0] + 8, sourcePoint[1]);
  await page.mouse.up();
  assert.equal((await model()).layers[0].nodes[0].params.center.value[0], 360);
  await page.getByTitle('Ctrl+Z', { exact: true }).click();
  // Screen-pixel threshold remains constant after zooming.
  await page.getByRole('button', { name: 'Artboard zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Artboard zoom in', exact: true }).click();
  const scale = await page.locator('.artboard').evaluate((el) => el.getScreenCTM().a);
  sourcePoint = await sourcePointAt();
  await move(...sourcePoint);
  await page.mouse.down();
  await move(sourcePoint[0] + 10 - 5 / scale, sourcePoint[1]);
  await page.mouse.up();
  assert.equal((await model()).layers[0].nodes[0].params.center.value[0], 360);
  await page.getByTitle('Ctrl+Z', { exact: true }).click();
  await move(...sourcePoint);
  await page.mouse.down();
  await move(sourcePoint[0] + 10 - 8 / scale, sourcePoint[1]);
  await page.mouse.up();
  assert.ok(
    Math.abs((await model()).layers[0].nodes[0].params.center.value[0] - (360 - 8 / scale)) < 0.01,
  );
  await page.getByTitle('Ctrl+Z', { exact: true }).click();
  await page.getByRole('button', { name: 'Fit artboard', exact: true }).click();
  const saved = await snapshot(),
    svg = await page.evaluate(() => window.nect.export());
  await page.evaluate((text) => window.nect.load(text), saved);
  assert.equal(await snapshot(), saved);
  assert.equal(await page.evaluate(() => window.nect.export()), svg);
  assert.ok(!svg.includes('guide') && !svg.includes('pattern'));
  // Delete in a number input edits the field, not a guide or generator.
  await page.getByRole('button', { name: 'Guides', exact: true }).click();
  await page.getByRole('button', { name: 'Select guide 2', exact: true }).click();
  const input = page.getByRole('spinbutton', { name: 'Guide 2 position', exact: true });
  await input.focus();
  await input.press('Delete');
  assert.equal((await model()).editor.guides.length, 2);
  await input.fill('400');
  await input.press('Tab');
  await page.getByRole('button', { name: 'Select guide 2', exact: true }).click();
  await page.keyboard.press('Delete');
  assert.equal((await model()).editor.guides.length, 1);
  await page.getByTitle('Ctrl+Z', { exact: true }).click();
  assert.equal((await model()).editor.guides.length, 2);
  assert.deepEqual(errors, []);
  console.log(
    'Chrome guide interactions passed: numeric controls, real drags, lock, hidden, Alt, bounds, zoom, feedback, cancel, undo, reload, SVG isolation.',
  );
} finally {
  await browser.close();
}
