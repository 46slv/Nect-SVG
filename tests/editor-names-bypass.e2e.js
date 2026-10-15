import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nect-names-bypass-'));
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.evaluate(async () => {
    const { document, node, layer, connect } = await import('/src/core.js');
    const doc = document(),
      l = doc.layers[0],
      shape = node('Rectangle', 40, 40),
      effect = node('Transform', 360, 40),
      fill = node('Fill', 680, 40),
      out = node('Output', 1000, 40);
    l.id = 'names-layer';
    l.name = 'Foreground';
    shape.id = 'names-shape';
    effect.id = 'names-effect';
    fill.id = 'names-fill';
    out.id = 'names-out';
    for (const n of [shape, effect, fill, out]) n.collapsed = true;
    effect.params.offset.value = [100, 30];
    l.nodes = [shape, effect, fill, out];
    l.output = out.id;
    connect(l, shape.id, effect.id, 'path');
    connect(l, effect.id, fill.id, 'path');
    connect(l, fill.id, out.id, 'path');
    const other = layer('Background');
    other.id = 'names-other';
    other.visible = false;
    doc.layers.push(other);
    window.nect.load(JSON.stringify(doc));
  });
  const saved = () => page.evaluate(() => JSON.stringify(window.nect.document)),
    get = (id) =>
      page.evaluate((id) => window.nect.document.layers[0].nodes.find((n) => n.id === id), id),
    svg = () => page.evaluate(() => window.nect.export()),
    title = (id) => page.locator(`[data-rename-node="${id}"]`),
    name = () => page.locator('[data-rename-name]'),
    undo = () => page.locator('[data-action="undo"]').click(),
    redo = () => page.locator('[data-action="redo"]').click();
  const initial = await saved(),
    originalSVG = await svg();
  // Actual Chromium event sequence, including pointer capture and first-click selection render.
  await title('names-effect').dblclick();
  await name().waitFor();
  assert.equal(await saved(), initial);
  await name().fill('Move 日本語 <&>');
  await name().press('Enter');
  assert.equal((await get('names-effect')).name, 'Move 日本語 <&>');
  assert.equal(await svg(), originalSVG);
  const renamed = await saved();
  await undo();
  assert.equal(await saved(), initial);
  await redo();
  assert.equal(await saved(), renamed);
  await title('names-effect').dblclick();
  await name().fill('cancelled');
  await name().press('Escape');
  assert.equal(await saved(), renamed);
  await title('names-effect').dblclick();
  await name().fill('  ');
  await name().press('Enter');
  assert.equal(await saved(), renamed);
  await title('names-effect').dblclick();
  await name().press('Enter');
  await undo();
  assert.equal(await saved(), initial);
  await redo();
  await title('names-shape').dblclick();
  await name().fill('Geometry');
  await name().press('Tab');
  await page.waitForFunction(
    () =>
      window.nect.document.layers[0].nodes[0].name === 'Geometry' &&
      !document.querySelector('[data-rename-name]'),
  );
  const bothRenamed = await saved();
  await undo();
  assert.equal(await saved(), renamed);
  await redo();
  assert.equal(await saved(), bothRenamed);
  // Japanese composition remains a draft until it completes; Enter during conversion never commits.
  await title('names-effect').dblclick();
  await name().evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.value = '変換中';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    );
  });
  assert.equal(await saved(), bothRenamed);
  assert.equal(await name().count(), 1);
  await name().evaluate((el) => {
    el.value = '変換完了';
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  await name().press('Enter');
  assert.equal((await get('names-effect')).name, '変換完了');
  await undo();
  assert.equal(await saved(), bothRenamed);
  await redo();
  // Long names are safely escaped and do not expand a collapsed node beyond its authored width.
  await title('names-effect').press('F2');
  await name().fill('Long <script> & name '.repeat(20));
  await name().press('Enter');
  assert.equal(await page.locator('.node[data-id="names-effect"] script').count(), 0);
  assert.ok((await page.locator('.node[data-id="names-effect"]').boundingBox()).width <= 266);
  await undo();
  // A real drag from the same title still moves the node and is exactly one history step.
  const beforeDrag = await saved(),
    p = (await get('names-effect')).position,
    b = await title('names-effect').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 50, b.y + b.height / 2 + 35, { steps: 5 });
  await page.mouse.up();
  const moved = (await get('names-effect')).position;
  assert.ok(moved[0] > p[0] + 45 && moved[1] > p[1] + 30);
  assert.equal(await name().count(), 0);
  await undo();
  assert.equal(await saved(), beforeDrag);
  // First click changes layers; second must still begin inline naming after its structural render.
  await page.locator('[data-select-layer="names-other"]').dblclick();
  await name().fill('Hidden Background');
  await name().press('Enter');
  assert.equal(await page.evaluate(() => window.nect.document.layers[1].name), 'Hidden Background');
  await page.locator('[data-select-layer="names-layer"]').click();
  const beforeHide = await saved(),
    visibleSVG = await svg();
  const visibility = () => page.locator('[data-visible="names-layer"]');
  await visibility().click();
  assert.equal(await visibility().innerText(), 'Show');
  assert.equal(await visibility().getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.shape[data-layer="names-layer"]').count(), 0);
  const hiddenSVG = await svg();
  assert.notEqual(hiddenSVG, visibleSVG);
  const raster = await page.evaluate(
    async ({ visibleSVG, hiddenSVG }) => {
      const { rasterizeSVG } = await import('/src/raster.js');
      const ink = async (svg) => {
        const image = await createImageBitmap(await rasterizeSVG(svg, { width: 960, height: 540 })),
          canvas = document.createElement('canvas');
        canvas.width = 960;
        canvas.height = 540;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, 960, 540).data.some((v, i) => i % 4 === 3 && v > 0);
      };
      return { visible: await ink(visibleSVG), hidden: await ink(hiddenSVG) };
    },
    { visibleSVG, hiddenSVG },
  );
  assert.deepEqual(raster, { visible: true, hidden: false });
  const hidden = await saved();
  await page.evaluate((json) => window.nect.load(json), hidden);
  assert.equal(await svg(), hiddenSVG);
  // Hidden + locked is still selectable and visibility is a view/output choice.
  await page.locator('[data-layer-lock="names-layer"]').click();
  await visibility().click();
  assert.equal(await svg(), visibleSVG);
  await title('names-shape').press('F2');
  assert.equal(await name().count(), 0);
  assert.equal(
    await page.locator('.node[data-id="names-effect"] [data-bypass]').isDisabled(),
    true,
  );
  await page.locator('[data-layer-lock="names-layer"]').click();
  await page.evaluate((json) => window.nect.load(json), beforeHide);
  // Preserve every node, input and setting through bypass, Undo/Redo, JSON and cold CLI export.
  const effectBefore = await get('names-effect'),
    normal = await svg(),
    bypass = () => page.locator('.node[data-id="names-effect"] [data-bypass]');
  await bypass().click();
  assert.equal((await get('names-effect')).bypassed, true);
  assert.equal(await bypass().getAttribute('aria-pressed'), 'true');
  assert.deepEqual((await get('names-effect')).params, effectBefore.params);
  assert.notEqual(await svg(), normal);
  await title('names-effect').click();
  assert.equal(await page.locator('[data-transform-handle]').count(), 0);
  const bypassed = await saved(),
    bypassSVG = await svg();
  await undo();
  assert.equal((await get('names-effect')).bypassed, undefined);
  assert.equal(await svg(), normal);
  await redo();
  assert.equal(await saved(), bypassed);
  await bypass().click();
  assert.equal(await svg(), normal);
  assert.deepEqual((await get('names-effect')).params, effectBefore.params);
  await undo();
  await page.evaluate((json) => window.nect.load(json), bypassed);
  assert.equal(await svg(), bypassSVG);
  await fs.writeFile(path.join(temp, 'project.json'), bypassed);
  execFileSync(process.execPath, [
    'cli/export.js',
    path.join(temp, 'project.json'),
    path.join(temp, 'project.svg'),
  ]);
  assert.equal(await fs.readFile(path.join(temp, 'project.svg'), 'utf8'), bypassSVG);
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/workflow-names-bypass.json', bypassed);
  await fs.writeFile('test-results/workflow-names-bypass.svg', bypassSVG);
  await fs.writeFile(
    'test-results/workflow-visibility-raster.json',
    JSON.stringify(raster, null, 2),
  );
  for (const viewport of [
    { width: 1600, height: 1000 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({
      path: `test-results/names-bypass-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'Actual title double-click/F2, IME draft/cancel/blur/no-op/history, graph drag, visibility canvas/SVG/PNG and typed reversible bypass JSON/CLI passed',
  );
} finally {
  await browser.close();
  await fs.rm(temp, { recursive: true, force: true });
}
