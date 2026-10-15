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
page.on('pageerror', (error) => errors.push(error.message));
// Exercise real browser controls with deterministic installed-font IPC responses.
// Actual Windows catalog/extraction and packaged WebView2 remain separate checks.
await page.route('**/src/storage.js', (route) =>
  route.fulfill({
    contentType: 'text/javascript',
    body: `export const desktop = true;
export const saveFile = async () => true, openFile = async () => null;
export const listSystemFonts = async () => [
  ['system-0', 'Japanese fixture', null], ['system-1', 'DejaVu Sans', null],
  ['system-2', 'Variable font', 'Variable fonts unsupported']
];
export async function readSystemFont(id) {
  if (window.rejectFont) throw Error('Font file was removed');
  await new Promise((resolve) => setTimeout(resolve, 100));
  return (await fetch(id === 'system-0' ? '/tests/fixtures/fonts/NectJPFixture-Regular.otf' : '/fonts/DejaVuSans.ttf')).arrayBuffer();
}`,
  }),
);
const picker = () => page.locator('.inspector-body [data-font]');
const state = () =>
  page.evaluate(() => ({
    document: JSON.stringify(window.nect.document),
    svg: window.nect.export(),
    path: JSON.stringify(window.nect.evaluate().path),
    canvas: document.querySelector(
      `.artboard .shape[data-layer="${window.nect.document.layers.at(-1).id}"]`,
    )?.outerHTML,
    font: window.nect.document.layers.at(-1).nodes.find((n) => n.type === 'Text')?.font,
  }));
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.locator('[data-tool="Text"]').click();
  await page
    .locator('.graph .node')
    .filter({ has: page.locator('[data-text]') })
    .locator('.node-head strong')
    .click();
  const text = page.locator('.inspector-body [data-text]');
  await text.fill('Abg 123');
  await text.dispatchEvent('change');
  assert.equal(await picker().count(), 1);
  assert.equal(await page.locator('[data-system-font]').count(), 0);
  assert.equal(await picker().locator('option[value="system-2"]').isDisabled(), true);
  await picker().selectOption('system-0');
  await page.waitForFunction(() =>
    document.querySelector('.message').textContent.includes('Loaded Nect'),
  );
  const first = await state();
  assert.equal(await picker().inputValue(), first.font);
  await picker().selectOption('system-1');
  await page.waitForFunction(() =>
    document.querySelector('.message').textContent.includes('Loaded DejaVu'),
  );
  const second = await state();
  assert.equal(await picker().inputValue(), second.font);
  assert.notEqual(second.path, first.path);
  assert.notEqual(second.svg, first.svg);
  assert.notEqual(second.canvas, first.canvas);
  await page.locator('[data-action="undo"]').click();
  assert.equal((await state()).svg, first.svg);
  assert.equal(await picker().inputValue(), first.font);
  await page.locator('[data-action="redo"]').click();
  assert.equal((await state()).svg, second.svg);
  await page.evaluate((json) => window.nect.load(json), second.document);
  assert.equal((await state()).svg, second.svg);
  // Reload opens the preserved first layer; explicitly select the new Text layer and node.
  const textLayer = await page.evaluate(() => window.nect.document.layers.at(-1).id);
  await page.locator(`[data-select-layer="${textLayer}"]`).click();
  await page
    .locator('.node-head strong')
    .filter({ hasText: /^Text$/ })
    .click();
  assert.equal(await picker().inputValue(), second.font);
  await page.evaluate(() => {
    window.rejectFont = true;
  });
  await picker().selectOption('system-0');
  await page.waitForFunction(() =>
    document.querySelector('.message').textContent.includes('Font file was removed'),
  );
  assert.equal((await state()).document, second.document);
  assert.equal(await picker().inputValue(), second.font);
  assert.equal(await picker().isDisabled(), false);
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/font-single-picker.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: one font picker; installed-font switch changes browser canvas and SVG outlines; Undo, redo, JSON reload and failure preserve the selected font.',
  );
} finally {
  await browser.close();
}
