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
  const ids = await page.evaluate(async () => {
    const { document, node, connect } = await import('/src/core.js');
    const d = document(),
      l = d.layers[0];
    const v = node('Vector', 40, 40),
      s = node('Separate Vector', 340, 40),
      m = node('Math', 640, 40),
      c = node('Combine Vector', 940, 40),
      r = node('Circle', 40, 360),
      f = node('Fill', 340, 360),
      o = node('Output', 640, 360);
    l.nodes = [v, s, m, c, r, f, o];
    l.output = o.id;
    connect(l, v.id, s.id, 'vector');
    connect(l, r.id, f.id, 'path');
    connect(l, f.id, o.id, 'path');
    window.nect.load(JSON.stringify(d));
    return { s: s.id, m: m.id, c: c.id };
  });
  const socket = (port) => page.locator(`[data-source="${ids.s}"][data-source-port="${port}"]`);
  const field = (id, key) => page.locator(`.graph [data-node="${id}"][data-key="${key}"]`);
  const snapshot = () => page.evaluate(() => JSON.stringify(window.nect.document));
  const before = await snapshot();
  async function start(port) {
    const b = await socket(port).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    assert.equal(await page.locator('.wire-preview').count(), 1);
  }
  async function verifyPreview(x, y, port, move = true) {
    if (move) await page.mouse.move(x, y);
    const coords = await page.evaluate(
      ({ id, port }) => {
        const p = document.querySelector('.wire-preview'),
          g = document.querySelector('.graph'),
          r = g.getBoundingClientRect(),
          z = Number(getComputedStyle(g).zoom),
          b = document
            .querySelector(`[data-source="${id}"][data-source-port="${port}"]`)
            .getBoundingClientRect();
        const n = p
          .getAttribute('d')
          .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)
          .map(Number);
        return {
          start: [r.x + n[0] * z, r.y + n[1] * z],
          end: [r.x + n.at(-2) * z, r.y + n.at(-1) * z],
          source: [b.x + b.width / 2, b.y + b.height / 2],
        };
      },
      { id: ids.s, port },
    );
    assert.ok(Math.abs(coords.end[0] - x) < 1 && Math.abs(coords.end[1] - y) < 1);
    assert.ok(
      Math.abs(coords.start[0] - coords.source[0]) < 1 &&
        Math.abs(coords.start[1] - coords.source[1]) < 1,
    );
  }
  await start('x');
  let target = await field(ids.m, 'a').boundingBox();
  await verifyPreview(target.x + 40, target.y + 20, 'x');
  assert.equal(await field(ids.m, 'a').evaluate((e) => e.classList.contains('compatible')), true);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await page.locator('.wire-preview').count(), 0);
  assert.equal(await snapshot(), before);
  await start('y');
  target = await field(ids.s, 'vector').boundingBox();
  await verifyPreview(target.x + 40, target.y + 20, 'y');
  await page.mouse.up();
  assert.equal(await snapshot(), before);
  assert.equal(await page.locator('.wire-preview').count(), 0);
  await start('x');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  assert.equal(await page.locator('.wire-preview').count(), 0);
  assert.equal(await snapshot(), before);
  await page.locator(`[data-collapse="${ids.s}"]`).click();
  const viewport = await page.locator('.graph-scroll').boundingBox();
  await page.mouse.move(viewport.x + 100, viewport.y + 100);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await page.waitForFunction(
    () => Number(getComputedStyle(document.querySelector('.graph')).zoom) < 1,
  );
  await page.locator('.graph-scroll').evaluate((el) => {
    el.scrollLeft = 80;
    el.scrollTop = 15;
  });
  const beforeConnect = await snapshot();
  await start('y');
  target = await field(ids.m, 'a').boundingBox();
  await verifyPreview(target.x + 40, target.y + 20, 'y');
  const oldPreview = await page.locator('.wire-preview').getAttribute('d');
  await page.locator('.graph-scroll').evaluate((el) => {
    el.scrollLeft += 20;
  });
  await page.waitForFunction(
    (old) => document.querySelector('.wire-preview').getAttribute('d') !== old,
    oldPreview,
  );
  await verifyPreview(target.x + 40, target.y + 20, 'y', false);
  target = await field(ids.m, 'a').boundingBox();
  await verifyPreview(target.x + 40, target.y + 20, 'y');
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/workflow-wire-preview.png', fullPage: true });
  await page.mouse.up();
  assert.equal(await page.locator('.wire-preview').count(), 0);
  assert.equal(
    await page.evaluate(
      (id) => window.nect.document.layers[0].nodes.find((n) => n.id === id).params.a.sourcePort,
      ids.m,
    ),
    'y',
  );
  await page.locator('[data-action="undo"]').click();
  assert.equal(await snapshot(), beforeConnect);
  await page.locator('[data-action="redo"]').click();
  assert.equal(
    await page.evaluate(
      (id) => window.nect.document.layers[0].nodes.find((n) => n.id === id).params.a.sourcePort,
      ids.m,
    ),
    'y',
  );
  await start('x');
  await page.evaluate(() =>
    document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 999 })),
  );
  assert.equal(await page.locator('.wire-preview').count(), 1);
  await page.evaluate(() =>
    document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })),
  );
  await page.mouse.up();
  assert.equal(await page.locator('.wire-preview').count(), 0);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    'test-results/workflow-wire-evidence.json',
    JSON.stringify(
      {
        pointerPreview: true,
        collapsedXY: true,
        zoomPanAlignment: true,
        escapeBlurPointerCancel: true,
        invalidDropPreserved: true,
        singleUndo: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Live wire preview follows named sockets and pointer under graph zoom/scroll; cancellation, invalid drop and one-step history verified.',
  );
} finally {
  await browser.close();
}
