import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
const value = async (name, text) => {
  const el = page.locator('.inspector-body').getByRole('spinbutton', { name, exact: true });
  const previous = await el.elementHandle();
  const changed = (await el.inputValue()) !== String(text);
  await el.fill(String(text));
  await el.press('Tab');
  // Numeric edits schedule a full deferred render. Do not select files on an
  // input that is about to be detached before its change event can bubble.
  if (changed) await page.waitForFunction((input) => !input.isConnected, previous);
  await previous.dispose();
};
const snapshot = () => page.evaluate(() => JSON.stringify(window.nect.document));
const download = async (action, path) => {
  const promise = page.waitForEvent('download');
  await page.locator(`[data-action="${action}"]`).click();
  const file = await promise;
  await file.saveAs(path);
  return fs.readFile(path);
};
async function pixels(bytes, positions) {
  return page.evaluate(
    async ({ data, positions }) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + data;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.naturalWidth;
      c.height = image.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(image, 0, 0);
      return {
        width: c.width,
        height: c.height,
        colors: positions.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]),
      };
    },
    { data: bytes.toString('base64'), positions },
  );
}
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await fs.mkdir('test-results', { recursive: true });
  // Construct through the same public core; all subsequent image/export flows use actual UI.
  await page.evaluate(async () => {
    const { document: doc, node } = await import('/src/core.js');
    const d = doc();
    d.width = 320;
    d.height = 240;
    const rect = node('Rectangle'),
      paint = node('Fill'),
      out = node('Output');
    rect.params.center.value = [60, 100];
    rect.params.size.value = [60, 80];
    paint.params.path.source = rect.id;
    paint.params.color.value = { hex: '#2040ff', alpha: 1 };
    out.params.path.source = paint.id;
    d.layers[0].nodes = [rect, paint, out];
    d.layers[0].output = out.id;
    d.layers[0].fill = '#2040ff';
    window.nect.load(JSON.stringify(d));
  });
  const vectorSVG = await download('export', 'test-results/workflow-vector.svg');
  assert.match(vectorSVG.toString(), /width="320" height="240" viewBox="0 0 320 240"/);
  await page
    .locator('#import-svg-file')
    .setInputFiles({ name: 'roundtrip.svg', mimeType: 'image/svg+xml', buffer: vectorSVG });
  await page.waitForFunction(
    () => window.nect.document.layers[0].nodes[0].type === 'Imported Path',
  );
  assert.equal(await page.evaluate(() => window.nect.document.width), 320);
  const pngData = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 80;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(0, 0, 60, 80);
    ctx.fillStyle = '#20c060';
    ctx.fillRect(60, 0, 60, 40);
    return c.toDataURL('image/png').split(',')[1];
  });
  const imageFile = {
    name: 'local-colors.png',
    mimeType: 'image/png',
    buffer: Buffer.from(pngData, 'base64'),
  };
  const before = await snapshot();
  await page.locator('#image-file').setInputFiles(imageFile);
  await page.waitForFunction(() => window.nect.document.layers.length === 2);
  await page.waitForSelector('image.shape');
  const imageId = await page.evaluate(() => window.nect.document.layers[1].id);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await snapshot(), before);
  await page.locator('[data-action="redo"]').click();
  await page.waitForSelector('image.shape');
  await page.locator(`[data-select-layer="${imageId}"]`).click();
  await page
    .locator('.graph .node')
    .filter({ has: page.locator('[data-position-reference]') })
    .locator('.node-head strong')
    .click();
  await value('Image position X', 160);
  await value('Image position Y', 50);
  await value('Image size X', 120);
  await value('Image size Y', 80);
  // Select/move original image using actual pointer coordinates, then Undo/Redo.
  const bounds = await page.locator('.artboard').boundingBox();
  const start = [bounds.x + (180 / 320) * bounds.width, bounds.y + (75 / 240) * bounds.height];
  await page.keyboard.down('Alt');
  await page.mouse.move(...start);
  await page.mouse.down();
  await page.mouse.move(
    start[0] + (20 / 320) * bounds.width,
    start[1] + (10 / 240) * bounds.height,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(60);
  let pos = await page.evaluate(
    () => window.nect.document.layers[1].nodes[0].params.position.value,
  );
  assert.ok(Math.abs(pos[0] - 180) < 1 && Math.abs(pos[1] - 60) < 1, `image drag: ${pos}`);
  await page.locator('[data-action="undo"]').click();
  assert.deepEqual(
    await page.evaluate(() => window.nect.document.layers[1].nodes[0].params.position.value),
    [160, 50],
  );
  await page.locator('[data-action="redo"]').click();
  await page.locator('[data-action="undo"]').click();
  await page.locator(`[data-layer-lock="${imageId}"]`).click();
  const locked = await snapshot();
  await page.mouse.move(...start);
  await page.mouse.down();
  await page.mouse.move(start[0] + 15, start[1] + 15, { steps: 3 });
  await page.mouse.up();
  assert.equal(await snapshot(), locked);
  await page.locator(`[data-layer-lock="${imageId}"]`).click();
  const beforePen = await snapshot();
  await page.getByRole('button', { name: 'Pen / Curve', exact: true }).click();
  await page.mouse.click(...start);
  assert.equal(await snapshot(), beforePen);
  await page.getByRole('button', { name: 'Select / move', exact: true }).click();
  const saved = await download('save', 'test-results/workflow-image.json');
  const svg = await download('export', 'test-results/workflow-image.svg');
  assert.match(svg.toString(), /<image /);
  assert.match(svg.toString(), /data:image\/png;base64,/);
  assert.doesNotMatch(svg.toString(), /class=|guide|grid|selection/);
  await page.locator('#png-scale').selectOption('2');
  const png = await download('export-png', 'test-results/workflow-image-2x.png');
  const check = await pixels(png, [
    [0, 0],
    [100, 200],
    [340, 120],
    [460, 120],
    [460, 220],
  ]);
  assert.equal(check.width, 640);
  assert.equal(check.height, 480);
  assert.deepEqual(check.colors, [
    [0, 0, 0, 0],
    [32, 64, 255, 255],
    [255, 48, 32, 255],
    [32, 192, 96, 255],
    [0, 0, 0, 0],
  ]);
  // Guides, image guide layers and hidden layers never enter either export.
  await page.locator(`[data-layer-guide="${imageId}"]`).click();
  const guidePNG = await download('export-png', 'test-results/workflow-guide-excluded.png');
  assert.deepEqual((await pixels(guidePNG, [[340, 120]])).colors, [[0, 0, 0, 0]]);
  assert.doesNotMatch(await page.evaluate(() => window.nect.export()), /<image /);
  await page.locator(`[data-layer-guide="${imageId}"]`).click();
  await page.locator(`[data-visible="${imageId}"]`).click();
  assert.doesNotMatch(await page.evaluate(() => window.nect.export()), /<image /);
  await page.locator(`[data-visible="${imageId}"]`).click();
  // Wait for load completion, not just model values already true before this async reload.
  // Editable JSON reload preserves embedded asset and output bytes.
  assert.doesNotMatch(await page.locator('.status').textContent(), /Project restored/);
  await page
    .locator('#open-file')
    .setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: saved });
  await page.waitForFunction(
    () =>
      document.querySelector('.status').textContent.includes('Project restored') &&
      window.nect.document.layers.length === 2 &&
      window.nect.document.layers[1].nodes[0].params.position.value[0] === 160,
  );
  assert.equal(await page.evaluate(() => window.nect.export()), svg.toString());
  const restored = await snapshot();
  const corrupt = JSON.parse(saved.toString());
  const asset = Object.values(corrupt.imageAssets)[0];
  const corruptBytes = Buffer.from(asset.data, 'base64');
  for (let at = 8; at + 12 <= corruptBytes.length; at += corruptBytes.readUInt32BE(at) + 12) {
    if (corruptBytes.toString('ascii', at + 4, at + 8) === 'IDAT') {
      corruptBytes[at + 8] = 0;
      break;
    }
  }
  asset.data = corruptBytes.toString('base64');
  await page.locator('#open-file').setInputFiles({
    name: 'corrupt.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(corrupt)),
  });
  await page.waitForFunction(() =>
    document.querySelector('.status').textContent.includes('Open rejected'),
  );
  assert.equal(await snapshot(), restored);
  // Explicit unsupported SVG raster roundtrip, with the editable project preserved.
  await page
    .locator('#import-svg-file')
    .setInputFiles({ name: 'embedded.svg', mimeType: 'image/svg+xml', buffer: svg });
  await page.waitForFunction(() =>
    document.querySelector('.status').textContent.includes('Unsupported SVG element: image'),
  );
  assert.equal(await snapshot(), restored);
  await page
    .locator('#image-file')
    .setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not PNG') });
  await page.waitForFunction(() =>
    document.querySelector('.status').textContent.includes('Image rejected'),
  );
  assert.equal(await snapshot(), restored);
  // Cancel and late completion do not replace a newer edit.
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-action="import-image"]').click();
  await (await chooser).setFiles([]);
  assert.equal(await snapshot(), restored);
  await page.evaluate((base64) => {
    const b = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const input = document.querySelector('#image-file');
    const file = new File([b], 'slow.png', { type: 'image/png' });
    file.arrayBuffer = () =>
      new Promise((resolve) => (window.finishImage = () => resolve(b.buffer)));
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, pngData);
  await value('Artboard width', 321);
  const changed = await snapshot();
  await page.evaluate(() => window.finishImage());
  await page.waitForFunction(() =>
    document.querySelector('.status').textContent.includes('Document changed while reading'),
  );
  assert.equal(await snapshot(), changed);
  await value('Artboard width', 320);
  // Local JPEG is decoded/oriented then embedded as PNG, never a file path.
  const jpg = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + base64;
    await image.decode();
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 80;
    c.getContext('2d').drawImage(image, 0, 0);
    return c.toDataURL('image/jpeg').split(',')[1];
  }, pngData);
  await page.locator('#image-file').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(jpg, 'base64'),
  });
  await page.waitForFunction(() => window.nect.document.layers.length === 3);
  assert.equal(
    await page.evaluate(() => Object.values(window.nect.document.imageAssets).at(-1).mime),
    'image/png',
  );
  await page.locator('[data-action="undo"]').click();
  // Downscaled large artboard is bounded by output pixels, not intrinsic SVG size.
  await value('Artboard width', 10000);
  await value('Artboard height', 1000);
  await page.locator('#png-scale').selectOption('0.5');
  const large = await download('export-png', 'test-results/workflow-downscaled.png');
  assert.equal((await pixels(large, [[0, 0]])).width, 5000);
  await page
    .locator('#open-file')
    .setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: saved });
  await page.waitForFunction(() => window.nect.document.width === 320);
  await page.locator('#png-scale').selectOption('2');
  await page.locator(`[data-select-layer="${imageId}"]`).click();
  await page.screenshot({ path: 'test-results/workflow-image-editor.png', fullPage: true });
  assert.notEqual(before, restored);
  assert.deepEqual(errors, []);
  console.log(
    'PASS SVG file roundtrip, PNG pixels/alpha/dimensions, PNG/JPEG import, image move/history, embedded JSON, guide/hidden exclusion, cancellation/stale/error preservation',
  );
} catch (error) {
  console.error('Image workflow status:', await page.locator('.status').innerText());
  await page.screenshot({ path: 'test-results/workflow-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
}
