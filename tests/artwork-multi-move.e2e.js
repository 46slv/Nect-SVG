import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { guideDefaults } from '../src/guides.js';
const sample = fileURLToPath(new URL('../examples/multi-artwork-movement.json', import.meta.url));
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
page.on('dialog', (d) => d.accept());
const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
const screen = (p) =>
  page.locator('.artboard').evaluate((svg, p) => {
    const r = new DOMPoint(...p).matrixTransform(svg.getScreenCTM());
    return [r.x, r.y];
  }, p);
const select = async () => {
  for (let i = 0; i < ids.length; i++)
    await page.locator(`[data-select-layer="${ids[i]}"]`).click({ modifiers: i ? ['Shift'] : [] });
  await page.waitForFunction(() => document.querySelectorAll('.layer.selected').length === 5);
};
const load = async (d = fixture) => {
  await page.evaluate((d) => window.nect.load(JSON.stringify(d)), d);
  await page.locator('[data-action="actual-size"]').click();
  await select();
};
const expected = (before, delta) => {
  const d = structuredClone(before);
  for (const l of d.layers.filter((l) => ids.includes(l.id))) {
    const tr = l.nodes.find((n) => n.type === 'Transform'),
      n = tr || l.nodes[0];
    if (n.type === 'Curve')
      for (const p of n.points) p.position.value = p.position.value.map((v, i) => v + delta[i]);
    else {
      const q =
        n.params[tr ? 'offset' : ['Text', 'Image'].includes(n.type) ? 'position' : 'center'];
      q.value = q.value.map((v, i) => v + delta[i]);
    }
  }
  return d;
};
const verify = async (d) => assert.deepEqual(JSON.parse(await saved()), d);
const drag = async (delta, end = 'up', modifiers = [], holdBeforePress = false) => {
  const a = await screen([170, 170]),
    b = await screen([170 + delta[0], 170 + delta[1]]);
  await page.mouse.move(...a);
  if (holdBeforePress) for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.down();
  if (!holdBeforePress) for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(...b, { steps: 5 });
  if (end === 'back') await page.mouse.move(...a, { steps: 5 });
  else if (end === 'Escape') await page.keyboard.press('Escape');
  else if (end !== 'up')
    await page.evaluate((end) => {
      if (end === 'blur') window.dispatchEvent(new Event('blur'));
      else if (end === 'capture') document.querySelector('.canvas-stage').releasePointerCapture(1);
      else
        document
          .querySelector('.canvas-stage')
          .dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
    }, end);
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key);
};
try {
  await fs.mkdir('test-results', { recursive: true });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.locator('[data-action="open"]').click();
  await page.locator('#open-file').setInputFiles(sample);
  await page.waitForFunction(() => window.nect.document.name === 'Independent artwork placement');
  await page.waitForFunction(() => document.querySelectorAll('.shape').length === 5);
  await page.locator('[data-action="actual-size"]').click();
  await select();
  const before = JSON.parse(await saved());
  assert.equal(await page.locator('.layer.selected').count(), 5);
  assert.equal(
    await page.locator('[data-duplicate-artwork]').isEnabled(),
    true,
    'eligible artwork set supports atomic duplicate in place',
  );
  // Both pointer and Layers Shift toggles are view-only.
  const star = await screen([400, 170]);
  await page.keyboard.down('Shift');
  await page.mouse.click(...star);
  await page.keyboard.up('Shift');
  await page.waitForFunction(() => document.querySelectorAll('.artwork-selection').length === 4);
  await page.locator(`[data-select-layer="${ids[1]}"]`).click({ modifiers: ['Shift'] });
  await page.waitForFunction(() => document.querySelectorAll('.artwork-selection').length === 5);
  await verify(before);
  // Open itself is undoable; isolate movement's one-entry contract on the same reopened project.
  await load(before);
  await drag([24, 16], 'up', ['Alt']);
  await verify(expected(before, [24, 16]));
  assert.equal(await page.locator('.artwork-selection').count(), 5);
  await page.locator('[data-action="undo"]').click();
  await verify(before);
  assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  await page.locator('[data-action="redo"]').click();
  await verify(expected(before, [24, 16]));
  await page.locator('[data-action="undo"]').click();
  await page.locator('.canvas-stage').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await verify(expected(before, [1, 10]));
  await page.locator('[data-action="undo"]').click();
  await page.locator('[data-action="undo"]').click();
  await verify(before);
  for (const end of ['Escape', 'pointercancel', 'capture', 'blur', 'back']) {
    await drag([20, 15], end, ['Alt']);
    await verify(before);
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true, end);
    assert.equal(await page.locator('[data-action="redo"]').isDisabled(), false, end);
  }
  await drag([20, 15], 'up', ['Alt', 'Shift'], true);
  await verify(expected(before, [20, 0]));
  await page.locator('[data-action="undo"]').click();
  // Group must not snap to one of its own members.
  const snap = structuredClone(before);
  snap.editor = {
    ...guideDefaults(),
    snap: true,
    snapArtwork: true,
    snapGuides: false,
    snapGrid: false,
    snapArtboard: false,
  };
  await load(snap);
  await drag([4, 0]);
  await verify(expected(snap, [4, 0]));
  for (const kind of [
    'locked',
    'hidden',
    'guide',
    'bypassed',
    'gradient',
    'driven',
    'curve-limit',
  ]) {
    const d = structuredClone(before),
      l = d.layers[2];
    if (kind === 'locked') l.locked = true;
    if (kind === 'hidden') l.visible = false;
    if (kind === 'guide') l.guide = true;
    if (kind === 'bypassed') l.nodes.find((n) => n.type === 'Transform').bypassed = true;
    if (kind === 'gradient')
      await page.evaluate(async (d) => {
        const { node, connect } = await import('/src/core.js');
        const l = d.layers[2],
          n = node('Linear Gradient Fill');
        l.nodes.push(n);
        connect(l, l.nodes[0].id, n.id, 'path');
        connect(l, n.id, l.output, 'path');
        window.nect.load(JSON.stringify(d));
      }, d);
    else if (kind === 'driven')
      l.nodes.find((n) => n.type === 'Transform').params.offset.expression = '1; 2';
    else if (kind === 'curve-limit') {
      const c = d.layers[4].nodes[0],
        seed = c.points[0];
      c.points = Array.from({ length: 129 }, (_, i) => {
        const p = structuredClone(seed);
        p.id = `point-large-${i}`;
        p.position.value = [
          510 + Math.cos((i / 129) * Math.PI * 2) * 60,
          330 + Math.sin((i / 129) * Math.PI * 2) * 60,
        ];
        return p;
      });
    }
    if (kind === 'gradient') await select();
    else await load(d);
    const blocked = await saved();
    assert.match(
      await page.locator('.artwork-move-status').innerText(),
      /No selected artwork moved/,
    );
    await page.locator('.canvas-stage').focus();
    await page.keyboard.press('ArrowRight');
    await drag([20, 15]);
    assert.equal(await saved(), blocked, kind);
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true, kind);
  }
  await load(before);
  // Fields, Japanese composition events, modal focus and view pan preserve the set/document.
  await page.locator('[data-layer-name]').focus();
  await page.keyboard.press('ArrowRight');
  await verify(before);
  await page.locator('.canvas-stage').focus();
  await page.locator('.canvas-stage').dispatchEvent('compositionstart');
  await page.keyboard.press('ArrowRight');
  await page.locator('.canvas-stage').dispatchEvent('compositionend');
  await verify(before);
  await page.locator('[data-action="help"]').click();
  await page.keyboard.press('ArrowRight');
  await verify(before);
  await page.keyboard.press('Escape');
  await page.locator('.canvas-stage').focus();
  const a = await screen([170, 170]);
  await page.keyboard.down('Space');
  await page.mouse.move(...a);
  await page.mouse.down();
  await page.mouse.move(a[0] + 30, a[1] + 20);
  await page.mouse.up();
  await page.keyboard.up('Space');
  await verify(before);
  assert.equal(await page.locator('.artwork-selection').count(), 5);
  await page.locator('[data-action="actual-size"]').click();
  await drag([24, 16], 'up', ['Alt']);
  for (const [action, ext] of [
    ['save', 'json'],
    ['export', 'svg'],
    ['export-png', 'png'],
  ]) {
    const pending = page.waitForEvent('download');
    await page.locator(`[data-action="${action}"]`).click();
    await (await pending).saveAs(`test-results/workflow-multi-artwork.${ext}`);
  }
  const exported = await page.evaluate(() => window.nect.export());
  assert.doesNotMatch(exported, /artwork-selection|data-artwork-selection/);
  const json = await fs.readFile('test-results/workflow-multi-artwork.json', 'utf8');
  await page.evaluate((json) => window.nect.load(json), json);
  assert.equal(await page.evaluate(() => window.nect.export()), exported);
  assert.equal(await page.locator('.artwork-selection').count(), 0);
  await select();
  await page.screenshot({ path: 'test-results/multi-artwork-1600.png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('[data-action="fit"]').click();
  await page.screenshot({ path: 'test-results/multi-artwork-1280.png' });
  assert.deepEqual(errors, []);
  console.log(
    'Multi-artwork Chrome: selection, rigid drag/arrows, atomic history/cancellation, rejection, snapping, scope, file roundtrip and screenshots passed.',
  );
} finally {
  await browser.close();
}
