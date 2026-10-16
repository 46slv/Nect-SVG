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
const sample = await fs.readFile('examples/vector-position-reuse.json', 'utf8');
const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
const pos = () => page.evaluate(() => window.nect.evaluate().run('vector-origin'));
const near = (actual, expected) =>
  actual.forEach((v, i) =>
    assert.ok(Math.abs(v - expected[i]) < 0.001, `${actual} != ${expected}`),
  );
const screen = (p) =>
  page.locator('.artboard').evaluate((el, p) => {
    const q = new DOMPoint(...p).matrixTransform(el.getScreenCTM());
    return [q.x, q.y];
  }, p);
const start = async () => {
  const p = await screen(await pos());
  await page.mouse.move(...p);
  await page.mouse.down();
  return p;
};
const move = async (delta) => {
  const p = await pos(),
    target = await screen(p.map((v, i) => v + delta[i]));
  await page.mouse.move(...target, { steps: 5 });
};
const undo = () => page.locator('[data-action="undo"]').click();
const redo = () => page.locator('[data-action="redo"]').click();
const load = async () => {
  await page.evaluate((s) => window.nect.load(s), sample);
  await page.waitForFunction(() => window.nect.evaluate().error === null);
};
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await load();
  assert.equal(
    await page.locator('[data-source="vector-origin"]').getAttribute('aria-label'),
    'Position Vector output',
  );
  assert.equal(await page.locator('[data-preview="vector-origin"]').count(), 0);
  const mode = () => page.locator('.inspector-body [data-vector-position-handle]');
  const original = await saved(),
    artwork = await page.evaluate(() => window.nect.export());
  assert.equal(await mode().isChecked(), true);
  await mode().uncheck();
  await page.locator('[data-vector-handle]').waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-vector-handle]').count(), 0);
  assert.equal(await page.evaluate(() => window.nect.export()), artwork);
  near(await pos(), [250, 200]);
  await undo();
  assert.equal(await saved(), original);
  assert.equal(await page.locator('[data-vector-handle]').count(), 1);
  await redo();
  assert.equal(await page.locator('[data-vector-handle]').count(), 0);
  await mode().check();
  await load();
  let before = await saved();
  // A blank-canvas click does not move a selected Vector.
  let p = await screen([750, 400]);
  await page.mouse.move(...p);
  await page.mouse.down();
  await page.mouse.move(p[0] + 40, p[1] + 20);
  await page.mouse.up();
  assert.equal(await saved(), before);
  // Point-to-guide snapping uses the Vector itself, not the bounds of connected text.
  await page.evaluate(() => {
    window.nect.document.editor.guides[0].position = 280;
    window.nect.document.editor.guides[1].position = 220;
    window.nect.load(JSON.stringify(window.nect.document));
  });
  before = await saved();
  await start();
  await move([29, 19]);
  await page.mouse.up();
  near(await pos(), [280, 220]);
  near(
    await page.evaluate(() => window.nect.evaluate().run('vector-title', 'position')),
    [280, 220],
  );
  near(
    await page.evaluate(() => window.nect.evaluate().run('vector-caption', 'position')),
    [280, 330],
  );
  await undo();
  assert.equal(await saved(), before);
  assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  await redo();
  near(await pos(), [280, 220]);
  await undo();
  await page.keyboard.down('Alt');
  await start();
  await move([29, 19]);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  near(await pos(), [279, 219]);
  await undo();
  // Escape and real browser capture loss restore the pre-drag snapshot, with no history.
  for (const end of ['escape', 'cancel', 'capture', 'blur']) {
    before = await saved();
    await start();
    await move([60, 35]);
    assert.notEqual(await saved(), before);
    if (end === 'escape') await page.keyboard.press('Escape');
    else
      await page.evaluate((end) => {
        const el = document.querySelector('.canvas-stage');
        if (end === 'blur') window.dispatchEvent(new Event('blur'));
        else if (end === 'capture') el.releasePointerCapture(1);
        else el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
      }, end);
    await page.mouse.up();
    assert.equal(await saved(), before, end);
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  }
  // Point screen size is stable at different zoom, and pan still wins over its handle.
  const settledDiameter = async () => {
    // fitCanvas schedules a canvas refresh; read the compensated marker only
    // once that live geometry reaches its specified 24 px screen width.
    await page.waitForFunction(() => {
      const marker = document.querySelector('.vector-marker polygon');
      return marker && Math.abs(marker.getBoundingClientRect().width - 24) < 0.01;
    });
    return page
      .locator('.vector-marker polygon')
      .evaluate((el) => el.getBoundingClientRect().width);
  };
  const diameter = await settledDiameter();
  await page.locator('[data-action="zoom-in"]').click();
  await page.locator('[data-action="zoom-in"]').click();
  assert.ok(Math.abs((await settledDiameter()) - diameter) < 0.01);
  before = await saved();
  p = await screen(await pos());
  await page.mouse.move(...p);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(p[0] + 45, p[1] + 25);
  await page.mouse.up({ button: 'middle' });
  assert.equal(await saved(), before);
  await page.keyboard.down('Alt');
  await start();
  await move([40, -15]);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  near(await pos(), [290, 185]);
  await undo();
  await page.locator('[data-action="fit"]').click();
  // Committing a typed field before a drag keeps the edit and drag as separate undo steps.
  const x = page.locator('.inspector-body .field[data-key="value"] [data-axis="0"]');
  await x.fill('260');
  await page.keyboard.down('Alt');
  await start(); // The point was at 250; blur commits 260 before the drag snapshot.
  await page.mouse.move(...(await screen([290, 215])), { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  near(await pos(), [300, 215]);
  await undo();
  near(await pos(), [260, 200]);
  await undo();
  near(await pos(), [250, 200]);
  // Small click jitter preserves high-precision fallback and history in actual Chrome.
  await page.evaluate(() => {
    const d = window.nect.document;
    d.layers[0].nodes[0].params.value.value = [250.123456789, 200.987654321];
    window.nect.load(JSON.stringify(d));
  });
  before = await saved();
  p = await start();
  await page.mouse.move(p[0] + 1, p[1] + 1);
  await page.mouse.up();
  assert.equal(await saved(), before);
  assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  // Space navigation over the point has priority and does not create model history.
  await page.keyboard.down('Space');
  await start();
  await page.mouse.move(p[0] + 40, p[1] + 30);
  await page.mouse.up();
  await page.keyboard.up('Space');
  assert.equal(await saved(), before);
  // Input-driven, expression-driven, parameter-locked and layer-locked controllers never write back.
  for (const kind of ['source', 'expression', 'parameter', 'layer']) {
    await load();
    await page.evaluate(async (kind) => {
      const d = window.nect.document,
        l = d.layers[0],
        n = l.nodes[0];
      if (kind === 'source') {
        const { node, connect } = await import('/src/core.js');
        const v = node('Vector');
        v.params.value.value = [350, 200];
        l.nodes.push(v);
        connect(l, v.id, n.id, 'value');
      } else if (kind === 'expression') n.params.value.expression = '330; 210';
      else if (kind === 'parameter') n.params.value.locked = true;
      else l.locked = true;
      window.nect.load(JSON.stringify(d));
    }, kind);
    before = await saved();
    await start();
    await move([30, 20]);
    await page.mouse.up();
    assert.equal(await saved(), before, kind);
    assert.equal(await page.locator('.vector-marker.readonly').count(), 1);
  }
  await load();
  await fs.mkdir('test-results', { recursive: true });
  // Actual save, reload and both export paths while the editor marker is visible.
  for (const [action, ext] of [
    ['save', 'json'],
    ['export', 'svg'],
    ['export-png', 'png'],
  ]) {
    const pending = page.waitForEvent('download');
    await page.locator(`[data-action="${action}"]`).click();
    await (await pending).saveAs(`test-results/workflow-vector-position.${ext}`);
  }
  const svg = await fs.readFile('test-results/workflow-vector-position.svg', 'utf8');
  assert.doesNotMatch(svg, /vector-marker|Position handle|crosshair/);
  // Exported raster is byte-for-byte the same with its editor marker disabled.
  await mode().uncheck();
  const hiddenPNG = page.waitForEvent('download');
  await page.locator('[data-action="export-png"]').click();
  await (await hiddenPNG).saveAs('test-results/workflow-vector-position-no-handle.png');
  assert.deepEqual(
    await fs.readFile('test-results/workflow-vector-position.png'),
    await fs.readFile('test-results/workflow-vector-position-no-handle.png'),
  );
  const json = await fs.readFile('test-results/workflow-vector-position.json', 'utf8');
  await page.evaluate((s) => window.nect.load(s), json);
  near(await pos(), [250, 200]);
  assert.equal(await mode().isChecked(), true);
  assert.equal(await page.locator('[data-vector-handle]').count(), 1);
  assert.equal(await page.evaluate(() => window.nect.evaluate().error), null);
  await page
    .locator('.artboard')
    .screenshot({ path: 'test-results/workflow-vector-position-artboard.png' });
  await page.screenshot({
    path: 'test-results/workflow-vector-position-editor.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'PASS Vector canvas position: explicit opt-in, unchanged Vector2, handle-only snap, Alt, 1 Undo, interruptions, zoom/pan, precise no-op, field commit, readonly, sample and marker-free JSON/SVG/PNG',
  );
} finally {
  await browser.close();
}
