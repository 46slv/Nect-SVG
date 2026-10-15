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
const saved = () => page.evaluate(() => JSON.stringify(window.nect.document));
const screen = (p) =>
  page.locator('.artboard').evaluate((el, p) => {
    const q = new DOMPoint(...p).matrixTransform(el.getScreenCTM());
    return [q.x, q.y];
  }, p);
const move = async (p) => page.mouse.move(...(await screen(p)));
const start = async (p) => {
  await move(p);
  await page.mouse.down();
};
const nodeStagePoint = () =>
  page.locator('.node-stage-move').evaluate((el) => {
    const p = new DOMPoint(0, 0)
      .matrixTransform(el.getScreenCTM())
      .matrixTransform(document.querySelector('.artboard').getScreenCTM().inverse());
    return [p.x, p.y];
  });
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 0.01, `${a} != ${b}`));
const undo = () => page.locator('[data-action="undo"]').click();
const setup = async (type, transformed = false) => {
  const ids = await page.evaluate(
    async ({ type, transformed }) => {
      const { document, node, point, connect, guideDefaults } = await import('/src/core.js');
      const d = document(),
        l = d.layers[0],
        n = node(type),
        out = node('Output');
      d.width = 1000;
      d.height = 650;
      let key = ['Text', 'Null'].includes(type)
        ? 'position'
        : type === 'Vector'
          ? 'value'
          : type === 'Transform'
            ? 'offset'
            : 'center';
      if (n.params[key]) n.params[key].value = [250, 200];
      if (type === 'Vector') n.canvasPositionHandle = true;
      if (type === 'Text') {
        n.text = 'ABC';
        n.params.size.value = 55;
      }
      l.nodes = [n, out];
      l.output = out.id;
      if (['Null', 'Vector', 'Transform'].includes(type)) {
        const c = node('Circle');
        c.params.center.value = [100, 100];
        l.nodes.push(c);
        if (type === 'Transform') {
          connect(l, c.id, n.id, 'path');
          connect(l, n.id, out.id, 'path');
        } else {
          connect(l, n.id, c.id, 'center');
          connect(l, c.id, out.id, 'path');
        }
      } else if (type === 'Path Remap') {
        const c = node('Curve');
        c.points = [point(250, 200), point(350, 200), point(350, 300)];
        c.params.closed.value = false;
        l.nodes.push(c);
        connect(l, c.id, n.id, 'path');
        connect(l, n.id, out.id, 'path');
      } else {
        if (type === 'Curve') {
          n.points = [point(250, 200), point(350, 200), point(350, 300)];
          n.params.closed.value = false;
        }
        connect(l, n.id, out.id, 'path');
      }
      if (transformed) {
        const tr = node('Transform');
        tr.params.anchor.value = [250, 200];
        tr.params.offset.value = [270, 20];
        tr.params.scale.value = 2;
        tr.params.rotation.value = 90;
        l.nodes.push(tr);
        connect(l, n.id, tr.id, 'path');
        connect(l, tr.id, out.id, 'path');
      }
      d.editor = {
        ...guideDefaults(),
        snap: true,
        snapGrid: false,
        snapArtboard: false,
        guides: [
          { id: 'x', axis: 'x', position: 280, locked: false },
          { id: 'y', axis: 'y', position: 202, locked: false },
        ],
      };
      l.nodes.forEach((n) => (n.collapsed = true));
      window.nect.load(JSON.stringify(d));
      return { id: n.id, key, type };
    },
    { type, transformed },
  );
  await page.waitForFunction(() => window.nect.evaluate().error === null);
  return ids;
};
const position = (ids) =>
  page.evaluate(({ id, key, type }) => {
    const n = window.nect.document.layers[0].nodes.find((n) => n.id === id);
    if (type === 'Curve') return n.points[0].position.value;
    if (type === 'Path Remap') return n.edits[0]?.params.position.value || [0, 0];
    return n.params[key].value;
  }, ids);
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  for (const type of ['Null', 'Vector', 'Text', 'Rectangle', 'Transform', 'Curve', 'Path Remap']) {
    const ids = await setup(type),
      before = await saved(),
      origin = await position(ids);
    const p = ['Null', 'Vector', 'Curve', 'Path Remap'].includes(type)
      ? [250, 200]
      : await nodeStagePoint();
    // Axis follows the first motion, then stays fixed even after crossing the diagonal.
    await page.keyboard.down('Shift');
    await start(p);
    await move([p[0] + 29, p[1] + 4]);
    assert.equal((await position(ids))[1], origin[1], type);
    if (['Null', 'Vector'].includes(type))
      assert.equal((await position(ids))[0], 280, 'allowed axis still snaps');
    assert.equal(await page.locator('.snap-match[y1="202"]').count(), 0);
    await page.keyboard.down('Alt');
    await move([p[0] + 5, p[1] + 60]);
    near(await position(ids), [origin[0] + 5, origin[1]]);
    await page.keyboard.up('Shift');
    near(await position(ids), [origin[0] + 5, origin[1] + 60]);
    await page.keyboard.down('Shift');
    near(await position(ids), [origin[0], origin[1] + 60]);
    await move([p[0] + 40, p[1] + 10]);
    near(await position(ids), [origin[0], origin[1] + 10]);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    const changed = await saved();
    await undo();
    assert.equal(await saved(), before, type);
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
    await page.locator('[data-action="redo"]').click();
    assert.equal(await saved(), changed);
    await undo();
    // Escape, browser pointer capture loss, cancellation and blur are exact rollback.
    for (const end of ['Escape', 'capture', 'cancel', 'blur']) {
      await page.keyboard.down('Shift');
      await page.keyboard.down('Alt');
      await start(p);
      await move([p[0] + 25, p[1] + 5]);
      if (end === 'Escape') await page.keyboard.press('Escape');
      else
        await page.evaluate((end) => {
          const stage = document.querySelector('.canvas-stage');
          if (end === 'capture') stage.releasePointerCapture(1);
          else if (end === 'cancel')
            stage.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
          else window.dispatchEvent(new Event('blur'));
        }, end);
      await page.mouse.up();
      await page.keyboard.up('Shift');
      await page.keyboard.up('Alt');
      assert.equal(await saved(), before, `${type}/${end}`);
    }
  }
  // Keyboard-only Alt transitions are honored by the next Shift preview refresh.
  {
    const ids = await setup('Null');
    await start([250, 200]);
    await move([279, 210]);
    await page.keyboard.down('Alt');
    await page.keyboard.down('Shift');
    near(await position(ids), [279, 200]);
    await page.keyboard.up('Alt');
    await page.keyboard.up('Shift');
    near(await position(ids), [280, 210]);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  }
  {
    const ids = await setup('Rectangle'),
      before = await saved();
    await page.keyboard.down('Shift');
    await page.keyboard.down('Alt');
    const p = await nodeStagePoint();
    await start(p);
    await move([p[0] + 30, p[1] + 5]);
    await page.keyboard.press('Delete');
    near(await position(ids), [280, 200]);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    await undo();
    assert.equal(await saved(), before);
    assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  }
  // Zoom, diagonal pan and Shift navigation remain view-only and cannot rotate the lock.
  {
    const ids = await setup('Null'),
      before = await saved();
    await page.locator('[data-action="zoom-in"]').click();
    await page.locator('[data-action="zoom-in"]').click();
    await page.keyboard.down('Shift');
    await move([250, 200]);
    const p = await screen([250, 200]);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(p[0] + 35, p[1] + 25);
    await page.mouse.up({ button: 'middle' });
    assert.equal(await saved(), before);
    const moved = await screen([250, 200]);
    near(moved, [p[0] + 35, p[1] + 25]);
    await page.keyboard.down('Alt');
    await start([250, 200]);
    await move([258, 240]);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    near(await position(ids), [250, 240]);
    await undo();
    assert.equal(await saved(), before);
    await page.locator('[data-action="fit"]').click();
  }
  // Shift-held multi-character drag works from selected text, despite final rotation/scale.
  {
    const ids = await setup('Text', true);
    await page.evaluate(() => (window.nect.document.editor.snap = false));
    await page.locator('[data-character-mode]').click();
    const hit = (id) => page.locator(`.character-hit[data-character="${id}"]`);
    await hit('c1').click();
    await hit('c2').click({ modifiers: ['Shift'] });
    assert.equal(await page.locator('.character-hit.selected').count(), 2);
    const before = await saved(),
      b = await hit('c1').boundingBox(),
      center = [b.x + b.width / 2, b.y + b.height / 2],
      scale = await page.locator('.artboard').evaluate((el) => el.getScreenCTM().a);
    await page.keyboard.down('Shift');
    await page.mouse.move(...center);
    await page.mouse.down();
    await page.mouse.move(center[0] + 30 * scale, center[1] + 5 * scale);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const offsets = await page.evaluate(
      (id) =>
        window.nect.document.layers[0].nodes.find((n) => n.id === id).characterPositions.offsets,
      ids.id,
    );
    near(offsets.c1, [0, -15]);
    near(offsets.c2, [0, -15]);
    assert.equal(await page.locator('.character-hit.selected').count(), 2);
    await fs.mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/shift-axis-character.png', fullPage: true });
    await undo();
    assert.equal(await saved(), before);
    await page.locator('[data-character-mode]').click();
    await hit('c1').click();
    await hit('c2').click({ modifiers: ['Shift'] });
    await hit('c1').click({ modifiers: ['Shift'] });
    assert.equal(await page.locator('.character-hit.selected').count(), 1);
  }
  assert.deepEqual(errors, []);
  console.log(
    'Shift axis actual Chromium: artwork/anchors/controllers, snap/Alt, modifiers, transformed multi-characters, pan/zoom, history and cancellation passed',
  );
} finally {
  await browser.close();
}
