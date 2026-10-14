import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  const load = async (type = 'Rectangle') =>
    page.evaluate(async (type) => {
      const { document: makeDoc, node } = await import('/src/core.js');
      const doc = makeDoc(),
        n = node(type);
      // Keep this fixture's editable card clear of the default Circle at [40, 50].
      // Raw mouse gestures must hit the intended control, not an overlapping card.
      for (const existing of doc.layers[0].nodes) existing.position[0] += 1600;
      doc.layers[0].nodes.unshift(n);
      window.nect.load(JSON.stringify(doc));
      return n.id;
    }, type);
  const input = (id, key, axis = 0, panel = '.inspector-body') =>
    page.locator(
      `${panel} .field[data-node="${id}"][data-key="${key}"] [data-value][data-axis="${axis}"]`,
    );
  const value = (id, key) =>
    page.evaluate(
      ({ id, key }) =>
        window.nect.document.layers[0].nodes.find((n) => n.id === id).params[key].value,
      { id, key },
    );
  const start = async (el) => {
    await el.scrollIntoViewIfNeeded();
    const b = await el.boundingBox(),
      x = b.x + b.width * 0.4,
      y = b.y + b.height / 2;
    const hit = await el.evaluate(
      (target, { x, y }) => {
        const actual = document.elementFromPoint(x, y);
        return { matches: actual === target, actual: actual?.outerHTML, target: target.outerHTML };
      },
      { x, y },
    );
    assert.equal(hit.matches, true, `Scrub hit target mismatch: ${JSON.stringify(hit)}`);
    await page.mouse.move(x, y);
    await page.mouse.down();
    return { x, y };
  };
  const scrub = async (el, dx) => {
    const { x, y } = await start(el);
    await page.mouse.move(x + dx, y, { steps: 5 });
    await page.mouse.up();
  };
  const undo = async () => page.locator('[data-action="undo"]').click();
  const empty = async () =>
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  let id = await load();
  const original = await value(id, 'center');
  await scrub(input(id, 'center'), 44);
  assert.deepEqual(await value(id, 'center'), [original[0] + 40, original[1]]);
  await undo();
  assert.deepEqual(await value(id, 'center'), original);
  await empty();
  await page.locator('[data-action="redo"]').click();
  assert.equal((await value(id, 'center'))[0], original[0] + 40);
  await undo();
  await scrub(input(id, 'center', 1, '.graph'), -24);
  assert.deepEqual(await value(id, 'center'), [original[0], original[1] - 20]);
  assert.deepEqual(
    await page.evaluate(
      (id) => window.nect.document.layers[0].nodes.find((n) => n.id === id).position,
      id,
    ),
    [40, 40],
  );
  await undo();
  await empty();
  // A normal click preserves focus and direct editing; native arrow edits still work.
  await input(id, 'center').click();
  assert.equal(await input(id, 'center').evaluate((el) => el === document.activeElement), true);
  await input(id, 'center').fill('123.5');
  await input(id, 'center').press('Tab');
  assert.equal((await value(id, 'center'))[0], 123.5);
  await undo();
  await empty();
  await input(id, 'center').press('ArrowUp');
  await input(id, 'center').press('Tab');
  assert.equal((await value(id, 'center'))[0], original[0] + 1);
  await undo();
  await empty();
  await scrub(input(id, 'center'), 2);
  await empty();
  for (const cancel of ['Escape', 'pointercancel', 'blur']) {
    const { x, y } = await start(input(id, 'center'));
    await page.mouse.move(x + 44, y, { steps: 4 });
    assert.equal((await value(id, 'center'))[0], original[0] + 40);
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else
      await page.evaluate((cancel) => {
        if (cancel === 'blur') window.dispatchEvent(new Event('blur'));
        else
          document.dispatchEvent(
            new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }),
          );
      }, cancel);
    await page.mouse.up();
    assert.deepEqual(await value(id, 'center'), original);
    assert.equal(
      await input(id, 'center').inputValue(),
      String(original[0]),
      `${cancel} restores visible input`,
    );
    await empty();
  }
  const p = await start(input(id, 'center'));
  await page.mouse.move(p.x + 44, p.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.up();
  await empty();
  await input(id, 'center').fill('250');
  await scrub(input(id, 'center'), 14);
  assert.equal((await value(id, 'center'))[0], 260);
  await undo();
  assert.equal((await value(id, 'center'))[0], 250);
  await undo();
  await empty();
  id = await load('Stroke');
  await scrub(input(id, 'width'), -44);
  assert.equal(await value(id, 'width'), 0);
  await undo();
  await empty();
  id = await load('Transform');
  await scrub(input(id, 'scale'), 24);
  assert.equal(await value(id, 'scale'), 1.2);
  await undo();
  await empty();
  id = await load('Star');
  await scrub(input(id, 'innerRadius'), 104);
  assert.equal(await value(id, 'innerRadius'), 120);
  await undo();
  await empty();
  // Wheel over a numeric field must not pan/zoom the graph.
  const graphInput = input(id, 'center', 0, '.graph');
  await graphInput.hover();
  const zoom = await page.locator('.graph').evaluate((el) => el.style.zoom);
  await page.mouse.wheel(0, 30);
  assert.equal(await page.locator('.graph').evaluate((el) => el.style.zoom), zoom);
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/workflow-numeric-scrub-editor.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS numeric drag direction, both UIs, direct click/type/arrows, bounds, scale, history and interruptions',
  );
} finally {
  await browser.close();
}
