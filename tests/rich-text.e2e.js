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
  await page.evaluate(async () => {
    const { document, node, connect } = await import('/src/core.js');
    const doc = document(),
      l = doc.layers[0],
      t = node('Text'),
      fill = node('Fill'),
      out = node('Output');
    t.id = 'rich-text';
    t.text = 'ABA';
    t.params.position.value = [180, 210];
    t.params.size.value = 64;
    l.nodes = [t, fill, out];
    l.output = out.id;
    connect(l, t.id, fill.id, 'path');
    connect(l, fill.id, out.id, 'path');
    window.nect.load(JSON.stringify(doc));
  });
  const read = () => page.evaluate(() => window.nect.document.layers[0].nodes[0]);
  const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
  const range = async (start, end) => {
    const text = page.locator('.inspector-body [data-text]');
    await text.focus();
    await text.evaluate((el, [start, end]) => el.setSelectionRange(start, end), [start, end]);
    await page.locator('.inspector-body [data-style-text-range]').click();
  };
  const field = (key) => page.locator(`[data-character-style="${key}"]`);
  const edit = async (key, value) => {
    await field(key).fill(String(value));
    await field(key).press('Tab');
  };
  const choose = (ids) => page.locator('[data-character-selection]').selectOption(ids);
  const initial = await saved();
  await range(1, 2);
  assert.equal(await saved(), initial);
  await edit('size', 110);
  assert.deepEqual((await read()).characterPositions.styles, { c2: { size: 110 } });
  const enlarged = await saved();
  await page.locator('[data-action="undo"]').click();
  assert.equal(await saved(), initial);
  await page.locator('[data-action="redo"]').click();
  assert.equal(await saved(), enlarged);
  await range(1, 2);
  const fileChooser = page.waitForEvent('filechooser');
  await page.locator('[data-load-character-font]').click();
  await (await fileChooser).setFiles('tests/fixtures/fonts/NectJPFixture-Regular.otf');
  await page.waitForFunction(() => Object.keys(window.nect.document.fontAssets || {}).length === 1);
  assert.equal((await read()).font, 'default');
  assert.ok((await read()).characterPositions.styles.c2.font.startsWith('font-'));
  await choose(['c1', 'c2']);
  assert.equal(await field('size').getAttribute('placeholder'), 'Mixed');
  assert.equal(await field('font').inputValue(), '__mixed');
  const beforeBases = await page.evaluate(() =>
    window.nect
      .evaluate()
      .textLayout('rich-text')
      .characters.map((c) => c.base),
  );
  await edit('width', 150);
  const rich = await read();
  assert.equal(rich.characterPositions.styles.c1.width, 1.5);
  assert.equal(rich.characterPositions.styles.c2.width, 1.5);
  assert.equal(rich.characterPositions.styles.c3, undefined);
  const afterBases = await page.evaluate(() =>
    window.nect
      .evaluate()
      .textLayout('rich-text')
      .characters.map((c) => c.base),
  );
  assert.ok(afterBases[2][0] > beforeBases[2][0]);
  // Numeric changes defer the structural render. Start cancellation on the new
  // field, not a draft-bearing element about to be replaced and blurred.
  await page.waitForFunction(
    () => document.querySelector('[data-character-style="width"]')?.getAttribute('value') === '150',
  );
  const wide = await saved();
  await field('width').fill('220');
  await field('width').press('Escape');
  await field('width').press('Tab');
  assert.equal(await saved(), wide);
  await edit('width', 0);
  assert.equal(await saved(), wide);
  await choose(['c2']);
  await page.locator('[data-character-style-inherit="size"]').click();
  assert.equal((await read()).characterPositions.styles.c2.size, undefined);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await saved(), wide);
  await range(1, 2);
  await choose(['c1', 'c2']);
  await edit('tracking', 12);
  await edit('baselineShift', 18);
  await edit('height', 135);
  assert.equal((await read()).characterPositions.version, 4);
  assert.equal((await read()).characterPositions.styles.c1.height, 1.35);
  assert.equal((await read()).characterPositions.styles.c2.tracking, 12);
  assert.equal((await read()).characterPositions.styles.c3, undefined);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-character-style="height"]')?.getAttribute('value') === '135',
  );
  const spacing = await saved();
  await field('height').fill('220');
  await field('height').press('Escape');
  await field('height').press('Tab');
  assert.equal(await field('height').inputValue(), '135');
  assert.equal(await saved(), spacing);
  await page.locator('[data-action="undo"]').click();
  assert.equal((await read()).characterPositions.styles.c1.height, undefined);
  await page.locator('[data-action="redo"]').click();
  assert.equal(await saved(), spacing);
  await range(0, 2);
  const leading = page.locator('.inspector-body [data-text-leading]');
  await leading.selectOption('auto');
  assert.equal((await read()).leading.mode, 'auto');
  await leading.selectOption('manual');
  const manual = page.locator('.inspector-body [data-text-leading-value]');
  await manual.fill('90');
  await manual.press('Tab');
  assert.deepEqual((await read()).leading, { mode: 'manual', value: 90 });
  // A committed change schedules a structural render. Wait for the new field
  // before starting a cancellation gesture on it. The value attribute is rendered,
  // whereas fill() changes only the previous element's value property.
  await page.waitForFunction(
    () =>
      document.querySelector('.inspector-body [data-text-leading-value]')?.getAttribute('value') ===
      '90',
  );
  const spacingSaved = await saved();
  await manual.fill('123');
  assert.deepEqual((await read()).leading, { mode: 'manual', value: 90 });
  await page.keyboard.press('Escape');
  assert.equal(await manual.inputValue(), '90');
  assert.equal(await saved(), spacingSaved);
  await page.keyboard.press('Tab');
  assert.equal(await saved(), spacingSaved);
  // Numerical controls must be readable in the real inspector, not merely present in DOM.
  for (const viewport of [
    { width: 1920, height: 1200 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    const widths = await page.locator('.typography-field input').evaluateAll((els) =>
      els.map((el) => {
        const rect = el.getBoundingClientRect(),
          button = el.closest('.typography-field').querySelector('button').getBoundingClientRect();
        return { width: rect.width, noOverlap: rect.right <= button.left };
      }),
    );
    assert.equal(widths.length, 5);
    assert.ok(
      widths.every((value) => value.width >= 100 && value.noOverlap),
      JSON.stringify(widths),
    );
  }
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page
    .locator('.character-typography')
    .evaluate((el) => el.scrollIntoView({ block: 'start' }));
  // Save/reopen retains exact SVG and feeds the same outlines into the PNG rasterizer.
  const svg = await page.evaluate(() => window.nect.export());
  assert.ok(!svg.includes('<text'));
  const raster = await page.evaluate(async () => {
    const { rasterizeSVG } = await import('/src/raster.js');
    const svg = window.nect.export(),
      blob = await rasterizeSVG(svg, { width: 960, height: 540 });
    const image = await createImageBitmap(blob),
      canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      width: image.width,
      height: image.height,
      ink: data.some((v, i) => i % 4 === 3 && v > 0),
      bytes: blob.size,
    };
  });
  assert.deepEqual([raster.width, raster.height, raster.ink], [960, 540, true]);
  assert.ok(raster.bytes > 100);
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/workflow-rich-text.json', spacingSaved);
  await fs.writeFile('test-results/workflow-rich-text.svg', svg);
  await page.screenshot({ path: 'test-results/rich-text-range-controls.png', fullPage: true });
  await page.screenshot({ path: 'test-results/typography-spacing-controls.png', fullPage: true });
  await manual.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/typography-manual-leading.png', fullPage: true });
  await page.evaluate((s) => window.nect.load(s), spacingSaved);
  assert.equal(await page.evaluate(() => window.nect.export()), svg);
  // Equal-value paste must commit the replacement identity before range styling.
  await range(1, 2);
  await page.locator('.inspector-body [data-text]').evaluate((el) => {
    el.setSelectionRange(1, 2);
    el.dispatchEvent(
      new InputEvent('beforeinput', { bubbles: true, inputType: 'insertFromPaste' }),
    );
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    el.setSelectionRange(1, 2);
  });
  await page.locator('.inspector-body [data-style-text-range]').click();
  assert.equal((await read()).characterPositions.units[1].id, 'c4');
  assert.equal((await read()).characterPositions.styles.c2, undefined);
  await edit('size', 96);
  assert.equal((await read()).characterPositions.styles.c4.size, 96);
  const cancelChooser = page.waitForEvent('filechooser');
  await page.locator('[data-load-character-font]').click();
  await (await cancelChooser).setFiles([]);
  await choose(['c1']);
  assert.equal(await field('font').isEnabled(), true);
  // New text outside the default font can be repaired by assigning only its highlighted range.
  const text = page.locator('.inspector-body [data-text]');
  await text.fill('A日');
  await text.press('Tab');
  // Unknown replacement is intentionally suspended; this is a new unstyled scene for font repair.
  await page.evaluate(async () => {
    const { document, node } = await import('/src/core.js');
    const doc = document(),
      t = node('Text'),
      out = node('Output');
    t.id = 'rich-text';
    t.text = 'A日';
    out.params.path.source = t.id;
    doc.layers[0].nodes = [t, out];
    doc.layers[0].output = out.id;
    window.nect.load(JSON.stringify(doc));
  });
  await range(1, 2);
  assert.equal(await field('font').isEnabled(), true);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-load-character-font]').click();
  await (await chooser).setFiles('tests/fixtures/fonts/NectJPFixture-Regular.otf');
  await page.waitForFunction(() => window.nect.evaluate().error === null);
  const repaired = await read();
  assert.equal(repaired.font, 'default');
  assert.equal(repaired.characterPositions.styles.c1, undefined);
  assert.ok(repaired.characterPositions.styles.c2.font);
  assert.deepEqual(errors, []);
  console.log(
    'Rich text range font/size/width/height/tracking/baseline, auto/manual leading, readable inspector widths, real selection, undo, font file load, mixed/inherit, Escape, missing glyph repair, JSON/SVG/PNG passed',
  );
} finally {
  await browser.close();
}
