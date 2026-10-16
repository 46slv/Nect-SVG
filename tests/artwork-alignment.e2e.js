import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const sample = fileURLToPath(new URL('../examples/artwork-alignment.json', import.meta.url));
const fixture = JSON.parse(await fs.readFile(sample, 'utf8'));
const ids = fixture.layers.filter((l) => l.visible).map((l) => l.id);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
const selected = () =>
  page.locator('.layer.selected').evaluateAll((els) => els.map((e) => e.dataset.layer).sort());
const bounds = () =>
  page.locator('.shape').evaluateAll((els) =>
    els.map((e) => {
      const b = e.getBBox();
      return [
        [b.x, b.x + b.width / 2, b.x + b.width],
        [b.y, b.y + b.height / 2, b.y + b.height],
      ];
    }),
  );
const view = () =>
  page.locator('.artboard').evaluate((e) => {
    const m = e.getScreenCTM();
    return [m.a, m.b, m.c, m.d, m.e, m.f];
  });
const select = async () => {
  for (let i = 0; i < ids.length; i++)
    await page.locator(`[data-select-layer="${ids[i]}"]`).click({ modifiers: i ? ['Shift'] : [] });
  await page.waitForFunction(() => document.querySelectorAll('.layer.selected').length === 5);
};
const load = async (doc = fixture) => {
  await page.evaluate((doc) => window.nect.load(JSON.stringify(doc)), doc);
  await select();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-align-artwork]')].every((b) => !b.disabled),
  );
};
try {
  await fs.mkdir('test-results', { recursive: true });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.locator('[data-action="open"]').click();
  await page.locator('#open-file').setInputFiles(sample);
  await page.waitForFunction(() => window.nect.document.name === 'Artwork selection alignment');
  await select();
  const actions = [
    ['left', 0, 0],
    ['center-x', 0, 1],
    ['right', 0, 2],
    ['top', 1, 0],
    ['center-y', 1, 1],
    ['bottom', 1, 2],
  ];
  for (const [action, axis, edge] of actions) {
    await load();
    // Zoom and pan before alignment; command and history must preserve the view.
    await page.locator('[data-action="actual-size"]').click();
    await page.locator('[data-action="zoom-out"]').click();
    await page.locator('.canvas-stage').hover();
    await page.mouse.wheel(35, 20);
    const before = await saved(),
      bb = await bounds(),
      beforeView = await view(),
      beforeSelection = await selected();
    const active = await page.locator('.graph-layer-name').innerText();
    assert.deepEqual(beforeSelection, [...ids].sort());
    const min = Math.min(...bb.map((b) => b[axis][0])),
      max = Math.max(...bb.map((b) => b[axis][2]));
    const destination = [min, min / 2 + max / 2, max][edge];
    await page.locator(`[data-align-artwork="${action}"]`).click();
    const after = await saved(),
      ab = await bounds();
    assert.notEqual(after, before);
    // Browser SVG bbox/path coordinates use float32 and pathData(5) serialization.
    for (let i = 0; i < ab.length; i++) {
      assert.ok(Math.abs(ab[i][axis][edge] - destination) < 0.0002, `${action}: actual SVG bounds`);
      assert.ok(Math.abs(ab[i][1 - axis][0] - bb[i][1 - axis][0]) < 0.0002);
    }
    assert.deepEqual(await selected(), beforeSelection);
    assert.equal(await page.locator('.graph-layer-name').innerText(), active);
    assert.deepEqual(await view(), beforeView);
    await page.locator(`[data-align-artwork="${action}"]`).click();
    assert.equal(await saved(), after);
    await page.locator('[data-action="undo"]').click();
    assert.equal(await saved(), before);
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
    await page.locator('[data-action="redo"]').click();
    assert.equal(await saved(), after);
    assert.deepEqual(await selected(), beforeSelection);
    assert.deepEqual(await view(), beforeView);
  }
  for (const kind of ['locked', 'hidden', 'guide', 'empty', 'bypassed', 'expression']) {
    const doc = structuredClone(fixture),
      l = doc.layers[2];
    if (kind === 'hidden') l.visible = false;
    else if (kind === 'empty') l.nodes.find((n) => n.type === 'Transform').params.scale.value = 0;
    else if (kind === 'expression')
      l.nodes.find((n) => n.type === 'Transform').params.offset.expression = '1; 2';
    else if (kind === 'bypassed') l.nodes.find((n) => n.type === 'Transform').bypassed = true;
    else l[kind] = true;
    await page.evaluate((doc) => window.nect.load(JSON.stringify(doc)), doc);
    await select();
    assert.match(await page.locator('.artwork-align-status').innerText(), /Transformed star:/);
    assert.equal(await page.locator('[data-align-artwork="left"]').isDisabled(), true);
    const before = await saved();
    await page.locator('[data-align-artwork="left"]').evaluate((b) => {
      b.disabled = false;
      b.click();
    });
    assert.equal(await saved(), before, kind);
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  }
  await load();
  const before = await saved();
  for (const busy of ['composition', 'modal', 'pen']) {
    if (busy === 'composition')
      await page.locator('.canvas-stage').dispatchEvent('compositionstart');
    if (busy === 'modal') await page.locator('[data-action="help"]').click();
    if (busy === 'pen') await page.locator('[data-tool="pen"]').click();
    await page.locator('[data-align-artwork="left"]').evaluate((b) => {
      b.disabled = false;
      b.click();
    });
    assert.equal(await saved(), before, busy);
    if (busy === 'composition') await page.locator('.canvas-stage').dispatchEvent('compositionend');
    if (busy === 'modal') await page.keyboard.press('Escape');
    if (busy === 'pen') await page.locator('[data-tool="select"]').click();
  }
  await page.locator('[data-align-artwork="left"]').click();
  for (const [action, ext] of [
    ['save', 'json'],
    ['export', 'svg'],
    ['export-png', 'png'],
  ]) {
    const download = page.waitForEvent('download');
    await page.locator(`[data-action="${action}"]`).click();
    await (await download).saveAs(`test-results/workflow-artwork-alignment.${ext}`);
  }
  const exported = await page.evaluate(() => window.nect.export());
  assert.doesNotMatch(exported, /artwork-selection|data-align-artwork/);
  const json = await fs.readFile('test-results/workflow-artwork-alignment.json', 'utf8');
  await page.evaluate((json) => window.nect.load(json), json);
  assert.equal(await page.evaluate(() => window.nect.export()), exported);
  await select();
  await page.locator('[data-action="fit"]').click();
  await page.screenshot({ path: 'test-results/artwork-alignment-1600.png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('[data-action="fit"]').click();
  await page.screenshot({ path: 'test-results/artwork-alignment-1280.png' });
  assert.deepEqual(errors, []);
  console.log(
    'Artwork alignment Chrome: six measured final bounds, selection/active/view, one Undo/no-op, atomic refusal, busy guards, save/reopen and screenshots passed.',
  );
} finally {
  await browser.close();
}
