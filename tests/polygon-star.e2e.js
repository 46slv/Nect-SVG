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
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await fs.mkdir('test-results', { recursive: true });
  await page.getByRole('button', { name: 'Add Polygon', exact: true }).click();
  assert.equal(
    await page.evaluate(() =>
      window.nect.document.layers.at(-1).nodes.some((n) => n.type === 'Polygon'),
    ),
    true,
  );
  await page.getByRole('button', { name: 'Add Star', exact: true }).click();
  assert.equal(
    await page.evaluate(() =>
      window.nect.document.layers.at(-1).nodes.some((n) => n.type === 'Star'),
    ),
    true,
  );
  const ids = await page.evaluate(async () => {
    const { document, node, connect } = await import('/src/core.js');
    const d = document(),
      l = d.layers[0],
      p = node('Polygon', 40, 40),
      s = node('Star', 40, 400),
      j = node('Join Geometry', 360, 40),
      f = node('Fill', 680, 40),
      o = node('Output', 990, 40);
    d.width = 400;
    d.height = 240;
    d.name = 'Polygon and star';
    p.params.center.value = [100, 120];
    p.params.radius.value = 70;
    s.params.center.value = [290, 120];
    s.params.outerRadius.value = 90;
    s.params.innerRadius.value = 40;
    l.nodes = [p, s, j, f, o];
    l.output = o.id;
    connect(l, p.id, j.id, 'a');
    connect(l, s.id, j.id, 'b');
    connect(l, j.id, f.id, 'path');
    connect(l, f.id, o.id, 'path');
    window.nect.load(JSON.stringify(d));
    return { p: p.id, s: s.id, l: l.id };
  });
  await page.locator(`.node[data-id="${ids.s}"] .node-head strong`).click();
  const field = (key) =>
    page.locator(`.inspector-body .field[data-node="${ids.s}"][data-key="${key}"]`);
  const count = () => field('points').locator('[data-value]');
  await count().fill('7');
  await count().press('Tab');
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[0].nodes[1].params.points.value),
    7,
  );
  await page.locator('[data-action="undo"]').click();
  assert.equal(await count().inputValue(), '5');
  await page.locator('[data-action="redo"]').click();
  assert.equal(await count().inputValue(), '7');
  await count().fill('2.5');
  await count().press('Tab');
  await page.waitForFunction(
    () =>
      window.nect.document.layers[0].nodes[1].params.points.value === 7 &&
      document.querySelector('.inspector-body [data-key="points"] [data-value]')?.value === '7',
  );
  const center = () =>
    page.evaluate(() => window.nect.document.layers[0].nodes[1].params.center.value);
  const drag = async () => {
    const marker = await page.locator('.node-stage-move rect').boundingBox();
    const pt = { x: marker.x + marker.width / 2, y: marker.y + marker.height / 2 };
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 25, pt.y + 10, { steps: 4 });
    await page.mouse.up();
  };
  const before = await center();
  await drag();
  assert.notDeepEqual(await center(), before);
  await page.locator('[data-action="undo"]').click();
  assert.deepEqual(await center(), before);
  await page.locator(`[data-layer-lock="${ids.l}"]`).click();
  await drag();
  assert.deepEqual(await center(), before);
  await page.locator(`[data-layer-lock="${ids.l}"]`).click();
  for (const [action, ext] of [
    ['save', 'json'],
    ['export', 'svg'],
    ['export-png', 'png'],
  ]) {
    const pending = page.waitForEvent('download');
    await page.locator(`[data-action="${action}"]`).click();
    await (await pending).saveAs(`test-results/workflow-polygon-star.${ext}`);
  }
  const svg = await fs.readFile('test-results/workflow-polygon-star.svg', 'utf8');
  assert.match(svg, /<path/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
  const png = await fs.readFile('test-results/workflow-polygon-star.png');
  const alpha = await page.evaluate(async (data) => {
    const im = new Image();
    im.src = 'data:image/png;base64,' + data;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.width;
    c.height = im.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0);
    return [
      [100, 120],
      [290, 120],
      [5, 5],
    ].map(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3]);
  }, png.toString('base64'));
  assert.deepEqual(alpha, [255, 255, 0]);
  await page.evaluate(
    (s) => window.nect.load(s),
    await fs.readFile('test-results/workflow-polygon-star.json', 'utf8'),
  );
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[0].nodes[1].params.points.value),
    7,
  );
  await page.screenshot({ path: 'test-results/workflow-polygon-star-editor.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS Polygon/Star add, count, invalid preservation, drag/lock/history, JSON/SVG/PNG pixels',
  );
} finally {
  await browser.close();
}
