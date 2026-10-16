import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
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
  const load = async (options = {}) => {
    await page.evaluate(async (options) => {
      const { document, node, point, connect, setCharacterKerningPairs, setCharacterStyles } =
        await import('/src/core.js');
      const doc = document(),
        l = doc.layers[0],
        t = node('Text'),
        fill = node('Fill'),
        out = node('Output');
      t.id = 'pair-text';
      t.text = options.text || 'AVA';
      t.params.position.value = [140, 220];
      t.params.size.value = 60;
      l.nodes = [t, fill, out];
      l.output = out.id;
      connect(l, t.id, fill.id, 'path');
      connect(l, fill.id, out.id, 'path');
      if (options.pairs) {
        t.characterPositions = setCharacterKerningPairs(t.text, undefined, options.pairs);
        doc.schemaVersion = 9;
      }
      if (options.vertical) t.writingMode = 'vertical-rl';
      if (options.wrap) {
        t.textWrap = { width: options.wrap };
        doc.schemaVersion = Math.max(8, doc.schemaVersion);
      }
      if (options.path) {
        const c = node('Curve');
        c.points = [point(0, 200), point(500, 200)];
        c.params.closed.value = false;
        l.nodes.push(c);
        t.pathAttachment = {
          nodeId: c.id,
          contourId: c.id,
          startMode: 'distance',
          start: options.pathStart ?? 100,
          reversed: false,
        };
        doc.schemaVersion = Math.max(7, doc.schemaVersion);
      }
      if (options.locked) l.locked = true;
      l.nodes.forEach((n, i) => (n.position = [40 + i * 340, 40]));
      window.nect.load(JSON.stringify(doc));
    }, options);
    await page.waitForFunction(() => window.nect.evaluate().error === null);
  };
  const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
  const pairs = () =>
    page.evaluate(() => window.nect.document.layers[0].nodes[0].characterPositions?.kerningPairs);
  const range = async (start, end = start) => {
    const el = page.locator('.inspector-body [data-text]');
    await el.focus();
    await el.evaluate(
      (el, [start, end]) => {
        el.setSelectionRange(start, end);
        el.dispatchEvent(new Event('select', { bubbles: true }));
      },
      [start, end],
    );
    await page.locator('.inspector-body [data-kern-text-cursor]').click();
  };
  const input = () => page.locator('[data-character-kerning]');
  const edit = async (value) => {
    const previous = await input().elementHandle();
    await previous.fill(String(value));
    await previous.press('Tab');
    // Both accepted values and rejected path edits render on the next task.
    // Wait for that render before inspecting the committed numeric control.
    await page.waitForFunction((el) => !el.isConnected, previous);
    await previous.dispose();
  };
  const undo = () => page.locator('[data-action="undo"]').click();
  const empty = async () =>
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  const start = async () => {
    const el = input();
    await el.scrollIntoViewIfNeeded();
    const r = await el.boundingBox(),
      x = r.x + r.width * 0.4,
      y = r.y + r.height / 2;
    assert.equal(
      await el.evaluate((el, p) => document.elementFromPoint(p.x, p.y) === el, { x, y }),
      true,
    );
    await page.mouse.move(x, y);
    await page.mouse.down();
    return { x, y };
  };
  const scrub = async (dx) => {
    const { x, y } = await start();
    await page.mouse.move(x + dx, y, { steps: 5 });
    await page.mouse.up();
  };
  await load();
  const initial = await saved();
  await range(1);
  assert.equal(await saved(), initial);
  await empty();
  assert.match(await page.locator('.pair-kerning').textContent(), /A \| V/);
  assert.equal(await input().inputValue(), '');
  assert.equal(await input().getAttribute('placeholder'), 'Inherited (0)');
  await edit(0);
  assert.deepEqual(await pairs(), { 'c1:c2': 0 });
  assert.equal(await input().inputValue(), '0');
  assert.equal(await page.evaluate(() => window.nect.document.schemaVersion), 9);
  const zero = await saved();
  await undo();
  assert.equal(await saved(), initial);
  await range(1);
  assert.equal(await input().inputValue(), '');
  await empty();
  await page.locator('[data-action="redo"]').click();
  assert.equal(await saved(), zero);
  await range(1);
  await edit(-125.5);
  assert.deepEqual(await pairs(), { 'c1:c2': -125.5 });
  let before = await saved();
  await edit(100001);
  assert.equal(await saved(), before);
  await input().fill('80');
  await input().press('Escape');
  assert.equal(await input().inputValue(), '-125.5');
  await page.locator('[data-character-style-reset]').click();
  assert.equal(await saved(), before);
  await page.locator('[data-character-kerning-inherit]').click();
  assert.deepEqual(await pairs(), {});
  await undo();
  assert.equal(await saved(), before);
  for (const ids of [['c1'], ['c1', 'c3'], ['c1', 'c2', 'c3']]) {
    await range(1);
    await page.locator('[data-character-selection]').selectOption(ids);
    assert.equal(await input().isDisabled(), true);
  }
  await range(1, 3);
  assert.match(await page.locator('.pair-kerning').textContent(), /V \| A/);
  for (const cancel of ['Escape', 'pointercancel', 'lostpointercapture', 'blur']) {
    await load();
    await range(1);
    before = await saved();
    const { x, y } = await start();
    await page.mouse.move(x + 24, y, { steps: 4 });
    assert.notEqual(await saved(), before);
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else if (cancel === 'lostpointercapture')
      await input().evaluate((el) =>
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
    assert.equal(await saved(), before, cancel);
    assert.equal(await input().inputValue(), '', cancel);
    await empty();
  }
  await load();
  await range(1);
  before = await saved();
  await scrub(2);
  assert.equal(await saved(), before);
  assert.equal(await input().inputValue(), '');
  await empty();
  let p = await start();
  await page.mouse.move(p.x + 24, p.y, { steps: 4 });
  await page.mouse.move(p.x, p.y);
  await page.mouse.up();
  assert.equal(await saved(), before);
  assert.equal(await input().inputValue(), '');
  await empty();
  await scrub(14);
  assert.deepEqual(await pairs(), { 'c1:c2': 10 });
  await undo();
  assert.equal(await saved(), before);
  await range(1);
  assert.equal(await input().inputValue(), '');
  await empty();
  await range(1);
  await input().fill('0');
  await scrub(14);
  assert.deepEqual(await pairs(), { 'c1:c2': 10 });
  await undo();
  assert.deepEqual(await pairs(), { 'c1:c2': 0 });
  await range(1);
  assert.equal(await input().inputValue(), '0');
  await undo();
  assert.equal(await saved(), before);
  await range(1);
  assert.equal(await input().inputValue(), '');
  await empty();
  // Native spinner uses fractional step=any browser semantics; direct typing stays available.
  await range(1);
  await edit(-100);
  await page.locator('.inspector-body [data-text-kerning]').uncheck();
  assert.deepEqual(await pairs(), { 'c1:c2': -100 });
  await load({ text: 'A V', wrap: 60, pairs: { 'c2:c3': 300 } });
  await range(2);
  assert.match(await page.locator('.pair-kerning').textContent(), /At a wrap break/);
  await edit(250);
  await page.locator('.inspector-body [data-text-wrap-width]').fill('300');
  await page.locator('.inspector-body [data-text-wrap-width]').press('Tab');
  // Typed controls commit immediately and deliberately render on the next task.
  await page.waitForFunction(() => {
    const el = document.querySelector('.inspector-body [data-text-wrap-width]');
    return (
      window.nect.document.layers[0].nodes[0].textWrap.width === 300 &&
      el?.getAttribute('value') === '300'
    );
  });
  assert.equal(
    await page.evaluate(() => window.nect.evaluate().textLayout('pair-text').lines.length),
    1,
  );
  assert.doesNotMatch(await page.locator('.pair-kerning').textContent(), /At a wrap break/);
  assert.deepEqual(await pairs(), { 'c2:c3': 250 });
  await load({ text: 'AV', vertical: true });
  await range(1);
  await edit(-100);
  const vertical = await page.evaluate(() =>
    window.nect
      .evaluate()
      .textLayout('pair-text')
      .characters.map((g) => g.base),
  );
  assert.ok(vertical[1][1] > vertical[0][1]);
  // A number draft must not follow the stored caret into a different pair.
  await load();
  await range(2);
  await page.locator('[data-character-selection]').selectOption(['c1', 'c2']);
  await input().fill('123');
  await page.locator('.inspector-body [data-kern-text-cursor]').click();
  assert.equal(await input().getAttribute('data-character-kerning'), 'c2:c3');
  assert.equal(await input().inputValue(), '');
  assert.equal(await pairs(), undefined);
  await empty();
  // Draft commit, IME refusal, stale text and exact stable target are exercised in the live DOM.
  await load();
  let el = page.locator('.inspector-body [data-text]');
  await el.evaluate((el) => {
    el.setSelectionRange(0, 0);
    el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText' }));
    el.value = 'XAVA';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  });
  await range(2);
  await edit(20);
  assert.deepEqual(await pairs(), { 'c2:c3': 20 });
  await load();
  el = page.locator('.inspector-body [data-text]');
  await el.evaluate((el) => {
    el.setSelectionRange(1, 1);
    el.dispatchEvent(new Event('compositionstart', { bubbles: true }));
  });
  await page.locator('.inspector-body [data-kern-text-cursor]').click();
  assert.match(await page.locator('.message').textContent(), /Finish or cancel/);
  assert.equal(await pairs(), undefined);
  await el.evaluate((el) => el.dispatchEvent(new Event('compositionend', { bubbles: true })));
  await load({ path: true, pathStart: 0 });
  await range(1);
  before = await saved();
  await edit(-100000);
  assert.equal(await saved(), before);
  assert.equal(await input().inputValue(), '');
  await empty();
  await input().fill('-100000');
  await input().press('Escape');
  assert.equal(await input().inputValue(), '');
  const pathDrag = await start();
  await page.mouse.move(pathDrag.x + 14, pathDrag.y, { steps: 4 });
  assert.deepEqual(await pairs(), { 'c1:c2': 10 });
  assert.equal(await input().evaluate((el) => el.hasPointerCapture(1)), true);
  const lastValid = await saved();
  await page.mouse.move(pathDrag.x - 1000, pathDrag.y);
  assert.match(await page.locator('.message').textContent(), /TEXT_PATH_/);
  assert.equal(await saved(), lastValid, 'Invalid preview keeps the last valid preview');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await saved(), before);
  assert.equal(await input().inputValue(), '');
  await empty();
  await edit(-100);
  assert.deepEqual(await pairs(), { 'c1:c2': -100 });
  const svg = await page.evaluate(() => window.nect.export()),
    json = await saved();
  await page.evaluate((json) => window.nect.load(json), json);
  await page.waitForFunction(() => window.nect.evaluate().error === null);
  assert.equal(await saved(), json);
  assert.equal(await page.evaluate(() => window.nect.export()), svg);
  assert.doesNotMatch(svg, /pair-kerning|data-character|<text/);
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/workflow-pair-kerning.json', json);
  await fs.writeFile('test-results/workflow-pair-kerning.svg', svg);
  execFileSync(process.execPath, [
    'cli/export.js',
    'test-results/workflow-pair-kerning.json',
    'test-results/pair-kerning-cli.svg',
  ]);
  assert.equal(await fs.readFile('test-results/pair-kerning-cli.svg', 'utf8'), svg);
  await range(1);
  await page.locator('.pair-kerning').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/workflow-pair-kerning.png' });
  await load({ locked: true });
  assert.equal(await page.locator('.inspector-body [data-kern-text-cursor]').isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS pair caret/selection, numeric typing/drag/history/cancellation, wrap dormancy, vertical/path rollback, stable draft/IME, JSON and browser/CLI geometry',
  );
} finally {
  await browser.close();
}
