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
const viewport = page.locator('.graph-scroll');
const position = () => page.evaluate(() => [...window.nect.document.layers[0].nodes[0].position]);
const scroll = () => viewport.evaluate((el) => [el.scrollLeft, el.scrollTop]);
let id;
async function reset() {
  id = await page.evaluate(async () => {
    const { document, node } = await import('/src/core.js');
    const d = document(),
      n = node('Rectangle', 100, 70);
    n.collapsed = true;
    const out = node('Output', 700, 70);
    out.params.path.source = n.id;
    out.collapsed = true;
    d.layers[0].nodes = [n, out];
    d.layers[0].output = out.id;
    window.nect.load(JSON.stringify(d));
    return n.id;
  });
  await page.waitForTimeout(80);
}
async function grab() {
  const box = await page.locator(`.node[data-id="${id}"] .node-head strong`).boundingBox();
  const p = [box.x + box.width / 2, box.y + box.height / 2];
  assert.equal(
    await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('.node')?.dataset.id,
      p,
    ),
    id,
    'drag target is unobstructed',
  );
  await page.mouse.move(...p);
  await page.mouse.down();
  return p;
}
async function stillStopped() {
  const before = await scroll(),
    saved = await position();
  await page.waitForTimeout(180);
  assert.deepEqual(await scroll(), before);
  assert.deepEqual(await position(), saved);
}
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await reset();
  const original = await position(),
    box = await viewport.boundingBox();
  const start = await grab();
  const target = [box.x + box.width - 5, box.y + box.height - 20];
  await page.mouse.move(...target);
  const atEdge = await position();
  await page.waitForTimeout(350);
  const after = await position(),
    shifted = await scroll();
  assert.ok(
    after[0] > atEdge[0] + 60 && after[1] > atEdge[1] + 30,
    'stationary diagonal edge drag keeps moving: ' + JSON.stringify({ atEdge, after, shifted }),
  );
  const card = await page.locator(`.node[data-id="${id}"]`).boundingBox();
  const originalOffset = [start[0] - box.x - 16 - original[0], start[1] - box.y - 16 - original[1]];
  assert.ok(Math.abs(card.x + originalOffset[0] - target[0]) < 3);
  assert.ok(Math.abs(card.y + originalOffset[1] - target[1]) < 3);
  // Capture keeps dragging when the pointer leaves the graph on the right.
  await page.mouse.move(box.x + box.width + 25, target[1]);
  await page.waitForTimeout(160);
  assert.ok((await scroll())[0] > shifted[0]);
  await page.mouse.up();
  await stillStopped();
  const saved = await position();
  await page.locator('[data-action="undo"]').click();
  assert.deepEqual(await position(), original, 'one gesture creates one undo step');
  await page.locator('[data-action="redo"]').click();
  assert.deepEqual(await position(), saved);
  await page.evaluate(() => window.nect.load(JSON.stringify(window.nect.document)));
  assert.deepEqual(await position(), saved, 'JSON preserves world positions');

  // Modifier wheel zoom and world/screen coordinate compensation.
  await reset();
  await page.mouse.move(box.x + 150, box.y + 100);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 350);
  await page.keyboard.up('Control');
  await page.waitForTimeout(100);
  const zoom = await page.locator('.graph').evaluate((el) => Number(el.style.zoom));
  assert.ok(zoom < 1 && zoom >= 0.25);
  const beforeZoomDrag = await position(),
    p = await grab();
  await page.mouse.move(p[0] + 90, p[1] + 30);
  await page.mouse.up();
  const moved = await position();
  assert.ok(Math.abs(moved[0] - beforeZoomDrag[0] - 90 / zoom) < 3);
  assert.ok(Math.abs(moved[1] - beforeZoomDrag[1] - 30 / zoom) < 3);
  await grab();
  await page.mouse.move(...target);
  await page.waitForTimeout(180);
  assert.ok((await scroll())[0] > 0 && (await scroll())[1] > 0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await position(), moved);
  await stillStopped();

  for (const reason of ['pointercancel', 'lostpointercapture', 'blur']) {
    await reset();
    const before = await position();
    await grab();
    await page.mouse.move(...target);
    await page.waitForTimeout(120);
    await page.evaluate((reason) => {
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else
        document
          .querySelector('.graph-scroll')
          .dispatchEvent(new PointerEvent(reason, { bubbles: true, pointerId: 1 }));
    }, reason);
    await page.mouse.up();
    assert.deepEqual(await position(), before, reason + ' rolls back nodes');
    await stillStopped();
  }
  // Left/top origin stays bounded; group/model positions never become negative.
  await reset();
  await grab();
  await page.mouse.move(box.x - 20, box.y - 20);
  await page.waitForTimeout(160);
  await page.mouse.up();
  assert.deepEqual(await position(), [0, 0]);
  assert.deepEqual(await scroll(), [0, 0]);

  // Middle pan works over a node without moving it; form controls are exempt.
  await reset();
  const beforePan = await position();
  const head = await page.locator(`.node[data-id="${id}"]`).boundingBox();
  await page.mouse.move(head.x + 80, head.y + 15);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(head.x - 20, head.y - 35);
  await page.mouse.up({ button: 'middle' });
  assert.deepEqual(await position(), beforePan);
  assert.ok((await scroll())[0] >= 95 && (await scroll())[1] >= 45);
  await page.locator('[data-action="graph-reset"]').click();
  await page.locator(`.node[data-id="${id}"] [data-collapse]`).click();
  const input = page.locator(`.node[data-id="${id}"] input[type="number"]`).first();
  const ib = await input.boundingBox(),
    beforeControl = await scroll();
  await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(ib.x - 50, ib.y - 30);
  await page.mouse.up({ button: 'middle' });
  assert.deepEqual(await scroll(), beforeControl);
  assert.deepEqual(await position(), beforePan);
  // A pending numeric field edit commits before drag cancellation takes its snapshot.
  await input.fill('321');
  await grab();
  await page.mouse.move(...target);
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await position(), beforePan);
  assert.equal(
    await page.locator(`.node[data-id="${id}"] input[type="number"]`).first().inputValue(),
    '321',
  );
  await stillStopped();
  await page.locator('[data-action="graph-reset"]').click();
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/graph-navigation.png' });
  assert.deepEqual(errors, []);
  console.log(
    'Graph navigation: edge autopan, zoom, capture, cancellation, origin, history, JSON and pan passed',
  );
} finally {
  await browser.close();
}
