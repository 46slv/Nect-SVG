import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
const snapshot = () => page.evaluate(() => JSON.stringify(window.nect.document));
const xy = (p) =>
  page.locator('.artboard').evaluate((svg, p) => {
    const q = new DOMPoint(...p).matrixTransform(svg.getScreenCTM());
    return [q.x, q.y];
  }, p);
const point = async (p, handle) => {
  await page.mouse.move(...(await xy(p)));
  await page.mouse.down();
  if (handle) await page.mouse.move(...(await xy(handle)), { steps: 5 });
  await page.mouse.up();
};
const begin = async () => page.locator('[data-tool="pen"]').click();
const load = async (s) => page.evaluate((s) => window.nect.load(s), s);
const download = async (action, ext, name = 'workflow-pen-artwork') => {
  const pending = page.waitForEvent('download');
  await page.locator(`[data-action="${action}"]`).click();
  const path = `test-results/${name}.${ext}`;
  await (await pending).saveAs(path);
  return fs.readFile(path);
};
const pixels = (data, mime = 'image/svg+xml') =>
  page.evaluate(
    async ({ data, mime }) => {
      const image = new Image();
      image.src = `data:${mime};base64,${data}`;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const x = c.getContext('2d');
      x.drawImage(image, 0, 0);
      const digest = async (bytes) =>
        [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');
      return {
        all: await digest(x.getImageData(0, 0, c.width, c.height).data),
        old: await digest(x.getImageData(0, 0, 240, c.height).data),
        sample: [...x.getImageData(100, 140, 1, 1).data],
      };
    },
    { data: Buffer.from(data).toString('base64'), mime },
  );
try {
  await fs.mkdir('test-results', { recursive: true });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  const initial = await page.evaluate(async () => {
    const { document, node, connect, layer } = await import('/src/core.js');
    const d = document();
    d.width = 900;
    d.height = 540;
    d.name = 'Independent Pen artwork';
    const l = d.layers[0],
      r = node('Rectangle', 40, 50),
      f = node('Fill', 350, 50),
      o = node('Output', 660, 50);
    r.params.center.value = [120, 150];
    r.params.size.value = [140, 140];
    f.params.color.value = { hex: '#d94141', alpha: 1 };
    l.nodes = [r, f, o];
    l.output = o.id;
    l.name = 'Existing red card';
    l.locked = true;
    connect(l, r.id, f.id, 'path');
    connect(l, f.id, o.id, 'path');
    o.params.path.locked = true;
    const img = node('Image'),
      io = node('Image Output'),
      hidden = layer('Hidden locked image');
    const asset = 'image-pen-reference';
    d.imageAssets = {
      [asset]: {
        name: 'Reference',
        mime: 'image/png',
        width: 1,
        height: 1,
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
      },
    };
    img.asset = asset;
    hidden.nodes = [img, io];
    hidden.output = io.id;
    hidden.visible = false;
    hidden.locked = true;
    connect(hidden, img.id, io.id, 'path');
    d.layers.push(hidden);
    window.nect.load(JSON.stringify(d));
    return { json: JSON.stringify(window.nect.document), image: hidden.id, rect: l.id };
  });
  const oldSVG = await page.evaluate(() => window.nect.export()),
    oldPixels = await pixels(oldSVG);
  await page.locator(`[data-select-layer="${initial.image}"]`).click();
  await begin();
  // Space/middle pan in Pen remains view-only, even over a locked hidden active layer.
  let center = await xy([320, 300]);
  await page.mouse.move(...center);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(center[0] + 15, center[1] + 10, { steps: 3 });
  await page.mouse.up({ button: 'middle' });
  assert.equal(await snapshot(), initial.json);
  await page.locator('[data-action="fit"]').click();
  await point([350, 100]);
  await point([500, 160], [530, 205]);
  await point([420, 270]);
  assert.equal(await snapshot(), initial.json, 'unfinished points never enter the document');
  assert.equal(await page.evaluate(() => window.nect.export()), oldSVG);
  assert.equal(await page.locator('[data-pen-draft]').count(), 1);
  assert.equal(await page.locator('#add-node').isDisabled(), true);
  await page.screenshot({ path: 'test-results/pen-draft-1600x1000.png', fullPage: true });
  await page.keyboard.press('Escape');
  const open = JSON.parse(await snapshot()),
    openJSON = JSON.stringify(open),
    curve = open.layers.at(-1).nodes[0];
  assert.equal(open.layers.length, 3);
  assert.deepEqual(open.layers.slice(0, -1), JSON.parse(initial.json).layers);
  assert.deepEqual(open.imageAssets, JSON.parse(initial.json).imageAssets);
  assert.equal(curve.points.length, 3);
  assert.equal(curve.params.closed.value, false);
  assert.ok(Math.abs(curve.points[1].handleB.value[0] - 30) < 0.01);
  assert.ok(Math.abs(curve.points[1].handleB.value[1] - 45) < 0.01);
  assert.equal(await page.locator('.inspector-body h3').innerText(), 'Artwork · Curve');
  assert.equal(await page.evaluate(() => document.activeElement.matches('.canvas-stage')), true);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await snapshot(), initial.json);
  assert.equal(
    await page
      .locator(`[data-select-layer="${initial.image}"]`)
      .evaluate((el) => el.closest('.layer').classList.contains('selected')),
    true,
  );
  await page.locator('[data-action="redo"]').click();
  assert.equal(await snapshot(), openJSON);
  // Draw an independent closed Bezier using the actual first-anchor hit target.
  await begin();
  await point([600, 140], [620, 110]);
  await point([770, 170]);
  await point([690, 320], [660, 340]);
  await page.locator('.vertex').first().click();
  const closed = JSON.parse(await snapshot()),
    closedJSON = JSON.stringify(closed);
  assert.equal(closed.layers.length, 4);
  assert.deepEqual(closed.layers.slice(0, -1), open.layers);
  assert.equal(closed.layers.at(-1).nodes[0].params.closed.value, true);
  const svg = await download('export', 'svg'),
    png = await download('export-png', 'png'),
    saved = await download('save', 'json');
  const svgPixels = await pixels(svg),
    pngPixels = await pixels(png, 'image/png');
  assert.deepEqual(svgPixels, pngPixels);
  assert.equal(svgPixels.old, oldPixels.old, 'existing card pixels remain exact');
  assert.deepEqual(svgPixels.sample, [217, 65, 65, 255]);
  assert.notEqual(svgPixels.all, oldPixels.all);
  assert.ok(
    svg.toString().includes(oldSVG.slice(oldSVG.indexOf('>') + 1, oldSVG.lastIndexOf('</svg>'))),
  );
  assert.equal(JSON.stringify(JSON.parse(saved.toString())), closedJSON);
  // Cold reopen exercises persistence independently from the session history.
  await page.reload();
  await page.waitForSelector('.shape');
  await load(saved.toString());
  assert.equal(await snapshot(), closedJSON);
  assert.equal((await pixels(await page.evaluate(() => window.nect.export()))).all, svgPixels.all);
  // Actual file actions resolve drafts before serializing or rasterizing.
  for (const [action, ext] of [
    ['save', 'json'],
    ['export', 'svg'],
    ['export-png', 'png'],
  ])
    for (const count of [1, 2]) {
      await load(closedJSON);
      await begin();
      await point([300, 350]);
      if (count === 2) await point([440, 400], [470, 420]);
      const bytes = await download(action, ext, `workflow-pen-finish-${action}-${count}`),
        current = JSON.parse(await snapshot());
      assert.equal(await page.locator('[data-pen-draft]').count(), 0);
      assert.equal(current.layers.length, count === 2 ? 5 : 4);
      assert.deepEqual(current.layers.slice(0, 4), closed.layers);
      if (action === 'save') assert.deepEqual(JSON.parse(bytes.toString()), current);
      else if (action === 'export')
        assert.equal(bytes.toString(), await page.evaluate(() => window.nect.export()));
      else
        assert.deepEqual(
          await pixels(bytes, 'image/png'),
          await pixels(await page.evaluate(() => window.nect.export())),
        );
    }
  // Cancel, one-point finish and pressed-point interruption never leave orphan layers.
  for (const finish of ['Enter', 'Escape', 'tool', 'Cancel', 'Undo']) {
    await load(closedJSON);
    await begin();
    await point([300, 350]);
    if (finish === 'Cancel') await page.locator('[data-pen-cancel]').click();
    else if (finish === 'Undo') await page.locator('[data-action="undo"]').click();
    else if (finish === 'tool') await page.locator('[data-tool="select"]').click();
    else await page.keyboard.press(finish);
    assert.equal(await snapshot(), closedJSON, finish);
    assert.equal(await page.locator('[data-pen-draft]').count(), 0);
  }
  for (const cancel of ['Cancel', 'Undo']) {
    await begin();
    await point([300, 350]);
    await point([420, 400], [440, 420]);
    await page.locator(cancel === 'Cancel' ? '[data-pen-cancel]' : '[data-action="undo"]').click();
    assert.equal(await snapshot(), closedJSON);
  }
  // Native keyboard activation must honor the focused action instead of generic Pen Enter.
  for (const action of ['pen-cancel', 'pen-finish', 'action="undo"', 'tool="select"']) {
    await load(closedJSON);
    await begin();
    await point([300, 350]);
    await point([420, 400]);
    await page.locator(`[data-${action}]`).press('Enter');
    assert.equal(await page.locator('[data-pen-draft]').count(), 0);
    assert.equal(
      JSON.parse(await snapshot()).layers.length,
      action === 'pen-finish' || action === 'tool="select"' ? 5 : 4,
    );
    if (action === 'pen-cancel' || action === 'action="undo"')
      assert.equal(await snapshot(), closedJSON);
  }
  for (const viewport of ['.canvas-stage', '.graph-scroll']) {
    await load(closedJSON);
    await begin();
    await point([300, 350]);
    await point([420, 400]);
    const box = await page.locator(viewport).boundingBox(),
      p =
        viewport === '.canvas-stage' ? await xy([500, 350]) : [box.x + box.width - 40, box.y + 50];
    await page.mouse.move(...p);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(p[0] + 20, p[1] + 15, { steps: 3 });
    await page.keyboard.press('Escape');
    await page.mouse.up({ button: 'middle' });
    assert.equal(await snapshot(), closedJSON);
    assert.equal(await page.locator('[data-pen-draft]').count(), 1);
    assert.equal(await page.locator('[data-tool="pen"]').getAttribute('class'), 'active');
    await page.locator('.canvas-stage').press('Escape');
    assert.equal(JSON.parse(await snapshot()).layers.length, 5);
  }
  await load(closedJSON);
  await begin();
  await point([300, 350]);
  await point([420, 400]);
  await page.locator(`[data-select-layer="${closed.layers.at(-1).id}"]`).press('F2');
  assert.equal(await page.locator('[data-pen-draft]').count(), 0);
  const beforeRename = await snapshot();
  await page.locator('[data-rename-name]').fill('Renamed closed curve');
  await page.locator('[data-rename-name]').press('Enter');
  assert.equal(JSON.parse(await snapshot()).layers[3].name, 'Renamed closed curve');
  await page.locator('[data-action="undo"]').click();
  assert.equal(await snapshot(), beforeRename);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await snapshot(), closedJSON);
  for (const released of [0, 2])
    for (const interrupt of ['pointercancel', 'lostpointercapture', 'blur']) {
      await load(closedJSON);
      await begin();
      if (released) {
        await point([300, 350]);
        await point([420, 400], [440, 420]);
      }
      await page.evaluate(() =>
        document.addEventListener(
          'pointerdown',
          (e) => {
            window.penPointer = e.pointerId;
          },
          { once: true },
        ),
      );
      await page.mouse.move(...(await xy([500, 350])));
      await page.mouse.down();
      await page.mouse.move(...(await xy([520, 380])), { steps: 3 });
      await page.evaluate((kind) => {
        if (kind === 'blur') window.dispatchEvent(new Event('blur'));
        else
          (kind === 'pointercancel'
            ? document
            : document.querySelector('.canvas-stage')
          ).dispatchEvent(new PointerEvent(kind, { bubbles: true, pointerId: window.penPointer }));
      }, interrupt);
      await page.mouse.up();
      assert.equal(await snapshot(), closedJSON);
      if (released) {
        assert.equal(await page.locator('.vertex').count(), 2);
        await page.keyboard.press('Escape');
        assert.equal(JSON.parse(await snapshot()).layers.at(-1).nodes[0].points.length, 2);
        await page.locator('[data-action="undo"]').click();
        assert.equal(await snapshot(), closedJSON);
      } else assert.equal(await page.locator('[data-pen-draft]').count(), 0);
    }
  await load(closedJSON);
  await page.locator('[data-tool="select"]').click();
  // Explicit source Curve editing retains its layer and Output; blank canvas cannot move it.
  const curveLayer = closed.layers.at(-1),
    source = curveLayer.nodes[0];
  await page.locator(`[data-select-layer="${curveLayer.id}"]`).click();
  await page.locator(`.node[data-id="${source.id}"] .node-head strong`).click();
  await point([850, 450]);
  assert.equal(await snapshot(), closedJSON);
  await page.locator('.canvas-stage').press('ArrowRight');
  assert.equal(await snapshot(), closedJSON);
  await page.locator(`.node[data-id="${source.id}"] .node-head strong`).click();
  await page.locator(`[data-add-point="${source.id}"]`).click();
  assert.equal(JSON.parse(await snapshot()).layers.length, 4);
  assert.deepEqual(
    JSON.parse(await snapshot())
      .layers.at(-1)
      .nodes.at(-1),
    curveLayer.nodes.at(-1),
  );
  await page.locator('[data-action="undo"]').click();
  assert.equal(await snapshot(), closedJSON);
  for (const size of [
    { width: 1280, height: 800 },
    { width: 1600, height: 1000 },
  ]) {
    await page.setViewportSize(size);
    await page.locator('[data-action="fit"]').click();
    await begin();
    await point([350, 330]);
    await point([480, 420], [510, 435]);
    for (const selector of ['[data-pen-finish]', '[data-pen-cancel]']) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height);
      assert.equal(
        await page.locator(selector).evaluate((el) => {
          const r = el.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el;
        }),
        true,
      );
    }
    await page.screenshot({
      path: `test-results/pen-draft-${size.width}x${size.height}.png`,
      fullPage: true,
    });
    await page.locator('[data-pen-cancel]').click();
  }

  // Bounded failure evidence distinguishes delivered pointer coordinates from
  // model translation. This observes events only; it never changes app state.
  const beginCurveTrace = () =>
    page.evaluate(() => {
      window.curvePointerTrace = [];
      window.curveRequestedInput = {};
      if (window.curveTraceInstalled) return;
      window.curveTraceInstalled = true;
      for (const capture of [true, false])
        for (const type of ['pointerdown', 'pointermove', 'pointerup'])
          document.addEventListener(
            type,
            (e) => {
              if (!window.curvePointerTrace) return;
              const matrix = document.querySelector('.artboard')?.getScreenCTM();
              const world =
                matrix && new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
              window.curvePointerTrace.push({
                type,
                capture,
                x: e.clientX,
                y: e.clientY,
                buttons: e.buttons,
                pointerId: e.pointerId,
                altKey: e.altKey,
                shiftKey: e.shiftKey,
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                world: world && [world.x, world.y],
                matrix: matrix && [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
              });
              if (window.curvePointerTrace.length > 80) window.curvePointerTrace.shift();
            },
            capture,
          );
    });
  const proveRigidPlacement = async (before, delta) => {
    const after = JSON.parse(await snapshot()),
      original = before.layers.at(-1).nodes[0].points,
      points = after.layers.at(-1).nodes[0].points;
    const actual = points.map((p, i) =>
      p.position.value.map((v, axis) => v - original[i].position.value[axis]),
    );
    if (actual.some((xy) => xy.some((v, axis) => Math.abs(v - delta[axis]) >= 0.00001))) {
      const evidence = await page.evaluate(() => ({
        trace: window.curvePointerTrace || [],
        requestedInput: window.curveRequestedInput || {},
      }));
      console.error(
        'Curve placement mismatch',
        JSON.stringify({
          expectedDelta: delta,
          firstActualDelta: actual[0],
          deltaRange: [0, 1].map((axis) => [
            Math.min(...actual.map((v) => v[axis])),
            Math.max(...actual.map((v) => v[axis])),
          ]),
        }),
      );
      await fs.writeFile(
        'test-results/workflow-curve-placement-failure.json',
        JSON.stringify(
          { expectedDelta: delta, actualDeltas: actual, ...evidence, before, after },
          null,
          2,
        ),
      );
      await page.screenshot({ path: 'test-results/pen-placement-failure.png', fullPage: true });
    } else if (delta[0] === 18.75 && delta[1] === -11.25) {
      const evidence = await page.evaluate(() => ({
        trace: window.curvePointerTrace || [],
        requestedInput: window.curveRequestedInput || {},
      }));
      const label = before.layers.at(-1).nodes[0].params.closed.value ? 'closed' : 'open';
      await fs.writeFile(
        `test-results/workflow-curve-placement-input-${label}.json`,
        JSON.stringify(
          { expectedDelta: delta, actualDeltas: actual, ...evidence, before, after },
          null,
          2,
        ),
      );
    }
    for (let i = 0; i < points.length; i++) {
      for (let axis = 0; axis < 2; axis++)
        assert.ok(
          Math.abs(
            points[i].position.value[axis] - original[i].position.value[axis] - delta[axis],
          ) < 0.00001,
          `anchor ${i} axis ${axis}: actual delta ${actual[i][axis]}, expected ${delta[axis]}`,
        );
      points[i].position.value = [...original[i].position.value];
    }
    assert.deepEqual(after, before, 'only authored Positions may change');
  };
  const hitCurve = async (id) => {
    await beginCurveTrace();
    const p = await xy([420, 210]);
    await page.evaluate((screen) => {
      window.curveRequestedInput.start = { artboard: [420, 210], screen };
    }, p);
    assert.equal(
      await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-layer]')?.dataset.layer,
        p,
      ),
      id,
    );
    await page.mouse.move(...p);
    await page.mouse.down();
  };
  for (const isClosed of [false, true]) {
    await load(initial.json);
    await begin();
    await point([330, 120], [350, 90]);
    await point([500, 170], [530, 200]);
    await point([400, 320], [380, 335]);
    if (isClosed) await page.locator('.vertex').first().click();
    else await page.keyboard.press('Enter');
    const beforeJSON = await snapshot(),
      before = JSON.parse(beforeJSON),
      id = before.layers.at(-1).id;
    assert.equal(await page.locator('.inspector-body h3').innerText(), 'Artwork · Curve');
    assert.match(await page.locator('.artwork-move-status').innerText(), /Drag artwork/);
    // No test-side refocus: both native finish paths must retain the artboard.
    const focus = await page.evaluate(() => ({
      canvas: document.activeElement.matches('.canvas-stage'),
      tag: document.activeElement.tagName,
      className: document.activeElement.getAttribute('class'),
    }));
    if (!focus.canvas)
      await fs.writeFile(
        'test-results/workflow-curve-focus-failure.json',
        JSON.stringify({ closed: isClosed, focus, document: before }, null, 2),
      );
    assert.equal(focus.canvas, true, `finish focus: ${JSON.stringify(focus)}`);
    // No selection workaround: the freshly finished path accepts both native arrow steps.
    await page.keyboard.press('ArrowRight');
    await proveRigidPlacement(before, [1, 0]);
    await page.keyboard.press('Shift+ArrowDown');
    await proveRigidPlacement(before, [1, 10]);
    await page.locator('[data-action="undo"]').click();
    await page.locator('[data-action="undo"]').click();
    assert.equal(await snapshot(), beforeJSON);
    // Real zoom and middle pan must change only the view; pointer deltas stay artboard-space.
    await page.locator('[data-action="actual-size"]').click();
    await page.locator('[data-action="zoom-out"]').click();
    const pan = await xy([720, 350]);
    await page.mouse.move(...pan);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(pan[0] + 25, pan[1] - 15, { steps: 3 });
    await page.mouse.up({ button: 'middle' });
    assert.equal(await snapshot(), beforeJSON);
    await page.keyboard.down('Alt');
    await hitCurve(id);
    const end = await xy([438.75, 198.75]);
    await page.evaluate((screen) => {
      window.curveRequestedInput.end = { artboard: [438.75, 198.75], screen };
    }, end);
    await page.mouse.move(...end, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await proveRigidPlacement(before, [18.75, -11.25]);
    const movedJSON = await snapshot();
    await page.locator('[data-action="undo"]').click();
    assert.equal(await snapshot(), beforeJSON);
    await page.locator('[data-action="undo"]').click();
    assert.equal(await snapshot(), initial.json);
    await page.locator('[data-action="redo"]').click();
    await page.locator('[data-action="redo"]').click();
    assert.equal(await snapshot(), movedJSON);
    const label = isClosed ? 'closed' : 'open',
      svg = await download('export', 'svg', 'workflow-curve-placement-' + label),
      png = await download('export-png', 'png', 'workflow-curve-placement-' + label),
      json = await download('save', 'json', 'workflow-curve-placement-' + label),
      rendered = await pixels(svg);
    assert.deepEqual(await pixels(png, 'image/png'), rendered);
    assert.equal(rendered.old, oldPixels.old);
    assert.equal(JSON.stringify(JSON.parse(json.toString())), movedJSON);
    await page.reload();
    await page.waitForSelector('.shape');
    await load(json.toString());
    assert.equal(await snapshot(), movedJSON);
    assert.deepEqual(await pixels(await page.evaluate(() => window.nect.export())), rendered);
    // Actual pressed-pointer interruption cannot leave part of the batch moved or resume later.
    for (const interrupt of [
      'Escape',
      'pointercancel',
      'lostpointercapture',
      'blur',
      'out-and-back',
    ]) {
      await load(beforeJSON);
      await page.locator(`[data-select-layer="${id}"]`).click();
      await page.evaluate(() =>
        document.addEventListener(
          'pointerdown',
          (e) => {
            window.curvePointerId = e.pointerId;
          },
          { once: true },
        ),
      );
      await page.keyboard.down('Alt');
      await hitCurve(id);
      await page.mouse.move(...(await xy([445, 230])), { steps: 3 });
      assert.notEqual(await snapshot(), beforeJSON);
      if (interrupt === 'Escape') await page.keyboard.press('Escape');
      else if (interrupt === 'out-and-back')
        await page.mouse.move(...(await xy([420, 210])), { steps: 3 });
      else
        await page.evaluate((kind) => {
          if (kind === 'blur') window.dispatchEvent(new Event('blur'));
          else
            (kind === 'pointercancel'
              ? document
              : document.querySelector('.canvas-stage')
            ).dispatchEvent(
              new PointerEvent(kind, { bubbles: true, pointerId: window.curvePointerId }),
            );
        }, interrupt);
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await page.mouse.move(...(await xy([460, 250])));
      assert.equal(await snapshot(), beforeJSON, interrupt);
      assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
    }
    await load(beforeJSON);
    await page.locator(`[data-select-layer="${id}"]`).click();
    await page.keyboard.down('Alt');
    await hitCurve(id);
    await page.mouse.move(...(await xy([435, 220])), { steps: 3 });
    await page.evaluate(() => window.nect.document.layers.at(-1).nodes[0].points.reverse());
    await page.mouse.up();
    await page.keyboard.up('Alt');
    assert.equal(
      await snapshot(),
      beforeJSON,
      'ordered anchor identity is rechecked before commit',
    );
    await load(movedJSON);
    await page.locator(`[data-select-layer="${id}"]`).click();
    await page.screenshot({ path: `test-results/pen-placement-${label}.png`, fullPage: true });
  }

  // The movement-only resource boundary is visible and never removes authored points.
  for (const count of [128, 129]) {
    const id = await page.evaluate(
      async ({ base, count }) => {
        const { point } = await import('/src/core.js'),
          { createPenArtworkDraft, appendPenArtwork } = await import('/src/artwork-creation.js'),
          d = JSON.parse(base),
          layer = createPenArtworkDraft(d, [400, 160]);
        layer.nodes[0].points = Array.from({ length: count }, (_, i) =>
          point(
            400 + Math.cos((i * Math.PI * 2) / count) * 80,
            240 + Math.sin((i * Math.PI * 2) / count) * 80,
          ),
        );
        layer.nodes[0].params.closed.value = true;
        layer.nodes.forEach((n) => {
          n.collapsed = true;
        });
        appendPenArtwork(d, layer);
        window.nect.load(JSON.stringify(d));
        return layer.id;
      },
      { base: initial.json, count },
    );
    await page.locator(`[data-select-layer="${id}"]`).click();
    const beforeJSON = await snapshot(),
      before = JSON.parse(beforeJSON);
    if (count === 128) {
      assert.match(await page.locator('.artwork-move-status').innerText(), /Drag artwork/);
      await page.locator('.canvas-stage').press('ArrowRight');
      await proveRigidPlacement(before, [1, 0]);
      await page.locator('[data-action="undo"]').click();
      assert.equal(await snapshot(), beforeJSON);
    } else {
      assert.match(
        await page.locator('.artwork-move-status').innerText(),
        /128 anchors.*graph Curve.*Save\/export/,
      );
      await page.locator('.canvas-stage').press('ArrowRight');
      assert.equal(await snapshot(), beforeJSON);
      assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
      const svg = await download('export', 'svg', 'workflow-curve-limit-129'),
        png = await download('export-png', 'png', 'workflow-curve-limit-129'),
        json = await download('save', 'json', 'workflow-curve-limit-129');
      assert.deepEqual(await pixels(svg), await pixels(png, 'image/png'));
      assert.equal(JSON.parse(json.toString()).layers.at(-1).nodes[0].points.length, 129);
      await load(json.toString());
      assert.equal(await snapshot(), beforeJSON);
      const nodeId = before.layers.at(-1).nodes[0].id;
      await page.locator(`[data-select-layer="${id}"]`).click();
      await page.locator(`.node[data-id="${nodeId}"] .node-head strong`).click();
      await page.locator('[data-action="actual-size"]').click();
      const handle = page.locator('.node-stage-move rect'),
        box = await handle.boundingBox(),
        scale = await page.locator('.artboard').evaluate((el) => el.getScreenCTM().a),
        start = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
      assert.equal(scale, 1);
      assert.equal(
        await page.evaluate(
          ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-node-stage-move]'),
          start,
        ),
        true,
      );
      await page.mouse.move(...start);
      await page.mouse.down();
      await page.keyboard.down('Alt');
      await page.mouse.move(start[0] + 10, start[1] + 20, { steps: 3 });
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await proveRigidPlacement(before, [10, 20]);
      await page.locator('[data-action="undo"]').click();
      assert.equal(await snapshot(), beforeJSON);
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS independent Pen: actual open/closed Bezier pointers, hidden/locked/image/output protection, one-path Undo/Redo, cold JSON/SVG/PNG exact pixels, cancellation/interruptions, rigid Curve placement/nudge after finish, visible128/129 movement boundary with larger source editing/save/export, move/creation Undo, cancellation/topology guards, explicit Curve edits, navigation and 1280/1600 draft affordances',
  );
} finally {
  await browser.close();
}
