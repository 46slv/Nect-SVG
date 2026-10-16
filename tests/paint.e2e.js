import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
const field = (id, key) =>
  page.locator(`.inspector-body .field[data-node="${id}"][data-key="${key}"]`);
const inspect = (id) => page.locator(`.graph .node[data-id="${id}"] .node-head strong`).click();
async function download(action, path) {
  const waiting = page.waitForEvent('download');
  await page.locator(`[data-action="${action}"]`).click();
  await (await waiting).saveAs(path);
  return fs.readFile(path);
}
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await fs.mkdir('test-results', { recursive: true });
  const ids = await page.evaluate(async () => {
    const { document, node, layer } = await import('/src/core.js');
    const d = document();
    d.width = 240;
    d.height = 180;
    d.name = 'Explicit Fill and Stroke';
    const r = node('Rectangle', 40, 40),
      f = node('Fill', 350, 40),
      s = node('Stroke', 660, 40),
      o = node('Output', 970, 40),
      c = node('Color', 350, 340),
      t = node('Transform', 40, 400);
    r.params.center.value = [80, 80];
    r.params.size.value = [80, 80];
    f.params.path.source = r.id;
    f.params.color.value = { hex: '#ff0000', alpha: 0.5 };
    s.params.path.source = f.id;
    s.params.color.value = { hex: '#0000ff', alpha: 0.75 };
    s.params.width.value = 20;
    o.params.path.source = s.id;
    c.params.value.value = { hex: '#0000ff', alpha: 0.75 };
    t.params.path.source = r.id;
    d.layers[0].nodes = [r, f, s, o, c, t];
    d.layers[0].output = o.id;
    const l = layer('Open stroke only'),
      p = node('Imported Path'),
      st = node('Stroke'),
      out = node('Output');
    p.rawPath = 'M20 150L140 150';
    st.params.path.source = p.id;
    st.params.color.value = { hex: '#00ff00', alpha: 1 };
    st.params.width.value = 8;
    out.params.path.source = st.id;
    l.nodes = [p, st, out];
    l.output = out.id;
    d.layers.push(l);
    window.nect.load(JSON.stringify(d));
    return { r: r.id, f: f.id, s: s.id, o: o.id, c: c.id, t: t.id };
  });
  await inspect(ids.t);
  const transformOptions = await page
    .locator(`.graph .node[data-id="${ids.t}"] [data-key="path"] option`)
    .evaluateAll((els) => els.map((el) => el.value));
  assert.ok(transformOptions.includes(ids.r));
  for (const id of [ids.f, ids.s, ids.o]) assert.ok(!transformOptions.includes(id));
  await inspect(ids.s);
  await field(ids.s, 'color').locator('[data-connect-menu]').click();
  await page.locator('dialog select').selectOption(ids.c);
  await page.locator('dialog [data-confirm]').click();
  assert.equal(await field(ids.s, 'color').locator('[data-color="alpha"]').isDisabled(), true);
  const width = field(ids.s, 'width').locator('[data-value]');
  await width.fill('0');
  await width.press('Tab');
  await page.waitForFunction(
    () => document.querySelector('.shape')?.getAttribute('stroke-width') === '0',
  );
  await page.locator('[data-action="undo"]').click();
  await page.waitForFunction(
    () => document.querySelector('.shape')?.getAttribute('stroke-width') === '20',
  );
  await page.locator('[data-action="redo"]').click();
  await page.waitForFunction(
    () => document.querySelector('.shape')?.getAttribute('stroke-width') === '0',
  );
  await page.locator('[data-action="undo"]').click();
  const saved = await page.evaluate(() => JSON.stringify(window.nect.document));
  await field(ids.s, 'width').locator('[data-value]').fill('-1');
  await field(ids.s, 'width').locator('[data-value]').press('Tab');
  // Invalid width is rejected by document validation in the same history transaction.
  assert.equal(await page.evaluate(() => JSON.stringify(window.nect.document)), saved);
  await page.locator(`[data-collapse="${ids.s}"]`).click();
  assert.equal(
    await page.locator(`.graph [data-node="${ids.s}"][data-key="path"]`).getAttribute('data-type'),
    'PaintedPath',
  );
  await page.locator(`[data-collapse="${ids.s}"]`).click();
  const json = await download('save', 'test-results/workflow-paint.json'),
    svg = await download('export', 'test-results/workflow-paint.svg'),
    png = await download('export-png', 'test-results/workflow-paint.png');
  const pixels = await page.evaluate(async (base64) => {
    const i = new Image();
    i.src = 'data:image/png;base64,' + base64;
    await i.decode();
    const c = document.createElement('canvas');
    c.width = i.width;
    c.height = i.height;
    const x = c.getContext('2d');
    x.drawImage(i, 0, 0);
    return {
      size: [c.width, c.height],
      center: [...x.getImageData(80, 80, 1, 1).data],
      stroke: [...x.getImageData(35, 80, 1, 1).data],
      line: [...x.getImageData(80, 150, 1, 1).data],
      outside: [...x.getImageData(0, 0, 1, 1).data],
    };
  }, png.toString('base64'));
  assert.deepEqual(pixels.size, [240, 180]);
  assert.deepEqual(pixels.center.slice(0, 3), [255, 0, 0]);
  assert.ok(Math.abs(pixels.center[3] - 128) <= 1);
  assert.deepEqual(pixels.stroke.slice(0, 3), [0, 0, 255]);
  assert.ok(Math.abs(pixels.stroke[3] - 191) <= 1);
  assert.deepEqual(pixels.line, [0, 255, 0, 255]);
  assert.deepEqual(pixels.outside, [0, 0, 0, 0]);
  await page
    .locator('#open-file')
    .setInputFiles({ name: 'paint.json', mimeType: 'application/json', buffer: json });
  assert.deepEqual(await page.evaluate(() => window.nect.document), JSON.parse(json));
  await page
    .locator('#import-svg-file')
    .setInputFiles({ name: 'paint.svg', mimeType: 'image/svg+xml', buffer: svg });
  await page.waitForFunction(
    () => window.nect.document.layers[0].nodes[0].type === 'Imported Path',
  );
  assert.match(
    await page.evaluate(() => window.nect.export()),
    /stroke="#0000ff" stroke-opacity="0.75" stroke-width="20"/,
  );
  // Return to editable source graph for a clean preview with no error toast.
  await page.evaluate((json) => window.nect.load(json), json.toString());
  await page.waitForTimeout(4000);
  await inspect(ids.s);
  await page.screenshot({ path: 'test-results/paint-clean-preview-1600x1000.png', fullPage: true });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    'test-results/workflow-paint-evidence.json',
    JSON.stringify(
      {
        pixels,
        typedGeometryBoundary: true,
        connectedStroke: true,
        zeroWidthUndoRedo: true,
        invalidWidthRollback: true,
        jsonReload: true,
        svgRoundtrip: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log('Fill/Stroke typed pipeline, UI, history, roundtrips and exact PNG pixels verified.');
} finally {
  await browser.close();
}
