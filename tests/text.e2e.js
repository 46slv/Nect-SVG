import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { deserialize, exportSVG, node, layer } from '../src/core.js';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const fixture = 'tests/fixtures/fonts/NectJPFixture-Regular.otf';
const text = '「日本。、」ABC12\n（文章）ーぁ';
const snapshot = () => page.evaluate(() => JSON.stringify(window.nect.document));
async function commit(selector, value) {
  const input = page.locator(`.inspector-body ${selector}`);
  await input.fill(String(value));
  await input.dispatchEvent('change');
  await page.waitForTimeout(40);
}
async function chooseFont(file) {
  const choosing = page.waitForEvent('filechooser');
  await page.locator('.inspector-body [data-load-font]').click();
  const chooser = await choosing;
  await chooser.setFiles(file);
  await page.waitForTimeout(80);
}
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.locator('[data-tool="Text"]').click();
  await page
    .locator('.graph .node')
    .filter({ has: page.locator('[data-text]') })
    .locator('.node-head strong')
    .click();
  await commit('[data-text]', text);
  assert.match(await page.locator('.warning').textContent(), /Missing glyphs/);
  const beforeCancel = await snapshot();
  await chooseFont([]);
  assert.equal(await snapshot(), beforeCancel);
  await chooseFont({ name: 'broken.otf', mimeType: 'font/otf', buffer: Buffer.from('not a font') });
  assert.match(await page.locator('.message').textContent(), /Font rejected/);
  assert.equal(await snapshot(), beforeCancel);
  await chooseFont(fixture);
  assert.match(await page.locator('.message').textContent(), /Loaded Nect JP Fixture/);
  assert.equal(await page.locator('.warning').count(), 0);
  assert.equal(await page.evaluate(() => Object.keys(window.nect.document.fontAssets).length), 1);
  await commit('[aria-label="Text size"]', 42);
  await commit('[aria-label="Text position X"]', 730);
  await commit('[aria-label="Text position Y"]', 25);
  const horizontal = await page.evaluate(() => window.nect.export());
  await page.locator('.inspector-body [data-writing-mode]').selectOption('vertical-rl');
  await page.waitForTimeout(40);
  const vertical = await page.evaluate(() => window.nect.export());
  assert.notEqual(vertical, horizontal);
  assert.doesNotMatch(vertical, /<text|NaN|Infinity/);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await page.evaluate(() => window.nect.export()), horizontal);
  await page.locator('[data-action="redo"]').click();
  assert.equal(await page.evaluate(() => window.nect.export()), vertical);
  await commit('[aria-label="Text letterSpacing"]', 3);
  await commit('[aria-label="Text lineSpacing"]', 1.6);
  assert.notEqual(await page.evaluate(() => window.nect.export()), vertical);
  const saveEvent = page.waitForEvent('download');
  await page.locator('[data-action="save"]').click();
  await fs.mkdir('test-results', { recursive: true });
  const download = await saveEvent;
  await download.saveAs('test-results/japanese-vertical-project.json');
  const json = await fs.readFile('test-results/japanese-vertical-project.json', 'utf8');
  const svg = await page.evaluate(() => window.nect.export());
  assert.equal(exportSVG(deserialize(json)), svg);
  await page.reload();
  await page.waitForSelector('.shape');
  // Reload via the real file chooser, with an empty in-memory font cache.
  const opening = page.waitForEvent('filechooser');
  await page.locator('[data-action="open"]').click();
  await (await opening).setFiles('test-results/japanese-vertical-project.json');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.nect.export()), svg);
  // Select the restored Text and edit a previously unused character, proving full bytes survived.
  const restoredLayer = await page.evaluate(
    () => window.nect.document.layers.find((l) => l.nodes.some((n) => n.type === 'Text')).id,
  );
  await page.locator(`[data-select-layer="${restoredLayer}"]`).click();
  await page
    .locator('.node')
    .filter({ has: page.locator('[data-text]') })
    .locator('.node-head strong')
    .click();
  await page.waitForTimeout(30);
  await commit('[data-text]', '世界麺\nガパヴ');
  assert.equal(await page.locator('.warning').count(), 0);
  assert.notEqual(await page.evaluate(() => window.nect.export()), svg);
  const beforeDuplicate = await snapshot();
  await chooseFont(fixture);
  assert.equal(await snapshot(), beforeDuplicate); // Same bytes reuse the existing asset, no new history step.
  // Imported asset can be selected from a second Text node in the same project.
  const fontId = await page.evaluate(() => Object.keys(window.nect.document.fontAssets)[0]);
  await page.locator('[data-tool="Text"]').click();
  await page
    .locator('.graph .node')
    .filter({ has: page.locator('[data-text]') })
    .locator('.node-head strong')
    .click();
  await page.locator('.inspector-body [data-font]').selectOption(fontId);
  await commit('[data-text]', '日本語');
  assert.equal(await page.locator('.warning').count(), 0);
  // A pending read may not replace edits made after choosing the file.
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      File.prototype.arrayBuffer = original;
      return original.call(this).then(
        (bytes) =>
          new Promise((resolve) => {
            window.finishFontRead = () => resolve(bytes);
          }),
      );
    };
  });
  const choosing = page.waitForEvent('filechooser');
  await page.locator('.inspector-body [data-load-font]').click();
  await (await choosing).setFiles('tests/fixtures/fonts/NectJPFixture-Regular.ttf');
  await page.waitForFunction(() => typeof window.finishFontRead === 'function');
  await commit('[data-text]', '日本語世界');
  const whileReading = await snapshot();
  await page.evaluate(() => window.finishFontRead());
  await page.waitForTimeout(60);
  assert.equal(await snapshot(), whileReading);
  assert.match(await page.locator('.message').textContent(), /Document changed while reading/);
  await chooseFont('tests/fixtures/fonts/NectJPFixture-Regular.ttf');
  assert.match(await page.locator('.message').textContent(), /Loaded Nect JP Fixture TTF/);
  assert.equal(await page.evaluate(() => Object.keys(window.nect.document.fontAssets).length), 2);
  // Invalid font assets and dangling font references preserve the currently open document.
  const valid = await snapshot();
  const rejected = await page.evaluate(() => {
    const doc = structuredClone(window.nect.document);
    doc.fontAssets = {};
    try {
      window.nect.load(JSON.stringify(doc));
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(rejected, true);
  assert.equal(await snapshot(), valid);
  // A compact showcase uses the same saved font and editable nodes, without CSS text rendering.
  const showcase = deserialize(valid);
  showcase.width = 960;
  showcase.height = 540;
  showcase.name = 'Japanese text · horizontal and vertical outlines';
  showcase.layers = [];
  for (const [index, mode] of ['horizontal-tb', 'vertical-rl'].entries()) {
    const composition = layer(index ? 'Vertical · right to left' : 'Horizontal · Japanese OTF');
    const t = node('Text', 40, 40),
      paint = node('Fill', 390, 40),
      out = node('Output', 700, 40);
    t.text = index ? text : '日本語、。ー（文章）\nNect SVG · ガパヴ';
    t.font = fontId;
    t.writingMode = mode;
    t.params.position.value = index ? [775, 25] : [55, 90];
    t.params.size.value = index ? 40 : 32;
    t.params.lineSpacing.value = 1.6;
    paint.params.path.source = t.id;
    paint.params.color.value = { hex: index ? '#36434e' : '#58758b', alpha: 1 };
    out.params.path.source = paint.id;
    composition.nodes = [t, paint, out];
    composition.output = out.id;
    composition.fill = index ? '#36434e' : '#58758b';
    showcase.layers.push(composition);
  }
  // The fixture has no middle dot; use plain ASCII in this licensed subset example.
  showcase.layers[0].nodes[0].text = '日本語、。ー（文章）\nNect SVG / ガパヴ';
  await page.evaluate((json) => window.nect.load(json), JSON.stringify(showcase));
  await page.locator('.layer .name').filter({ hasText: 'Vertical' }).click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.warning').count(), 0);
  await page.screenshot({
    path: 'test-results/editor-japanese-font-vertical-1600x1000.png',
    fullPage: true,
  });
  await fs.writeFile(
    'test-results/japanese-horizontal-vertical.svg',
    await page.evaluate(() => window.nect.export()),
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: Japanese OTF/TTF file selection, cancel, invalid and stale read protection, full-font JSON reload, new glyph editing, shared assets, mixed vertical text, spacing, undo/redo and browser/headless SVG equality.',
  );
} catch (error) {
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/text-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
}
