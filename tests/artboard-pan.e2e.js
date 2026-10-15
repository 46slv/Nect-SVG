import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const snapshot = () => page.evaluate(() => JSON.stringify(window.nect.document));
const view = () =>
  page.locator('.artboard').evaluate((el) => el.style.transform.replace(/\s+/g, ''));
const selection = () =>
  page.locator('.node.selected').evaluateAll((els) => els.map((el) => el.dataset.id));
const point = (x, y) =>
  page.locator('.artboard').evaluate(
    (el, p) => {
      const q = new DOMPoint(...p).matrixTransform(el.getScreenCTM());
      return [q.x, q.y];
    },
    [x, y],
  );
async function reset() {
  await page.evaluate(async () => {
    const { document: makeDoc, node } = await import('/src/core.js');
    const { guideDefaults } = await import('/src/guides.js');
    const d = makeDoc(),
      n = node('Rectangle'),
      out = node('Output');
    d.width = 600;
    d.height = 400;
    n.params.center.value = [300, 200];
    n.params.size.value = [120, 80];
    out.params.path.source = n.id;
    d.layers[0].nodes = [n, out];
    d.layers[0].output = out.id;
    d.editor = {
      ...guideDefaults(),
      snap: false,
      guides: [{ id: 'pan-guide', axis: 'x', position: 200, locked: false }],
    };
    window.nect.load(JSON.stringify(d));
  });
  await page.locator('[data-action="fit"]').click();
  await page.locator('[data-action="zoom-in"]').click();
  await page.locator('[data-action="zoom-in"]').click();
}
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.waitForTimeout(300);
  // Real mouse gestures start over blank artwork, a shape, and a guide at enlarged zoom.
  for (const origin of [
    [120, 180],
    [280, 190],
    [200, 200],
  ]) {
    for (const button of ['middle', 'left']) {
      await reset();
      const before = await snapshot(),
        chosen = await selection(),
        p = await point(...origin);
      assert.ok(
        await page.evaluate(
          ([x, y]) => !!document.elementFromPoint(x, y)?.closest('.canvas-stage'),
          p,
        ),
      );
      if (button === 'left') await page.keyboard.down('Space');
      await page.mouse.move(...p);
      await page.mouse.down({ button });
      await page.mouse.move(p[0] + 60, p[1] + 25);
      assert.equal(await view(), 'translate(60px,25px)');
      assert.equal(
        await page.locator('.canvas-stage').evaluate((el) => el.hasPointerCapture(1)),
        true,
      );
      await page.mouse.up({ button });
      if (button === 'left') await page.keyboard.up('Space');
      assert.equal(await snapshot(), before);
      assert.deepEqual(await selection(), chosen);
      assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
    }
  }
  // Browser pointer capture termination and cancellation retain the view but stop movement.
  for (const end of ['cancel', 'capture', 'blur']) {
    await reset();
    const before = await snapshot(),
      p = await point(280, 190);
    await page.mouse.move(...p);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(p[0] + 30, p[1] + 20);
    await page.evaluate((end) => {
      const stage = document.querySelector('.canvas-stage');
      if (end === 'capture') stage.releasePointerCapture(1);
      else if (end === 'blur') window.dispatchEvent(new Event('blur'));
      else stage.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
    }, end);
    // A real subsequent pointer event delivers pending lostpointercapture.
    await page.mouse.move(p[0] + 31, p[1] + 21);
    const stopped = await view();
    await page.mouse.move(p[0] + 80, p[1] + 60);
    await page.mouse.up({ button: 'middle' });
    assert.equal(await view(), stopped, end);
    assert.equal(stopped, 'translate(30px,20px)');
    assert.equal(await snapshot(), before);
  }
  // Pen navigation adds no points, and an outside release ends pointer capture.
  await reset();
  await page.locator('[data-tool="pen"]').click();
  const beforePen = await snapshot(),
    p = await point(280, 190);
  await page.mouse.move(...p);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(1590, 950);
  await page.mouse.up({ button: 'middle' });
  const outside = await view();
  await page.mouse.move(...p);
  assert.equal(await view(), outside);
  assert.equal(await snapshot(), beforePen);
  assert.equal(await page.locator('[data-tool="pen"]').getAttribute('class'), 'active');
  // Escape stops navigation without ending Pen; Fit clears view state.
  await page.locator('[data-action="fit"]').click();
  await page.mouse.move(...(await point(280, 190)));
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(p[0] + 15, p[1] + 15);
  await page.keyboard.press('Escape');
  const stopped = await view();
  await page.mouse.move(p[0] + 90, p[1] + 90);
  await page.mouse.up({ button: 'middle' });
  assert.equal(await view(), stopped);
  assert.equal(await page.locator('[data-tool="pen"]').getAttribute('class'), 'active');
  await page.locator('[data-action="fit"]').click();
  assert.equal(await view(), 'translate(0px,0px)');
  // Normal object movement still uses inverse screen CTM after pan and zoom.
  await page.locator('[data-tool="select"]').click();
  await reset();
  const start = await point(280, 190);
  await page.mouse.move(...start);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(start[0] + 30, start[1] + 20);
  await page.mouse.up({ button: 'middle' });
  const positionBefore = await page.evaluate(() => [
    ...window.nect.document.layers[0].nodes[0].params.center.value,
  ]);
  const marker = await page.locator('.node-stage-move rect').boundingBox(),
    from = [marker.x + marker.width / 2, marker.y + marker.height / 2],
    origin = await point(0, 0),
    delta = await point(20, 10),
    to = from.map((v, i) => v + delta[i] - origin[i]);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to);
  await page.mouse.up();
  const positionAfter = await page.evaluate(
    () => window.nect.document.layers[0].nodes[0].params.center.value,
  );
  assert.ok(Math.abs(positionAfter[0] - positionBefore[0] - 20) < 0.01);
  assert.ok(Math.abs(positionAfter[1] - positionBefore[1] - 10) < 0.01);
  await page.locator('[data-action="undo"]').click();
  assert.deepEqual(
    await page.evaluate(() => window.nect.document.layers[0].nodes[0].params.center.value),
    positionBefore,
  );
  assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('Artboard pan Chrome checks passed');
} finally {
  await browser.close();
}
