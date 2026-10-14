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
    const { document, node, connect } = await import('/src/core.js');
    const d = document(),
      l = d.layers[0],
      t = node('Text', 40, 40),
      tr = node('Transform', 380, 40),
      fill = node('Fill', 720, 40),
      out = node('Output', 1060, 40);
    d.width = 1000;
    d.height = 650;
    t.text = 'ABC';
    t.params.position.value = [150, 150];
    t.params.size.value = 55;
    tr.params.anchor.value = [150, 150];
    tr.params.offset.value = [400, 30];
    tr.params.scale.value = 2;
    tr.params.rotation.value = 90;
    l.nodes = [t, tr, fill, out];
    l.output = out.id;
    l.nodes.forEach((n) => (n.collapsed = true));
    connect(l, t.id, tr.id, 'path');
    connect(l, tr.id, fill.id, 'path');
    connect(l, fill.id, out.id, 'path');
    window.nect.load(JSON.stringify(d));
    return { t: t.id };
  });
  await page.waitForFunction(() => window.nect.evaluate().error === null);
  const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
  const offsets = () =>
    page.evaluate(
      (id) =>
        window.nect.document.layers[0].nodes.find((n) => n.id === id).characterPositions?.offsets ||
        {},
      ids.t,
    );
  const snapshot = await saved();
  await page.locator('[data-character-mode]').click();
  assert.equal(await saved(), snapshot);
  const hit = () => page.locator('.character-hit[data-character="c2"]');
  await hit().click();
  assert.equal(await saved(), snapshot);
  const drag = async (dx, dy, cancel = false) => {
    const b = await hit().boundingBox(),
      scale = await page.locator('.artboard').evaluate((el) => el.getScreenCTM().a);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx * scale, b.y + b.height / 2 + dy * scale, {
      steps: 8,
    });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  await drag(-6, 8);
  let values = await offsets();
  assert.ok(Math.abs(values.c2[0] - 4) < 0.1);
  assert.ok(Math.abs(values.c2[1] - 3) < 0.1);
  assert.deepEqual(Object.keys(values), ['c2']);
  const completed = await saved();
  await drag(20, 10, true);
  assert.equal(await saved(), completed);
  // Quick fields are outside the SVG and remain usable, clamped inside the viewport.
  const floating = page.locator('.character-floating');
  const field = floating.locator('[data-character-axis="0"]');
  await field.fill('12');
  // Clicking the canvas must commit the original focused draft before rebuilding its DOM.
  const commitStage = await page.locator('.canvas-stage').boundingBox();
  await page.mouse.click(commitStage.x + 8, commitStage.y + 8);
  await page.waitForFunction(
    (id) =>
      window.nect.document.layers[0].nodes.find((n) => n.id === id).characterPositions.offsets
        .c2[0] === 12,
    ids.t,
  );
  assert.ok(Math.abs((await offsets()).c2[1] - 3) < 0.1);
  await hit().click();
  await floating.locator('[data-character-reset]').click();
  assert.deepEqual(await offsets(), {});
  await page.locator('[data-action="undo"]').click();
  assert.equal((await offsets()).c2[0], 12);
  await page.locator('[data-character-mode]').click();
  await hit().click();
  for (const action of ['zoom-in', 'zoom-in', 'zoom-out']) {
    await page.locator(`[data-action="${action}"]`).click();
    const a = await floating.boundingBox(),
      b = await page.locator('.canvas-stage').boundingBox();
    assert.ok(
      a.x >= b.x &&
        a.y >= b.y &&
        a.x + a.width <= b.x + b.width + 1 &&
        a.y + a.height <= b.y + b.height + 1,
      'floating controls stay inside viewport',
    );
  }
  const beforePan = await saved(),
    stage = await page.locator('.canvas-stage').boundingBox();
  await page.keyboard.down('Space');
  await page.mouse.move(stage.x + 30, stage.y + 30);
  await page.mouse.down();
  await page.mouse.move(stage.x + 70, stage.y + 50);
  await page.mouse.up();
  await page.keyboard.up('Space');
  assert.equal(await saved(), beforePan);
  // Arrow movement follows displayed axes, independent of zoom.
  await page.locator('.canvas-stage').focus();
  const beforeArrow = (await offsets()).c2;
  await page.keyboard.press('ArrowRight');
  assert.ok(Math.abs((await offsets()).c2[1] - (beforeArrow[1] - 0.5)) < 0.01);
  await page.locator('[data-edit-text]').click();
  const area = page.locator('.inspector-body [data-text]');
  await area.focus();
  await area.press('Home');
  await page.keyboard.insertText('A');
  await area.press('Tab');
  await page.waitForFunction(
    (id) => window.nect.document.layers[0].nodes.find((n) => n.id === id).text === 'AABC',
    ids.t,
  );
  assert.equal(
    await page.evaluate(
      (id) =>
        window.nect.document.layers[0].nodes.find((n) => n.id === id).characterPositions.units[2]
          .id,
      ids.t,
    ),
    'c2',
  );
  await page.locator('[data-action="undo"]').click();
  assert.equal(
    await page.evaluate(
      (id) => window.nect.document.layers[0].nodes.find((n) => n.id === id).text,
      ids.t,
    ),
    'ABC',
  );
  await fs.mkdir('test-results', { recursive: true });
  const example = await fs.readFile('examples/character-position-prototype.json', 'utf8');
  await page.evaluate((s) => window.nect.load(s), example);
  await page.waitForFunction(() => window.nect.evaluate().error === null);
  await page.locator('[data-character-mode]').click();
  await page.locator('.character-hit[data-character="c2"]').first().click();
  await page.screenshot({ path: 'test-results/workflow-character-position-horizontal.png' });
  for (const [action, ext] of [
    ['save', 'json'],
    ['export', 'svg'],
    ['export-png', 'png'],
  ]) {
    const pending = page.waitForEvent('download');
    await page.locator(`[data-action="${action}"]`).click();
    await (await pending).saveAs(`test-results/workflow-character-position.${ext}`);
  }
  const file = await fs.readFile('test-results/workflow-character-position.json', 'utf8');
  await page.evaluate((s) => window.nect.load(s), file);
  await page.locator('.inspector-body [data-writing-mode]').selectOption('vertical-rl');
  await page.locator('[data-character-mode]').click();
  await page.locator('.character-hit[data-character="c2"]').first().click();
  await page.screenshot({ path: 'test-results/workflow-character-position-vertical.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: character positions in real Chrome, transformed drag, cancel, floating controls, zoom/pan, numeric/keyboard, text retention, JSON/SVG/PNG and screenshots. Native Windows IME remains a separate manual acceptance.',
  );
} finally {
  await browser.close();
}
