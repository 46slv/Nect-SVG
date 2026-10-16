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
  await page.waitForFunction(() => window.nect);
  const fixture = await fs.readFile('examples/object-resize.json', 'utf8');
  const load = async () => {
    await page.evaluate((s) => window.nect.load(s), fixture);
    await page.locator('[data-object-resize="0"]').waitFor();
  };
  const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
  const value = () =>
    page.evaluate(() => window.nect.document.layers[0].nodes[0].params.size.value);
  const undo = () => page.locator('[data-action="undo"]').click();
  const point = async (index = 0) =>
    page.locator(`[data-object-resize="${index}"]`).evaluate((el) => {
      const p = new DOMPoint(0, 0).matrixTransform(el.getScreenCTM());
      return [p.x, p.y];
    });
  const start = async (index = 0) => {
    const p = await point(index);
    await page.mouse.move(...p);
    await page.mouse.down();
    return p;
  };
  await load();
  let original = await saved();
  let p = await start();
  await page.mouse.move(p[0] + 60, p[1] + 20, { steps: 5 });
  await page.mouse.up();
  assert.ok((await value())[0] > 160);
  assert.equal((await value())[1], 100);
  await undo();
  assert.equal(await saved(), original);
  assert.ok(await page.locator('[data-action="undo"]').isDisabled());
  for (const end of ['Escape', 'blur', 'pointercancel', 'lostpointercapture']) {
    p = await start();
    await page.mouse.move(p[0] + 60, p[1], { steps: 3 });
    if (end === 'Escape') await page.keyboard.press('Escape');
    else
      await page.evaluate((end) => {
        const target =
          end === 'blur'
            ? window
            : end === 'lostpointercapture'
              ? document.querySelector('.canvas-stage')
              : document;
        target.dispatchEvent(
          end === 'blur' ? new Event(end) : new PointerEvent(end, { pointerId: 1, bubbles: true }),
        );
      }, end);
    await page.mouse.up();
    assert.equal(await saved(), original, end);
  }
  p = await start();
  await page.mouse.move(p[0] + 60, p[1]);
  await page.mouse.move(...p);
  await page.mouse.up();
  assert.equal(await saved(), original);
  // Browser focus commits a numeric draft before the gesture snapshot.
  const field = page.locator('.inspector-body .field[data-key="size"] [data-value][data-axis="0"]');
  {
    assert.equal(await field.count(), 1);
    await field.fill('180');
    p = await start();
    await page.mouse.move(p[0] + 50, p[1]);
    await page.mouse.up();
    await undo();
    assert.equal((await value())[0], 180);
    await undo();
    assert.equal(await saved(), original);
  }
  // A middle-drag remains view navigation even directly over a dimension handle.
  p = await point();
  await page.mouse.move(...p);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(p[0] + 40, p[1] + 20);
  await page.mouse.up({ button: 'middle' });
  assert.equal(await saved(), original);
  for (const kind of ['locked', 'expression', 'source']) {
    await load();
    await page.evaluate((kind) => {
      const d = structuredClone(window.nect.document),
        n = d.layers[0].nodes[0];
      if (kind === 'source') {
        const v = structuredClone(n);
        v.id = 'size-driver';
        v.type = 'Vector';
        v.params = { value: { type: 'Vector2', value: [160, 100], expression: '', locked: false } };
        d.layers[0].nodes.push(v);
        n.params.size.source = v.id;
      } else n.params.size[kind] = kind === 'locked' ? true : '160;100';
      window.nect.load(JSON.stringify(d));
    }, kind);
    original = await saved();
    p = await start();
    await page.mouse.move(p[0] + 60, p[1]);
    await page.mouse.up();
    assert.equal(await saved(), original);
  }
  await load();
  await page.evaluate(async () => {
    const { node, connect } = await import('/src/core.js');
    const d = structuredClone(window.nect.document),
      l = d.layers[0],
      n = node('Text');
    n.text = 'Resize font';
    n.params.position.value = [250, 240];
    n.params.size.value = 48;
    l.nodes = [n, l.nodes[1]];
    connect(l, n.id, l.output, 'path');
    window.nect.load(JSON.stringify(d));
  });
  await page.locator('[data-object-resize="0"]').waitFor();
  original = await saved();
  p = await start();
  await page.mouse.move(p[0] + 30, p[1]);
  await page.mouse.up();
  assert.ok((await value()) > 48);
  await undo();
  assert.equal(await saved(), original);
  const exported = await page.evaluate(() => window.nect.export());
  assert.doesNotMatch(exported, /object-resize|Font size/);
  await fs.mkdir(process.env.E2E_ARTIFACT_DIR || 'test-results', { recursive: true });
  await page.screenshot({
    path: `${process.env.E2E_ARTIFACT_DIR || 'test-results'}/object-resize.png`,
  });
  assert.deepEqual(errors, []);
  console.log('Object resize browser checks passed');
} finally {
  await browser.close();
}
