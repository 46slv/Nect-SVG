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
page.on('dialog', (d) => d.accept());
const inspect = (id) => page.locator(`.graph .node[data-id="${id}"] .node-head strong`).click();
const field = (id, key, scope = '.inspector-body') =>
  page.locator(`${scope} .field[data-node="${id}"][data-key="${key}"]`);
async function setColor(id, key, hex, alpha) {
  await inspect(id);
  await field(id, key)
    .locator('[data-color="hex"]')
    .evaluate((el, hex) => {
      el.value = hex;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, hex);
  await page.waitForFunction(
    ({ id, key, hex }) =>
      window.nect.document.layers[0].nodes.find((n) => n.id === id).params[key].value.hex === hex,
    { id, key, hex },
  );
  const input = field(id, key).locator('[data-color="alpha"]');
  await input.fill(String(alpha));
  await input.press('Tab');
  await page.waitForFunction(
    ({ id, key, alpha }) =>
      window.nect.document.layers[0].nodes.find((n) => n.id === id).params[key].value.alpha ===
      alpha,
    { id, key, alpha },
  );
}
async function connectMenu(id, key, source) {
  await field(id, key).locator('[data-connect-menu]').click();
  const options = await page
    .locator('dialog option')
    .evaluateAll((els) => els.map((el) => el.value));
  await page.locator('dialog select').selectOption(source);
  await page.locator('dialog [data-confirm]').click();
  return options;
}
async function download(action, path) {
  const pending = page.waitForEvent('download');
  await page.locator(`[data-action="${action}"]`).click();
  await (await pending).saveAs(path);
  return fs.readFile(path);
}
async function shape(hex, alpha) {
  await page.waitForFunction(
    ({ hex, alpha }) => {
      const s = document.querySelector('.shape');
      return s?.getAttribute('fill') === hex && Number(s.getAttribute('fill-opacity')) === alpha;
    },
    { hex, alpha },
  );
}
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await fs.mkdir('test-results', { recursive: true });
  const { rect, out } = await page.evaluate(async () => {
    const { document, node } = await import('/src/core.js');
    const d = document(),
      r = node('Rectangle', 40, 40),
      f = node('Fill', 360, 40),
      o = node('Output', 680, 40);
    d.width = 320;
    d.height = 240;
    r.params.center.value = [160, 120];
    r.params.size.value = [160, 120];
    f.params.path.source = r.id;
    f.params.color.value = { hex: '#112233', alpha: 1 };
    o.params.path.source = f.id;
    d.layers[0].nodes = [r, f, o];
    d.layers[0].output = o.id;
    d.layers[0].fill = '#112233';
    window.nect.load(JSON.stringify(d));
    return { rect: r.id, out: f.id };
  });
  await shape('#112233', 1);
  await setColor(out, 'color', '#2040ff', 0.25);
  await shape('#2040ff', 0.25);
  await page.locator('#add-node').selectOption('Color');
  const color = await page.evaluate(() => window.nect.document.layers[0].nodes.at(-1).id);
  await setColor(color, 'value', '#ff8000', 0.5);
  await inspect(out);
  assert.deepEqual(await connectMenu(out, 'color', color), ['', color]);
  await shape('#ff8000', 0.5);
  assert.equal(await field(out, 'color').locator('[data-color="alpha"]').isDisabled(), true);
  assert.equal(await field(out, 'color').locator('[data-color="hex"]').inputValue(), '#ff8000');
  // A cancelled connection dialog leaves the document and alpha unchanged.
  const connected = await page.evaluate(() => JSON.stringify(window.nect.document));
  await field(out, 'color').locator('[data-connect-menu]').click();
  await page.locator('dialog select').selectOption('');
  await page.locator('dialog [data-cancel]').click();
  assert.equal(await page.evaluate(() => JSON.stringify(window.nect.document)), connected);
  // Mismatched drag must not create a connection or damage the existing path.
  await page.locator(`.graph [data-source="${color}"]`).dispatchEvent('pointerdown', { button: 0 });
  await field(rect, 'size', '.graph').dispatchEvent('pointerup', { button: 0 });
  assert.equal(await page.evaluate(() => JSON.stringify(window.nect.document)), connected);
  // Collapsed Color and Output keep their typed ports and wire geometry.
  await page.locator(`[data-collapse="${color}"]`).click();
  await page.locator(`[data-collapse="${out}"]`).click();
  assert.equal(await page.locator(`.graph .node[data-id="${color}"].collapsed`).count(), 1);
  assert.equal(await field(out, 'color', '.graph').getAttribute('data-type'), 'Color');
  assert.equal(await field(out, 'color', '.graph').locator('.input').count(), 1);
  await shape('#ff8000', 0.5);
  await page.screenshot({ path: 'test-results/color-collapsed-1600x1000.png', fullPage: true });
  await page.locator(`[data-collapse="${out}"]`).click();
  await page.locator(`[data-collapse="${color}"]`).click();
  await inspect(out);
  await field(out, 'color').locator('.input').click({ button: 'right' });
  await shape('#2040ff', 0.25);
  await page.locator('[data-action="undo"]').click();
  await shape('#ff8000', 0.5);
  await page.locator('[data-action="redo"]').click();
  await shape('#2040ff', 0.25);
  assert.equal(await page.locator('[data-fill], [data-color-layer]').count(), 0);
  await connectMenu(out, 'color', color);
  await shape('#ff8000', 0.5);
  await setColor(color, 'value', '#ff8000', 0);
  await shape('#ff8000', 0);
  await page.locator('[data-action="undo"]').click();
  await shape('#ff8000', 0.5);
  // Reject out-of-range alpha atomically, preserving the selected color and history.
  await inspect(color);
  const beforeInvalid = await page.evaluate(() => JSON.stringify(window.nect.document));
  const alpha = field(color, 'value').locator('[data-color="alpha"]');
  await alpha.fill('2');
  await alpha.press('Tab');
  await page.waitForFunction(() =>
    document.querySelector('.status').textContent.includes('Alpha must'),
  );
  assert.equal(await page.evaluate(() => JSON.stringify(window.nect.document)), beforeInvalid);
  await page.screenshot({ path: 'test-results/color-expanded-1600x1000.png', fullPage: true });
  const json = await download('save', 'test-results/workflow-color.json');
  const svg = await download('export', 'test-results/workflow-color.svg');
  assert.match(svg.toString(), /fill="#ff8000" fill-opacity="0.5"/);
  const png = await download('export-png', 'test-results/workflow-color.png');
  const pixel = await page.evaluate(async (data) => {
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
      center: [...ctx.getImageData(160, 120, 1, 1).data],
      outside: [...ctx.getImageData(0, 0, 1, 1).data],
    };
  }, png.toString('base64'));
  assert.deepEqual([pixel.width, pixel.height], [320, 240]);
  assert.ok(
    Math.abs(pixel.center[0] - 255) <= 1 &&
      Math.abs(pixel.center[1] - 128) <= 1 &&
      pixel.center[2] === 0 &&
      Math.abs(pixel.center[3] - 128) <= 1,
    JSON.stringify(pixel),
  );
  assert.deepEqual(pixel.outside, [0, 0, 0, 0]);
  await page.reload();
  await page.waitForSelector('.shape');
  await page
    .locator('#open-file')
    .setInputFiles({ name: 'color.json', mimeType: 'application/json', buffer: json });
  await shape('#ff8000', 0.5);
  assert.deepEqual(await page.evaluate(() => window.nect.document), JSON.parse(json));
  await page
    .locator('#import-svg-file')
    .setInputFiles({ name: 'color.svg', mimeType: 'image/svg+xml', buffer: svg });
  await page.waitForFunction(
    () => window.nect.document.layers[0].nodes[0].type === 'Imported Path',
  );
  await shape('#ff8000', 0.5);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    'test-results/workflow-color-evidence.json',
    JSON.stringify(
      {
        typedColor: true,
        fallbackAndUndoRedo: true,
        invalidConnectionRejected: true,
        collapsedPorts: true,
        jsonReload: true,
        svgRoundtrip: true,
        png: pixel,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log('Color UI, typed sockets, fallback, history, JSON, SVG and PNG alpha verified.');
} finally {
  await browser.close();
}
