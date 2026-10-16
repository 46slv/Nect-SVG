import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { document as makeDocument } from '../src/core.js';
import { appendArtwork } from '../src/artwork-creation.js';

const sample = fileURLToPath(new URL('../examples/artwork-gap-distribution.json', import.meta.url));
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
          [b.x, b.x + b.width],
          [b.y, b.y + b.height],
        ],
      };
    }),
  );
const view = () =>
  page.locator('.artboard').evaluate((e) => {
    const m = e.getScreenCTM();
    return [m.a, m.b, m.c, m.d, m.e, m.f];
  });
const select = async (chosen = ids) => {
  for (let i = 0; i < chosen.length; i++)
    await page
      .locator(`[data-select-layer="${chosen[i]}"]`)
      .click({ modifiers: i ? ['Shift'] : [] });
  assert.deepEqual(await selected(), [...chosen].sort());
};
const load = async (doc = fixture, chosen = ids) => {
  await page.evaluate((doc) => window.nect.load(JSON.stringify(doc)), doc);
  await select(chosen);
};
const force = async (action) =>
  page.locator(`[data-distribute-gap="${action}"]`).evaluate((b) => {
    b.disabled = false;
    b.click();
  });
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 0.0003, `${label}: ${a} != ${b}`);

try {
  await fs.mkdir('test-results', { recursive: true });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.locator('[data-action="open"]').click();
  await page.locator('#open-file').setInputFiles(sample);
  await page.waitForFunction(() => window.nect.document.name === 'Artwork equal gaps');
  await select();
  assert.equal(await page.getByRole('heading', { name: '隙間を等間隔' }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: '中心を等間隔' }).count(), 1);
  assert.equal(await page.locator('[data-distribute-artwork]').count(), 2);
  await page.screenshot({ path: 'test-results/artwork-gap-before-1600.png' });

  for (const [action, axis] of [
    ['gap-x', 0],
    ['gap-y', 1],
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
    const first = [...bb].sort(
      (a, b) => a.bounds[axis][0] - b.bounds[axis][0] || ids.indexOf(a.id) - ids.indexOf(b.id),
    )[0];
    const last = [...bb].sort(
      (a, b) => b.bounds[axis][1] - a.bounds[axis][1] || ids.indexOf(b.id) - ids.indexOf(a.id),
    )[0];
    const order = [
      first,
      ...bb
        .filter((b) => b !== first && b !== last)
        .sort((a, b) => a.bounds[axis][0] - b.bounds[axis][0]),
      last,
    ];
    const button = page.locator(`[data-distribute-gap="${action}"]`);
    await button.focus();
    await page.keyboard.press('Enter');
    const after = await saved(),
      ab = await bounds(),
      next = JSON.parse(after),
      prior = JSON.parse(before);
    assert.notEqual(after, before);
    const gaps = order
      .slice(1)
      .map(
        (b, i) =>
          ab.find((x) => x.id === b.id).bounds[axis][0] -
          ab.find((x) => x.id === order[i].id).bounds[axis][1],
      );
    for (const gap of gaps) near(gap, gaps[0], `${action} equal final edge gaps`);
    assert.ok(gaps[0] > 0, 'practice sample demonstrates positive spacing');
    for (const b of bb) {
      const n = ab.find((x) => x.id === b.id);
      near(
        n.bounds[axis][1] - n.bounds[axis][0],
        b.bounds[axis][1] - b.bounds[axis][0],
        'unchanged size',
      );
      for (let edge = 0; edge < 2; edge++)
        near(n.bounds[1 - axis][edge], b.bounds[1 - axis][edge], 'orthogonal bounds');
    }
    for (const endpoint of [first, last])
      assert.deepEqual(
        next.layers.find((l) => l.id === endpoint.id),
        prior.layers.find((l) => l.id === endpoint.id),
      );
    assert.deepEqual(await selected(), beforeSelection);
    assert.equal(await page.locator('.graph-layer-name').innerText(), active);
    assert.deepEqual(await view(), beforeView);
    for (let repeat = 0; repeat < 3; repeat++) await button.click();
    assert.equal(await saved(), after);
    await page.locator('[data-action="undo"]').click();
    assert.equal(await saved(), before);
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
    await page.locator('[data-action="redo"]').click();
    assert.equal(await saved(), after);
    assert.deepEqual(await selected(), beforeSelection);
    assert.equal(await page.locator('.graph-layer-name').innerText(), active);
    assert.deepEqual(await view(), beforeView);
    await page.locator('.canvas-stage').focus();
    await page.keyboard.press('ArrowRight');
    await page.locator('[data-action="undo"]').click();
    await button.click();
    assert.equal(await saved(), after);
    assert.equal(await page.locator('[data-action="redo"]').isDisabled(), false);
    for (const [width, height] of [
      [1600, 1000],
      [1280, 800],
      [1024, 768],
    ]) {
      await page.setViewportSize({ width, height });
      await page.locator('[data-action="fit"]').click();
      await page.locator('.artwork-gap-distribution').scrollIntoViewIfNeeded();
      assert.equal(await button.isVisible(), true);
      const rect = await button.boundingBox();
      assert.ok(
        rect.x >= 0 &&
          rect.x + rect.width <= width &&
          rect.y >= 0 &&
          rect.y + rect.height <= height,
      );
      await page.screenshot({ path: `test-results/artwork-gap-${action}-${width}.png` });
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
    const exported = await page.evaluate(() => window.nect.export());
    assert.doesNotMatch(exported, /artwork-selection|data-distribute-gap/);
    const saveFile = `test-results/workflow-artwork-${action}.json`;
    for (const [command, ext] of [
      ['save', 'json'],
      ['export', 'svg'],
      ['export-png', 'png'],
    ]) {
      const download = page.waitForEvent('download');
      await page.locator(`[data-action="${command}"]`).click();
      await (await download).saveAs(`test-results/workflow-artwork-${action}.${ext}`);
    }
    await page.locator('[data-action="open"]').click();
    await page.locator('#open-file').setInputFiles(saveFile);
    assert.equal(await page.evaluate(() => window.nect.export()), exported);
    await select();
    await page.locator(`[data-distribute-gap="${action}"]`).click();
    assert.equal(await saved(), after, 'reopened equal gaps are a no-op');
    assert.match(await page.locator('.message').innerText(), /gaps already equally spaced/);
    // Open is itself undoable in the real UI. The equal-gap no-op must not
    // insert a step between the original distribution and its Undo/Redo.
    await page.locator('[data-action="undo"]').click();
    assert.equal(await saved(), before);
    await page.locator('[data-action="redo"]').click();
    assert.equal(await saved(), after);
    await page.locator(`[data-select-layer="${ids[2]}"]`).click();
    await page.locator('.canvas-stage').focus();
    await page.keyboard.press('ArrowRight');
    assert.notEqual(await page.evaluate(() => window.nect.export()), exported);
    await page.locator('[data-action="undo"]').click();
    assert.equal(await page.evaluate(() => window.nect.export()), exported);
    await page.locator('[data-action="redo"]').click();
    assert.notEqual(await page.evaluate(() => window.nect.export()), exported);
  }

  for (const [action, axis] of [
    ['gap-x', 0],
    ['gap-y', 1],
  ]) {
    const doc = makeDocument();
    doc.schemaVersion = 10;
    const chosen = [
      [0, 50],
      [60, 140],
      [100, 150],
    ].map(([min, max], i) => {
      const at = [200, 200];
      at[axis] = (min + max) / 2;
      const id = appendArtwork(doc, 'Rectangle', { at, name: `Overlap ${i}` }).layerId;
      doc.layers.at(-1).nodes[0].params.size.value[axis] = max - min;
      return id;
    });
    doc.layers.shift();
    await load(doc, chosen);
    await page.locator(`[data-distribute-gap="${action}"]`).click();
    const after = await saved(),
      ab = await bounds();
    near(ab[1].bounds[axis][0] - ab[0].bounds[axis][1], -15, 'negative gap');
    near(ab[2].bounds[axis][0] - ab[1].bounds[axis][1], -15, 'negative gap');
    await page.locator(`[data-distribute-gap="${action}"]`).click();
    assert.equal(await saved(), after);
  }
  // Regression: Text outline width rounding must not accumulate an extra
  // movement/history step on a repeated command, even after file reopening.
  {
    let seed = 57621;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const doc = makeDocument();
    doc.schemaVersion = 10;
    doc.width = 3200;
    const chosen = Array.from({ length: 12 }, (_, i) => {
      const id = appendArtwork(doc, 'Text', {
        at: [i * 250 + rand(), 100 + rand()],
        name: `Letter ${i}`,
      }).layerId;
      const n = doc.layers.at(-1).nodes[0];
      n.text = 'Letter';
      n.params.size.value = 10 + rand() * 30;
      return id;
    });
    doc.layers.shift();
    await load(doc, chosen);
    const before = await saved();
    await page.locator('[data-distribute-gap="gap-x"]').click();
    const after = await saved();
    assert.notEqual(after, before);
    for (let repeat = 0; repeat < 5; repeat++)
      await page.locator('[data-distribute-gap="gap-x"]').click();
    assert.equal(await saved(), after);
    await page.locator('[data-action="undo"]').click();
    assert.equal(await saved(), before);
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
    await page.locator('[data-action="redo"]').click();
    assert.equal(await saved(), after);
    await page.locator('.canvas-stage').focus();
    await page.keyboard.press('ArrowRight');
    await page.locator('[data-action="undo"]').click();
    await page.locator('[data-distribute-gap="gap-x"]').click();
    assert.equal(await page.locator('[data-action="redo"]').isDisabled(), false);
    await page.evaluate((json) => window.nect.load(json), after);
    await select(chosen);
    await page.locator('[data-distribute-gap="gap-x"]').click();
    assert.equal(await saved(), after);
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  }
  for (const kind of ['locked', 'hidden', 'guide', 'empty', 'bypassed', 'expression']) {
    const doc = structuredClone(fixture),
      l = doc.layers[2],
      tr = l.nodes.find((n) => n.type === 'Transform');
    if (kind === 'hidden') l.visible = false;
    else if (kind === 'empty') tr.params.scale.value = 0;
    else if (kind === 'expression') tr.params.offset.expression = '1; 2';
    else if (kind === 'bypassed') tr.bypassed = true;
    else l[kind] = true;
    await load(doc);
    const before = await saved();
    assert.match(await page.locator('.artwork-gap-status').innerText(), /Transformed star:/);
    for (const action of ['gap-x', 'gap-y']) {
      assert.equal(await page.locator(`[data-distribute-gap="${action}"]`).isDisabled(), true);
      await force(action);
      assert.equal(await saved(), before);
      assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
    }
  }
  await load();
  const before = await saved();
  for (const busy of ['composition', 'modal', 'pen', 'drag']) {
    if (busy === 'composition')
      await page.locator('.canvas-stage').dispatchEvent('compositionstart');
    if (busy === 'modal') await page.locator('[data-action="help"]').click();
    if (busy === 'pen') await page.locator('[data-tool="pen"]').click();
    if (busy === 'drag') {
      const b = await page.locator(`.shape[data-layer="${ids[0]}"]`).boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2 + 10);
    }
    const preview = await saved();
    await force('gap-x');
    await force('gap-y');
    assert.equal(await saved(), preview, busy);
    if (busy === 'composition') await page.locator('.canvas-stage').dispatchEvent('compositionend');
    if (busy === 'modal') await page.keyboard.press('Escape');
    if (busy === 'pen') await page.locator('[data-tool="select"]').click();
    if (busy === 'drag') {
      await page.keyboard.press('Escape');
      await page.mouse.up();
    }
    assert.equal(await saved(), before, `${busy} cancellation`);
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  }
  await page.locator('[data-distribute-gap="gap-x"]').click();
  assert.notEqual(await saved(), before, 'valid command works after interrupted edits');
  assert.deepEqual(errors, []);
  console.log(
    'Artwork equal-gap Chrome: final edge gaps, physical endpoints, unequal sizes, negative overlap, keyboard, selection/active/view, repeat/no-op/Undo/Redo, atomic refusal, interrupted edits, editable save/reopen and 1600/1280/1024 screenshots passed.',
  );
} finally {
  await browser.close();
}
