import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  const ids = await page.evaluate(async () => {
    const { document, node, connect, guideDefaults } = await import('/src/core.js');
    const d = document(),
      l = d.layers[0],
      a = node('Text', 40, 40),
      b = node('Text', 380, 40),
      join = node('Join Geometry', 720, 40),
      fill = node('Fill', 1060, 40),
      out = node('Output', 1400, 40);
    a.name = 'Master';
    a.text = 'NECT';
    a.alignment = 'end';
    a.params.position.value = [500, 300];
    a.params.size.value = 80;
    b.name = 'Follower';
    b.text = 'Small follower';
    b.params.position.value = [100, 200];
    b.params.size.value = 28;
    l.nodes = [a, b, join, fill, out];
    l.nodes.forEach((n) => (n.collapsed = true));
    l.output = out.id;
    connect(l, a.id, join.id, 'a');
    connect(l, b.id, join.id, 'b');
    connect(l, join.id, fill.id, 'path');
    connect(l, fill.id, out.id, 'path');
    d.editor = {
      ...guideDefaults(),
      snap: true,
      snapGrid: false,
      snapArtboard: false,
      guides: [{ id: 'guide-position', axis: 'x', position: 520, locked: false }],
    };
    window.nect.load(JSON.stringify(d));
    return { a: a.id, b: b.id, join: join.id };
  });
  // Wait for the font-triggered render before measuring or dragging live sockets.
  await page.waitForFunction(() => window.nect.evaluate().error === null);
  const socket = (id, port) =>
    page.locator(
      `[data-source="${id}"]${port ? `[data-source-port="${port}"]` : ':not([data-source-port])'}`,
    );
  const field = (id, key, panel = '.graph') =>
    page.locator(`${panel} .field[data-node="${id}"][data-key="${key}"]`);
  const position = (id) => page.evaluate((id) => window.nect.evaluate().run(id, 'position'), id);
  const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
  const select = (id) => page.locator(`.node[data-id="${id}"] .node-head strong`).click();
  const center = async (loc) => {
    const b = await loc.boundingBox();
    assert.ok(b);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const pathSocket = await center(socket(ids.a)),
    posSocket = await center(socket(ids.a, 'position'));
  assert.ok(posSocket.y - pathSocket.y > 24, 'Path and Position sockets must not overlap');
  const card = await page.locator(`.node[data-id="${ids.a}"]`).boundingBox();
  assert.ok(
    Math.abs(posSocket.x - (card.x + card.width)) < 2,
    'Position socket remains on card border',
  );
  assert.equal(await socket(ids.a).getAttribute('aria-label'), 'Master Path output');
  assert.equal(
    await socket(ids.a, 'position').getAttribute('aria-label'),
    'Master Position output',
  );
  // Actual mouse wiring reveals only compatible typed inputs on the collapsed follower.
  await page.mouse.move(posSocket.x, posSocket.y);
  await page.mouse.down();
  assert.equal(
    await field(ids.b, 'position').evaluate((el) => el.classList.contains('compatible')),
    true,
  );
  assert.equal(
    await field(ids.join, 'a').evaluate((el) => el.classList.contains('compatible')),
    false,
  );
  const target = await center(field(ids.b, 'position').locator('.available-input'));
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  assert.deepEqual(await position(ids.b), [500, 300]);
  assert.equal(
    await page.evaluate(
      (id) =>
        window.nect.document.layers[0].nodes.find((n) => n.id === id).params.position.sourcePort,
      ids.b,
    ),
    'position',
  );
  await page.locator('[data-action="undo"]').click();
  assert.deepEqual(await position(ids.b), [100, 200]);
  await page.locator('[data-action="redo"]').click();
  assert.deepEqual(await position(ids.b), [500, 300]);
  await select(ids.b);
  const input = field(ids.b, 'position', '.inspector-body');
  assert.match(await input.textContent(), /Master Position.*connected value/);
  assert.equal(await input.locator('[data-value]').first().isDisabled(), true);
  await input.locator('[data-connect-menu]').click();
  const options = await page
    .locator('dialog select option')
    .evaluateAll((els) => els.map((o) => o.value));
  assert.ok(options.includes(JSON.stringify([ids.a, 'position'])));
  assert.ok(!options.includes(ids.a));
  await page.locator('[data-cancel]').click();
  assert.equal(await page.locator('dialog').count(), 0);
  assert.deepEqual(await position(ids.b), [500, 300]);
  // Repeated explicit disconnect/reconnect, including fallback and history.
  for (let i = 0; i < 2; i++) {
    await input.locator('[data-connect-menu]').click();
    await page.locator('dialog select').selectOption('');
    await page.locator('[data-confirm]').click();
    assert.deepEqual(await position(ids.b), [100, 200]);
    await input.locator('[data-connect-menu]').click();
    await page.locator('dialog select').selectOption(JSON.stringify([ids.a, 'position']));
    await page.locator('[data-confirm]').click();
    assert.deepEqual(await position(ids.b), [500, 300]);
  }
  // Canvas snapping edits the source. The follower's driven Position cannot write upstream.
  const screen = async (x, y) =>
    page.locator('.artboard').evaluate(
      (el, [x, y]) => {
        const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM());
        return { x: p.x, y: p.y };
      },
      [x, y],
    );
  const drag = async (x, y, dx, dy) => {
    const marker = await page.locator('.node-stage-move rect').boundingBox(),
      a = { x: marker.x + marker.width / 2, y: marker.y + marker.height / 2 },
      origin = await screen(0, 0),
      delta = await screen(dx, dy),
      b = { x: a.x + delta.x - origin.x, y: a.y + delta.y - origin.y };
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
  };
  await select(ids.a);
  await drag(400, 270, 19, 0);
  const master = await position(ids.a);
  assert.ok(Math.abs(master[0] - 520) < 0.1, JSON.stringify(master));
  assert.deepEqual(await position(ids.b), master);
  await page.locator('[data-action="undo"]').click();
  assert.deepEqual(await position(ids.a), [500, 300]);
  await page.locator('[data-action="redo"]').click();
  assert.deepEqual(await position(ids.b), master);
  await select(ids.b);
  let before = await saved();
  await drag(600, 280, 30, 20);
  assert.equal(await saved(), before);
  await select(ids.a);
  await field(ids.a, 'position', '.inspector-body').locator('[data-lock]').click();
  before = await saved();
  await drag(400, 270, 25, 0);
  assert.equal(await saved(), before);
  await field(ids.a, 'position', '.inspector-body').locator('[data-lock]').click();
  await page.locator('.inspector-body [data-text-alignment]').selectOption('start');
  assert.deepEqual(await position(ids.a), master);
  assert.deepEqual(await position(ids.b), master);
  // A cancelled drag-wire leaves no temporary inputs or hidden connection.
  const snapshot = await saved(),
    start = await center(socket(ids.a, 'position'));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await page.locator('.wire-preview').count(), 0);
  assert.equal(await saved(), snapshot);
  // Capture the supplied four-text exercise and all native export formats for CI review.
  const example = await fs.readFile('examples/text-position-reuse.json', 'utf8');
  await page.evaluate((s) => window.nect.load(s), example);
  assert.deepEqual(await position('text-x-only'), [720, 260]);
  assert.deepEqual(await position('text-offset'), [720, 330]);
  await fs.mkdir('test-results', { recursive: true });
  for (const [action, ext] of [
    ['save', 'json'],
    ['export', 'svg'],
    ['export-png', 'png'],
  ]) {
    const pending = page.waitForEvent('download');
    await page.locator(`[data-action="${action}"]`).click();
    await (await pending).saveAs(`test-results/workflow-text-position-output.${ext}`);
  }
  const json = await fs.readFile('test-results/workflow-text-position-output.json', 'utf8');
  await page.evaluate((s) => window.nect.load(s), json);
  assert.deepEqual(await position('text-xy'), [720, 150]);
  assert.equal(await page.evaluate(() => window.nect.evaluate().error), null);
  await page
    .locator('.artboard')
    .screenshot({ path: 'test-results/workflow-text-position-output-artwork.png' });
  await page.screenshot({
    path: 'test-results/workflow-text-position-output-editor.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'PASS Text Position OUT: distinct typed sockets, mouse wiring, menus/cancel, history, source snap, follower/lock protection, reference, sample and JSON/SVG/PNG',
  );
} finally {
  await browser.close();
}
