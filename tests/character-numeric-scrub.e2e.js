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
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  const load = async (mixed = false, ids = ['c1']) => {
    await page.evaluate(async (mixed) => {
      const {
        document,
        node,
        connect,
        setCharacterOffsets,
        setCharacterTransforms,
        setCharacterStyles,
      } = await import('/src/core.js');
      const doc = document(),
        layer = doc.layers[0],
        t = node('Text'),
        tr = node('Transform'),
        fill = node('Fill'),
        out = node('Output');
      t.id = 'scrub-text';
      t.text = 'ABCDE';
      t.params.position.value = [180, 220];
      t.params.position.locked = true;
      t.params.size.value = 50;
      t.leading = { mode: 'manual', value: 60 };
      t.textWrap = { width: 500 };
      doc.schemaVersion = 8;
      tr.params.rotation.value = 15;
      tr.params.scale.value = 1.2;
      tr.params.offset.value = [80, 0];
      layer.nodes = [t, tr, fill, out];
      layer.output = out.id;
      layer.nodes.forEach((n, index) => {
        n.position = [40 + index * 360, 40];
      });
      connect(layer, t.id, tr.id, 'path');
      connect(layer, tr.id, fill.id, 'path');
      connect(layer, fill.id, out.id, 'path');
      if (mixed) {
        t.characterPositions = setCharacterOffsets(t.text, undefined, { c1: [2, 3], c2: [22, 33] });
        t.characterPositions = setCharacterTransforms(t.text, t.characterPositions, {
          c1: { rotation: -20, scale: 1 },
          c2: { rotation: 10, scale: 1.5 },
        });
        t.characterPositions = setCharacterStyles(t.text, t.characterPositions, {
          c1: { size: 50, width: 0.8, height: 0.9, tracking: 2, baselineShift: -3 },
          c2: { size: 60, width: 1.2, height: 1.4, tracking: 8, baselineShift: 5 },
        });
      }
      window.nect.load(JSON.stringify(doc));
    }, mixed);
    await page.waitForFunction(() => window.nect.evaluate().error === null);
    await page.locator('[data-character-mode]').click();
    await page.locator('[data-character-selection]').selectOption(ids);
    await page.locator('.character-floating').waitFor({ state: 'visible' });
  };
  const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
  const read = () => page.evaluate(() => window.nect.document.layers[0].nodes[0]);
  const field = (attribute, panel = '.character-floating') =>
    page.locator(`${panel} [data-${attribute}]`);
  const value = (key, id = 'c1') =>
    page.evaluate(
      ({ key, id }) => {
        const glyph = window.nect
          .evaluate()
          .textLayout('scrub-text')
          .characters.find((g) => g.id === id);
        return key.startsWith('axis') ? glyph.offset[Number(key.at(-1))] : glyph[key];
      },
      { key, id },
    );
  const start = async (el) => {
    await el.scrollIntoViewIfNeeded();
    const b = await el.boundingBox(),
      x = b.x + b.width * 0.4,
      y = b.y + b.height / 2;
    assert.equal(
      await el.evaluate((target, point) => document.elementFromPoint(point.x, point.y) === target, {
        x,
        y,
      }),
      true,
      'Real mouse starts inside the actual number input',
    );
    await page.mouse.move(x, y);
    await page.mouse.down();
    return { x, y };
  };
  const scrub = async (el, dx = 14) => {
    const { x, y } = await start(el);
    await page.mouse.move(x + dx, y, { steps: 5 });
    await page.mouse.up();
  };
  const undo = () => page.locator('[data-action="undo"]').click();
  const empty = async () =>
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  for (const panel of ['.character-floating', '.inspector-body']) {
    for (const [attribute, key, expected] of [
      ['character-axis="0"', 'axis0', 10],
      ['character-axis="1"', 'axis1', 10],
      ['character-transform="rotation"', 'rotation', 10],
      ['character-transform="scale"', 'scale', 1.1],
    ]) {
      await load();
      const before = await saved();
      await scrub(field(attribute, panel));
      assert.equal(await value(key), expected, `${panel} ${attribute}`);
      const t = await read();
      assert.deepEqual(t.params.position.value, [180, 220]);
      assert.equal(t.params.size.value, 50);
      const after = await saved();
      await undo();
      assert.equal(await saved(), before);
      await empty();
      await page.locator('[data-action="redo"]').click();
      assert.equal(await saved(), after);
    }
  }
  // Mixed values move together; typing still assigns one absolute value to the selection.
  await load(true, ['c1', 'c2']);
  let before = await saved();
  assert.equal(await field('character-transform="scale"').inputValue(), '');
  await scrub(field('character-transform="scale"'));
  assert.equal(await value('scale', 'c1'), 1.1);
  assert.equal(await value('scale', 'c2'), 1.6);
  assert.equal(await field('character-transform="scale"').getAttribute('placeholder'), 'Mixed');
  await undo();
  assert.equal(await saved(), before);
  await empty();
  for (const [key, expected] of [
    ['size', [60, 70]],
    ['width', [0.9, 1.3]],
    ['height', [1, 1.5]],
    ['tracking', [12, 18]],
    ['baselineShift', [7, 15]],
  ]) {
    await load(true, ['c1', 'c2']);
    before = await saved();
    await scrub(field(`character-style="${key}"`, '.inspector-body'));
    const styles = (await read()).characterPositions.styles;
    assert.deepEqual([styles.c1[key], styles.c2[key]], expected);
    await undo();
    assert.equal(await saved(), before);
    await empty();
  }
  for (const [attribute, panel] of [
    ['character-axis="0"', '.character-floating'],
    ['character-transform="scale"', '.character-floating'],
    ['character-style="width"', '.inspector-body'],
  ]) {
    for (const cancel of ['Escape', 'pointercancel', 'lostpointercapture', 'blur']) {
      await load(true, ['c1', 'c2']);
      before = await saved();
      const input = field(attribute, panel),
        { x, y } = await start(input);
      await page.mouse.move(x + 24, y, { steps: 4 });
      assert.notEqual(await saved(), before);
      if (cancel === 'Escape') await page.keyboard.press('Escape');
      else if (cancel === 'lostpointercapture')
        await input.evaluate((el) =>
          el.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true })),
        );
      else
        await page.evaluate((cancel) => {
          if (cancel === 'blur') window.dispatchEvent(new Event('blur'));
          else
            document.dispatchEvent(
              new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }),
            );
        }, cancel);
      await page.mouse.up();
      assert.equal(await saved(), before, `${attribute} ${cancel}`);
      assert.equal(await field(attribute, panel).inputValue(), '');
      await empty();
    }
  }
  await load();
  before = await saved();
  await scrub(field('character-axis="0"'), 2);
  assert.equal(await saved(), before);
  await empty();
  let p = await start(field('character-axis="0"'));
  const palette = await page.locator('.character-floating').boundingBox();
  await page.mouse.move(p.x + 44, p.y, { steps: 5 });
  assert.equal(await value('axis0'), 40);
  const preview = await page.locator('.character-floating').boundingBox();
  assert.ok(
    Math.abs(preview.x - palette.x) < 1 && Math.abs(preview.y - palette.y) < 1,
    'Palette stays still while its number is captured',
  );
  await page.mouse.move(p.x, p.y);
  await page.mouse.up();
  assert.equal(await saved(), before);
  await empty();
  // A normal click permits direct typing and native arrows; a pending draft has its own Undo.
  await field('character-transform="rotation"').click();
  assert.equal(
    await field('character-transform="rotation"').evaluate((el) => el === document.activeElement),
    true,
  );
  await field('character-transform="rotation"').fill('30');
  await scrub(field('character-transform="rotation"'));
  assert.equal(await value('rotation'), 40);
  await undo();
  assert.equal(await value('rotation'), 30);
  await undo();
  assert.equal(await saved(), before);
  await empty();
  await load();
  await field('character-transform="scale"').press('ArrowUp');
  await field('character-transform="scale"').press('Tab');
  assert.equal(await value('scale'), 1.01);
  await undo();
  await empty();
  for (const [attribute, expected] of [
    ['text-leading-value', 70],
    ['text-wrap-width', 510],
  ]) {
    await load();
    before = await saved();
    await scrub(field(attribute, '.inspector-body'));
    const t = await read();
    assert.equal(attribute.includes('leading') ? t.leading.value : t.textWrap.width, expected);
    await undo();
    assert.equal(await saved(), before);
    await empty();
  }
  await load();
  await page.locator('[data-action="zoom-in"]').click();
  await page.keyboard.down('Shift');
  await page.keyboard.down('Alt');
  await scrub(field('character-axis="0"'));
  await page.keyboard.up('Alt');
  await page.keyboard.up('Shift');
  assert.equal(
    await value('axis0'),
    10,
    'Numeric deltas remain screen-pixel based under zoom/modifiers',
  );
  const svg = await page.evaluate(() => window.nect.export());
  assert.doesNotMatch(svg, /character-floating|data-scrub|character-pivot/);
  const json = await saved();
  await page.evaluate((json) => window.nect.load(json), json);
  assert.equal(await saved(), json);
  assert.equal(await page.evaluate(() => window.nect.export()), svg);
  await load(true, ['c1', 'c2']);
  await scrub(field('character-transform="rotation"'));
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/workflow-character-numeric-scrub.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS actual floating/Inspector character numeric dragging, typography units, mixed selection, type/arrows, history, cancellation, pinned palette, zoom and persistence',
  );
} finally {
  await browser.close();
}
