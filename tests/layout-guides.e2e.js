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
const svg = () => page.evaluate(() => window.nect.export());
const edit = async (label, value) => {
  const input = page.getByRole('spinbutton', { name: label, exact: true });
  await input.fill(String(value));
  await input.press('Tab');
};
const click = (selector) => page.locator(selector).click();
const undo = () => click('[data-action="undo"]');
const redo = () => click('[data-action="redo"]');
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.waitForTimeout(300);
  const artwork = await svg();
  await click('[data-layer-guide]');
  assert.equal((await model()).layers[0].guide, true);
  assert.equal(await page.locator('.guide-layer-shape').count(), 1);
  assert.ok(!(await svg()).includes('<path'));
  await undo();
  assert.equal(await svg(), artwork);
  await redo();
  assert.equal((await model()).layers[0].guide, true);
  await click('[data-layer-lock]');
  assert.ok(await page.locator('[data-layer-guide]').isDisabled());
  await click('[data-layer-lock]');
  await click('[data-visible]');
  assert.equal(await page.locator('.guide-layer-shape').count(), 0);
  await click('[data-visible]');
  await click('[data-action="guides-panel"]');
  await page.getByLabel('Show guides', { exact: true }).uncheck();
  assert.equal(await page.locator('.guide-layer-shape').count(), 0);
  const hidden = await snapshot();
  // Use blank artboard coordinates; a hidden active guide must not move invisibly.
  const board = await page.locator('.artboard').boundingBox();
  await page.mouse.move(board.x + board.width * 0.8, board.y + board.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(board.x + board.width * 0.85, board.y + board.height * 0.8);
  await page.mouse.up();
  assert.equal(await snapshot(), hidden);
  await page.getByLabel('Show guides', { exact: true }).check();
  await click('[data-add-guide="x"]');
  await edit('Guide 1 position', 720);
  const manual = (await model()).editor.guides[0].id,
    before = await snapshot();
  await edit('Layout Columns', 4);
  await edit('Layout Rows', 2);
  await edit('Layout Margin X', 48);
  await edit('Layout Margin Y', 36);
  await edit('Layout Gutter X', 24);
  await edit('Layout Gutter Y', 18);
  await page.getByLabel('Preview layout', { exact: true }).check();
  assert.equal(await page.locator('.layout-preview').count(), 12);
  assert.equal(await snapshot(), before);
  await fs.mkdir('test-results', { recursive: true });
  await page.locator('.guides-panel').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: 'test-results/layout-grid-preview-1600x1000.png', fullPage: true });
  await click('[data-layout-cancel]');
  assert.equal(await page.locator('.layout-preview').count(), 0);
  assert.equal(await snapshot(), before);
  await edit('Layout Columns', 4);
  await edit('Layout Rows', 2);
  await edit('Layout Margin X', 48);
  await edit('Layout Margin Y', 36);
  await edit('Layout Gutter X', 24);
  await edit('Layout Gutter Y', 18);
  await click('[data-layout-apply]');
  assert.equal((await model()).editor.guides.length, 13);
  assert.equal((await model()).editor.guides[0].id, manual);
  await undo();
  assert.equal(await snapshot(), before);
  await redo();
  assert.equal((await model()).editor.guides.length, 13);
  await page.getByRole('spinbutton', { name: 'Layout Columns', exact: true }).fill('2');
  await click('[data-layout-apply]'); // Blur must not swallow the first click.
  assert.equal((await model()).editor.guides.length, 9);
  await click('[data-layout-apply]'); // Repeat updates replace, never append.
  assert.equal((await model()).editor.guides.length, 9);
  const valid = await snapshot();
  await edit('Layout Margin X', 900);
  assert.ok(await page.locator('[data-layout-apply]').isDisabled());
  await page.getByLabel('Preview layout', { exact: true }).check();
  assert.equal(await page.locator('.layout-preview').count(), 0);
  assert.equal(await snapshot(), valid);
  await click('[data-layout-cancel]');
  const generated = (await model()).editor.guides[1].id;
  await click(`[data-lock-guide="${generated}"]`);
  assert.ok(await page.locator('[data-layout-remove]').isDisabled());
  assert.ok(await page.locator('[data-layout-apply]').isDisabled());
  await click(`[data-lock-guide="${generated}"]`);
  await click('[data-layout-remove]');
  assert.deepEqual(
    (await model()).editor.guides.map((g) => g.id),
    [manual],
  );
  await undo();
  assert.equal((await model()).editor.guides.length, 9);
  await page.getByLabel('Preview layout', { exact: true }).check();
  await click('[data-action="guides-panel"]');
  assert.equal(await page.locator('.layout-preview').count(), 0);
  const saved = await snapshot();
  await page.evaluate((text) => window.nect.load(text), saved);
  assert.equal(await snapshot(), saved);
  assert.ok(!(await svg()).includes('<path'));
  await click('[data-layer-guide]');
  assert.equal(await svg(), artwork);
  // Snap an artwork composition to another guide layer's actual output bounds.
  await page.evaluate(async () => {
    const { document, layer, guideDefaults, connect } = await import('/src/core.js');
    const d = document();
    d.editor = guideDefaults();
    d.editor.snap = true;
    d.editor.snapArtboard = false;
    d.editor.snapGrid = false;
    const guide = layer('Reference');
    guide.guide = true;
    guide.locked = true;
    const rect = guide.nodes.find((n) => n.type === 'Rectangle');
    rect.params.center.value = [530, 300];
    rect.params.size.value = [100, 300];
    connect(guide, rect.id, guide.output, 'path');
    d.layers.push(guide);
    window.nect.load(JSON.stringify(d));
  });
  const move = async (x, y) => {
    const p = await page.locator('.artboard').evaluate(
      (el, p) => {
        const q = new DOMPoint(...p).matrixTransform(el.getScreenCTM());
        return { x: q.x, y: q.y };
      },
      [x, y],
    );
    await page.mouse.move(p.x, p.y);
  };
  const sourcePoint = await page.locator('.node-stage-move').evaluate((el) => {
    const p = new DOMPoint(0, 0)
      .matrixTransform(el.getScreenCTM())
      .matrixTransform(document.querySelector('.artboard').getScreenCTM().inverse());
    return [p.x, p.y];
  });
  await move(...sourcePoint);
  await page.mouse.down();
  await move(sourcePoint[0] + 8, sourcePoint[1]);
  await page.waitForTimeout(80);
  assert.equal((await model()).layers[0].nodes[0].params.center.value[0], 360);
  assert.ok(await page.locator('[data-snap-kind="guide-layer"]').count());
  await page.screenshot({ path: 'test-results/guide-layer-snap-1600x1000.png', fullPage: true });
  await page.mouse.up();
  await undo();
  await page.evaluate(() => {
    const d = structuredClone(window.nect.document);
    d.layers[1].visible = false;
    window.nect.load(JSON.stringify(d));
  });
  await move(...sourcePoint);
  await page.mouse.down();
  await move(sourcePoint[0] + 8, sourcePoint[1]);
  await page.mouse.up();
  assert.ok(Math.abs((await model()).layers[0].nodes[0].params.center.value[0] - 358) < 0.01);
  assert.deepEqual(errors, []);
  console.log(
    'Chrome guide-layer/layout tests passed: conversion, export, visibility, locks, bounds snapping, preview/cancel, validation, atomic update/remove, manual preservation, repeated use, undo/redo and reload.',
  );
} finally {
  await browser.close();
}
