import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sample = fileURLToPath(new URL('../examples/artwork-distribution.json', import.meta.url));
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
      return {
        id: e.dataset.layer,
        bounds: [
          [b.x, b.x + b.width / 2, b.x + b.width],
          [b.y, b.y + b.height / 2, b.y + b.height],
        ],
      };
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
const load = async () => {
  await page.evaluate((doc) => window.nect.load(JSON.stringify(doc)), fixture);
  await select();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-distribute-artwork]')].every((b) => !b.disabled),
  );
};

try {
  await fs.mkdir('test-results', { recursive: true });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.locator('[data-action="open"]').click();
  await page.locator('#open-file').setInputFiles(sample);
  await page.waitForFunction(() => window.nect.document.name === 'Artwork center distribution');
  await select();
  assert.equal(await page.getByRole('heading', { name: '中心を等間隔' }).count(), 1);
  await page.screenshot({ path: 'test-results/artwork-distribution-before-1600.png' });
  for (const [action, axis] of [
    ['center-x', 0],
    ['center-y', 1],
  ]) {
    await load();
    await page.locator('[data-action="actual-size"]').click();
    await page.locator('[data-action="zoom-out"]').click();
    await page.locator('.canvas-stage').hover();
    await page.mouse.wheel(35, 20);
    const before = await saved(),
      bb = await bounds(),
      beforeView = await view(),
      beforeSelection = await selected();
    const active = await page.locator('.graph-layer-name').innerText();
    const ordered = [...bb].sort(
      (a, b) => a.bounds[axis][1] - b.bounds[axis][1] || ids.indexOf(a.id) - ids.indexOf(b.id),
    );
    const first = ordered[0].bounds[axis][1],
      last = ordered.at(-1).bounds[axis][1];
    const button = page.locator(`[data-distribute-artwork="${action}"]`);
    await button.focus();
    await page.keyboard.press('Enter');
    const after = await saved(),
      ab = await bounds(),
      afterDoc = JSON.parse(after),
      beforeDoc = JSON.parse(before);
    assert.notEqual(after, before);
    for (let i = 0; i < ordered.length; i++) {
      const prior = ordered[i],
        next = ab.find((b) => b.id === prior.id),
        fraction = i / (ordered.length - 1);
      // SVG bbox uses float32; Text outlines keep core's toPathData(5) precision.
      assert.ok(
        Math.abs(next.bounds[axis][1] - (first * (1 - fraction) + last * fraction)) < 0.0002,
        `${action}: rendered center ${prior.id}`,
      );
      for (let edge = 0; edge < 3; edge++)
        assert.ok(Math.abs(next.bounds[1 - axis][edge] - prior.bounds[1 - axis][edge]) < 0.0002);
      assert.ok(
        Math.abs(
          next.bounds[axis][2] -
            next.bounds[axis][0] -
            (prior.bounds[axis][2] - prior.bounds[axis][0]),
        ) < 0.0002,
      );
      if (i === 0 || i === ordered.length - 1)
        assert.deepEqual(
          afterDoc.layers.find((l) => l.id === prior.id),
          beforeDoc.layers.find((l) => l.id === prior.id),
          'fixed endpoint source is byte-equivalent',
        );
    }
    assert.deepEqual(await selected(), beforeSelection);
    assert.equal(await page.locator('.graph-layer-name').innerText(), active);
    assert.deepEqual(await view(), beforeView);
    await button.click();
    assert.equal(await saved(), after);
    await page.locator('[data-action="undo"]').click();
    assert.equal(await saved(), before);
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
    await page.locator('[data-action="redo"]').click();
    assert.equal(await saved(), after);
    assert.deepEqual(await selected(), beforeSelection);
    assert.equal(await page.locator('.graph-layer-name').innerText(), active);
    assert.deepEqual(await view(), beforeView);
    // A no-op must retain an existing Redo branch.
    await page.locator('.canvas-stage').focus();
    await page.keyboard.press('ArrowRight');
    await page.locator('[data-action="undo"]').click();
    await button.click();
    assert.equal(await saved(), after);
    assert.equal(await page.locator('[data-action="redo"]').isDisabled(), false);
    await page.locator('[data-action="fit"]').click();
    await page.screenshot({ path: `test-results/artwork-distribution-${action}-1600.png` });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('[data-action="fit"]').click();
    await page.locator('.artwork-distribution').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/artwork-distribution-${action}-1280.png` });
    await page.setViewportSize({ width: 1600, height: 1000 });
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
    assert.match(await page.locator('.artwork-distribute-status').innerText(), /Transformed star:/);
    assert.equal(await page.locator('[data-distribute-artwork="center-x"]').isDisabled(), true);
    const before = await saved();
    await page.locator('[data-distribute-artwork="center-x"]').evaluate((b) => {
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
    await page.locator('[data-distribute-artwork="center-x"]').evaluate((b) => {
      b.disabled = false;
      b.click();
    });
    assert.equal(await saved(), before, busy);
    if (busy === 'composition') await page.locator('.canvas-stage').dispatchEvent('compositionend');
    if (busy === 'modal') await page.keyboard.press('Escape');
    if (busy === 'pen') await page.locator('[data-tool="select"]').click();
  }
  await page.locator('[data-distribute-artwork="center-x"]').click();
  for (const [action, ext] of [
    ['save', 'json'],
    ['export', 'svg'],
    ['export-png', 'png'],
  ]) {
    const download = page.waitForEvent('download');
    await page.locator(`[data-action="${action}"]`).click();
    await (await download).saveAs(`test-results/workflow-artwork-distribution.${ext}`);
  }
  const exported = await page.evaluate(() => window.nect.export());
  assert.doesNotMatch(exported, /artwork-selection|data-distribute-artwork/);
  const json = await fs.readFile('test-results/workflow-artwork-distribution.json', 'utf8');
  await page.evaluate((json) => window.nect.load(json), json);
  assert.equal(await page.evaluate(() => window.nect.export()), exported);
  // Saved JSON remains independent, editable artwork after reopening.
  await page.locator(`[data-select-layer="${ids[0]}"]`).click();
  await page.locator('.canvas-stage').focus();
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await page.evaluate(() => window.nect.export()), exported);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await page.evaluate(() => window.nect.export()), exported);
  assert.deepEqual(errors, []);
  console.log(
    'Artwork center distribution Chrome: measured centers/endpoints, keyboard UI, selection/active/view, one Undo/no-op/Redo, atomic refusal, busy guards, editable save/reopen, exports and screenshots passed.',
  );
} finally {
  await browser.close();
}
