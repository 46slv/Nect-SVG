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
const sample = await fs.readFile('examples/artwork-bounds-snapping.json', 'utf8');
const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
const pos = () =>
  page.evaluate(() => window.nect.document.layers[0].nodes[0].params.position.value);
const near = (actual, expected) =>
  actual.forEach((v, i) =>
    assert.ok(Math.abs(v - expected[i]) < 0.001, `${actual} != ${expected}`),
  );
const screen = (p) =>
  page.locator('.artboard').evaluate((el, p) => {
    const q = new DOMPoint(...p).matrixTransform(el.getScreenCTM());
    return [q.x, q.y];
  }, p);
const load = async () => {
  await page.evaluate((s) => window.nect.load(s), sample);
  await page.locator('[data-null-handle]').waitFor();
  // Text may exist before the asynchronously loaded bundled font has outlines.
  await page.waitForFunction(() => {
    const shape = document.querySelector('.shape[data-layer="layer-snap-text"]');
    const bounds = shape?.getBBox();
    return bounds && bounds.width > 0 && bounds.height > 0;
  });
};
const start = async () => {
  await page.mouse.move(...(await screen(await pos())));
  await page.mouse.down();
};
const move = async (p) => page.mouse.move(...(await screen(p)), { steps: 5 });
const undo = () => page.locator('[data-action="undo"]').click();
const drag = async (p) => {
  await start();
  await move(p);
  await page.mouse.up();
};
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.waitForFunction(() => window.nect.evaluate().error === null);
  await load();
  const before = await saved(),
    originalSVG = await page.evaluate(() => window.nect.export());
  for (const target of [
    [400, 160],
    [490, 250],
    [580, 340],
    [660, 300],
    [730, 345],
    [800, 390],
  ]) {
    await drag(target.map((v) => v - 1));
    near(await pos(), target);
    await undo();
    assert.equal(await saved(), before);
  }
  // Real font outlines, including their final evaluated bounds, are regular targets.
  // Resolve the current path and read its bounds atomically: an outstanding
  // canvas frame after Undo can replace the path between locator calls.
  const textBoundsHandle = await page.waitForFunction(() => {
    const shape = document.querySelector('.shape[data-layer="layer-snap-text"]');
    const b = shape?.getBBox();
    return b && b.width > 0 && b.height > 0
      ? [
          [b.x, b.x + b.width / 2, b.x + b.width],
          [b.y, b.y + b.height / 2, b.y + b.height],
        ]
      : false;
  });
  const textBounds = await textBoundsHandle.jsonValue();
  await textBoundsHandle.dispose();
  await drag([textBounds[0][1] - 1, textBounds[1][1] - 1]);
  near(await pos(), [textBounds[0][1], textBounds[1][1]]);
  await undo();
  await page.keyboard.down('Alt');
  await drag([398, 158]);
  await page.keyboard.up('Alt');
  near(await pos(), [398, 158]);
  await undo();
  await start();
  await move([398, 158]);
  await page.waitForFunction(
    () => document.querySelectorAll('[data-snap-kind="artwork"]').length === 2,
  );
  assert.equal(await page.locator('[data-snap-kind="artwork"]').count(), 2);
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/artwork-snap-drag.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await saved(), before);
  assert.equal(await page.locator('[data-snap-kind]').count(), 0);
  // Locked references continue to snap; hidden references immediately stop.
  await page.locator('[data-visible="layer-snap-reference"]').click();
  await drag([398, 180]);
  assert.ok(Math.abs((await pos())[0] - 398) < 0.001);
  await undo();
  await page.locator('[data-visible="layer-snap-reference"]').click();
  await drag([398, 180]);
  assert.equal((await pos())[0], 400);
  await undo();
  await page.locator('[data-action="guides-panel"]').click();
  await page.locator('[data-guide-setting="snapArtwork"]').uncheck();
  await drag([398, 158]);
  near(await pos(), [398, 158]);
  await undo();
  await page.locator('[data-guide-setting="snapArtwork"]').check();
  await page.locator('[data-guide-setting="visible"]').uncheck();
  await drag([398, 158]);
  near(await pos(), [400, 160]);
  await undo();
  await page.locator('[data-action="guides-panel"]').click();
  // Numeric entry remains literal with artwork snapping enabled.
  const input = page.locator('.inspector-body [data-key="position"] [data-axis="0"]');
  await input.fill('399');
  await input.press('Tab');
  assert.equal((await pos())[0], 399);
  await undo();
  // Pan/zoom keep the tolerance in screen pixels.
  await load();
  await page.locator('[data-action="zoom-in"]').click();
  const p = await screen([200, 400]);
  await page.mouse.move(...p);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(p[0] + 22, p[1] - 12);
  await page.mouse.up({ button: 'middle' });
  const scale = await page
    .locator('.artboard')
    .evaluate((el) => Math.hypot(el.getScreenCTM().a, el.getScreenCTM().b));
  await drag([400 - 5.9 / scale, 180]);
  assert.equal((await pos())[0], 400);
  await undo();
  await drag([400 - 6.1 / scale, 180]);
  assert.ok(Math.abs((await pos())[0] - (400 - 6.1 / scale)) < 0.001);
  await undo();
  // Gesture persistence, Undo/Redo and standalone exports retain only geometry.
  await drag([488, 248]);
  near(await pos(), [490, 250]);
  const completed = await saved();
  await undo();
  assert.equal(await saved(), before);
  await page.locator('[data-action="redo"]').click();
  assert.equal(await saved(), completed);
  await page.evaluate((s) => window.nect.load(s), completed);
  near(await pos(), [490, 250]);
  const svg = await page.evaluate(() => window.nect.export());
  assert.ok(!/snap-match|position-marker|data-snap-kind/.test(svg));
  assert.notEqual(svg, originalSVG);
  const png = await page.evaluate(async () => {
    const { rasterizeSVG, pngDimensions } = await import('/src/raster.js');
    const blob = await rasterizeSVG(window.nect.export(), { width: 960, height: 540 });
    return {
      type: blob.type,
      bytes: blob.size,
      dimensions: pngDimensions(window.nect.document, 1),
    };
  });
  assert.equal(png.type, 'image/png');
  assert.ok(png.bytes > 1000);
  assert.deepEqual(png.dimensions, { width: 960, height: 540 });
  await fs.writeFile('test-results/workflow-artwork-snap.json', completed + '\n');
  await fs.writeFile('test-results/workflow-artwork-snap.svg', svg);
  await page.screenshot({ path: 'test-results/artwork-snap-complete.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'Artwork bounds snapping: shape/text/image targets, locked/hidden, Alt, pan/zoom, numeric isolation, history, reload and SVG/PNG passed',
  );
} finally {
  await browser.close();
}
