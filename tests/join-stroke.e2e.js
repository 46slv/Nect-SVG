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
page.on('dialog', (d) => d.accept());
async function download(action, path) {
  const wait = page.waitForEvent('download');
  await page.locator(`[data-action="${action}"]`).click();
  await (await wait).saveAs(path);
  return fs.readFile(path);
}
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await fs.mkdir('test-results', { recursive: true });
  const ids = await page.evaluate(async () => {
    const { document, node, layer, connect } = await import('/src/core.js');
    const d = document();
    d.width = 240;
    d.height = 180;
    d.name = 'Join geometry and stroke styles';
    const l = d.layers[0],
      a = node('Imported Path', 40, 40),
      b = node('Imported Path', 40, 350),
      j = node('Join Geometry', 350, 40),
      f = node('Fill', 670, 40),
      o = node('Output', 990, 40);
    a.rawPath = 'M20 20L120 20L120 120L20 120Z M40 40L40 100L100 100L100 40Z';
    b.rawPath = 'M80 20L80 120L180 120L180 20Z';
    f.params.color.value = { hex: '#ff0000', alpha: 0.5 };
    l.nodes = [a, b, j, f, o];
    l.output = o.id;
    connect(l, a.id, j.id, 'a');
    connect(l, b.id, j.id, 'b');
    connect(l, j.id, f.id, 'path');
    connect(l, f.id, o.id, 'path');
    const sl = layer('Styled open line'),
      p = node('Imported Path', 40, 40),
      s = node('Stroke', 350, 40),
      out = node('Output', 680, 40);
    p.rawPath = 'M20 150L200 150';
    s.params.color.value = { hex: '#0000ff', alpha: 1 };
    s.params.width.value = 10;
    sl.nodes = [p, s, out];
    sl.output = out.id;
    connect(sl, p.id, s.id, 'path');
    connect(sl, s.id, out.id, 'path');
    d.layers.push(sl);
    window.nect.load(JSON.stringify(d));
    return { j: j.id, s: s.id, sl: sl.id };
  });
  assert.equal(await page.locator('.artboard .shape').first().locator('path').count(), 2);
  await page.locator(`[data-select-layer="${ids.sl}"]`).click();
  await page.locator(`.node[data-id="${ids.s}"] .node-head strong`).click();
  const ctl = (key) => page.locator(`.inspector-body [data-stroke-${key}="${ids.s}"]`);
  await ctl('cap').selectOption('round');
  await ctl('join').selectOption('bevel');
  await ctl('dash').fill('10 20');
  await ctl('dash').press('Tab');
  await page.waitForFunction(
    (id) => document.querySelector(`.graph [data-stroke-dash="${id}"]`)?.value === '10 20',
    ids.s,
  );
  assert.equal(await page.locator(`.graph [data-stroke-cap="${ids.s}"]`).inputValue(), 'round');
  await page.locator('[data-action="undo"]').click();
  assert.equal(await ctl('dash').inputValue(), '');
  await page.locator('[data-action="redo"]').click();
  assert.equal(await ctl('dash').inputValue(), '10 20');
  await ctl('dash').fill('-3');
  await ctl('dash').press('Tab');
  await page.waitForFunction(
    (id) => document.querySelector(`.inspector-body [data-stroke-dash="${id}"]`)?.value === '10 20',
    ids.s,
  );
  const json = await download('save', 'test-results/workflow-join-stroke.json');
  const svg = await download('export', 'test-results/workflow-join-stroke.svg');
  const png = await download('export-png', 'test-results/workflow-join-stroke.png');
  assert.match(svg.toString(), /stroke-linecap="round"/);
  const pixels = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + base64;
    await image.decode();
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    const x = c.getContext('2d');
    x.drawImage(image, 0, 0);
    return Object.fromEntries(
      Object.entries({
        single: [30, 30],
        overlap: [110, 30],
        hole: [60, 60],
        holeCovered: [90, 60],
        cap: [17, 150],
        gap: [40, 150],
      }).map(([key, [a, b]]) => [key, [...x.getImageData(a, b, 1, 1).data]]),
    );
  }, png.toString('base64'));
  assert.ok(Math.abs(pixels.single[3] - 128) <= 1);
  assert.ok(Math.abs(pixels.overlap[3] - 192) <= 1);
  assert.equal(pixels.hole[3], 0);
  assert.ok(Math.abs(pixels.holeCovered[3] - 128) <= 1);
  assert.deepEqual(pixels.cap, [0, 0, 255, 255]);
  assert.equal(pixels.gap[3], 0);
  await page.evaluate((s) => window.nect.load(s), json.toString());
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[1].nodes[1].strokeCap),
    'round',
  );
  await page.screenshot({ path: 'test-results/workflow-join-stroke-editor.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS Join independent holes/opposite-winding/alpha pixels and stroke cap/dash pixels, UI/history/rejection/JSON/SVG/PNG',
  );
} finally {
  await browser.close();
}
