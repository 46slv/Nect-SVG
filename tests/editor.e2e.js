import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
let errors = [];
page.on('pageerror', (e) => errors.push(e.message));
async function assertBorderSockets() {
  await page.waitForTimeout(50);
  const geometry = await page.evaluate(() => {
    const visible = (el) => el.getBoundingClientRect().width > 0;
    const sockets = [...document.querySelectorAll('.graph .socket')].filter(visible);
    const origin = document.querySelector('.wires').getBoundingClientRect();
    const center = (el) => {
      const r = el.getBoundingClientRect();
      return [r.x + r.width / 2 - origin.x, r.y + r.height / 2 - origin.y];
    };
    const wires = [...document.querySelectorAll('.wire')].map((el) => {
      const a = el.getPointAtLength(0),
        b = el.getPointAtLength(el.getTotalLength());
      return [a.x, a.y, b.x, b.y];
    });
    return {
      offsets: sockets.map((el) => {
        const r = el.getBoundingClientRect(),
          n = el.closest('.node').getBoundingClientRect();
        return r.x + r.width / 2 - (el.classList.contains('output') ? n.right : n.left);
      }),
      wired: [...document.querySelectorAll('.graph .field.connected')]
        .filter((el) => visible(el.querySelector('.input')))
        .map((field) => {
          const layer = window.nect.document.layers.find((l) =>
            l.nodes.some((n) => n.id === field.dataset.node),
          );
          const n = layer.nodes.find((n) => n.id === field.dataset.node);
          const q = n.params[field.dataset.key];
          if (!q) return true; // Nested point fields are covered by the border assertion.
          const from = document.querySelector(`.graph [data-source="${q.source}"]`);
          const expected = [...center(from), ...center(field.querySelector('.input'))];
          return wires.some((w) => w.every((v, i) => Math.abs(v - expected[i]) < 1));
        }),
    };
  });
  assert.ok(geometry.offsets.length > 0);
  assert.ok(geometry.offsets.every((offset) => Math.abs(offset) < 1));
  assert.ok(geometry.wired.every(Boolean));
}
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:5173');
  await page.waitForSelector('.shape');
  await page.waitForTimeout(500);
  await assertBorderSockets();
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/editor-initial-1600x900.png', fullPage: true });
  const vectorBoxes = await page
    .locator('.inspector-body .field[data-type="Vector2"] .field-controls > input')
    .evaluateAll((els) =>
      els.map((el) => ({
        y: el.getBoundingClientRect().y,
        width: el.getBoundingClientRect().width,
      })),
    );
  assert.equal(vectorBoxes.length, 2);
  assert.ok(Math.abs(vectorBoxes[0].y - vectorBoxes[1].y) < 1);
  assert.ok(vectorBoxes.every((b) => b.width >= 60));
  assert.equal(await page.locator('.node').count(), 6);
  // Interrupted canvas gestures neither commit history nor resume on a later pointer move.
  const beforeInterruptedDrag = await page.evaluate(() => JSON.stringify(window.nect.document));
  const canvas = await page.locator('.artboard').boundingBox();
  assert.equal(
    await page
      .locator('.artboard')
      .evaluate((el, point) => el.contains(document.elementFromPoint(point.x, point.y)), {
        x: canvas.x + 50,
        y: canvas.y + 50,
      }),
    true,
    'Interrupted gesture starts on the actual artboard',
  );
  // Captured artwork gestures need a real active browser pointer. A fabricated
  // pointerdown cannot be captured in Chrome and would test an impossible input path.
  await page.evaluate(() => {
    document.addEventListener(
      'pointerdown',
      (event) => {
        window.interruptedPointerId = event.pointerId;
      },
      { once: true },
    );
  });
  const sourceMove = await page.locator('.node-stage-move rect').boundingBox();
  const sourceStart = [sourceMove.x + sourceMove.width / 2, sourceMove.y + sourceMove.height / 2];
  await page.mouse.move(...sourceStart);
  await page.mouse.down();
  await page.mouse.move(sourceStart[0] + 30, sourceStart[1] + 20, { steps: 4 });
  assert.notEqual(
    await page.evaluate(() => JSON.stringify(window.nect.document)),
    beforeInterruptedDrag,
  );
  await page.evaluate(() => {
    const pointerId = window.interruptedPointerId;
    document.dispatchEvent(new PointerEvent('pointercancel', { pointerId, bubbles: true }));
    document.dispatchEvent(
      new PointerEvent('pointermove', { pointerId, clientX: 700, clientY: 600 }),
    );
    document.dispatchEvent(
      new PointerEvent('pointerup', { pointerId, clientX: 700, clientY: 600 }),
    );
  });
  await page.mouse.up();
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.nect.document)),
    beforeInterruptedDrag,
  );
  assert.equal(await page.getByTitle('Ctrl+Z', { exact: true }).isDisabled(), true);
  // A connected node at the graph origin retains the outer half of its input ports.
  const initialDocument = await page.evaluate(() => JSON.stringify(window.nect.document));
  await page.evaluate(() => {
    const doc = structuredClone(window.nect.document);
    doc.layers[0].nodes.find((n) => n.type === 'Boolean').position = [0, 0];
    window.nect.load(JSON.stringify(doc));
  });
  const edgeInput = page.locator('.node').filter({ hasText: 'Boolean' }).first().locator('.input');
  const edge = await edgeInput.first().boundingBox();
  const viewport = await page.locator('.graph-scroll').boundingBox();
  assert.ok(edge.x >= viewport.x && edge.y >= viewport.y);
  assert.equal(
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('.socket.input'), {
      x: edge.x + 2,
      y: edge.y + edge.height / 2,
    }),
    true,
  );
  await assertBorderSockets();
  await page.screenshot({ path: 'test-results/editor-ports-origin.png', fullPage: true });
  await page.evaluate((text) => window.nect.load(text), initialDocument);
  // Editing commits once on change and preserves Tab focus across structural redraws.
  const inspectorX = page
    .locator('.inspector-body')
    .getByLabel('Circle Position X', { exact: true });
  await inspectorX.fill('370');
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[0].nodes[0].params.center.value[0]),
    350,
  );
  await page.keyboard.press('Tab');
  await page.waitForTimeout(30);
  await page.waitForTimeout(50);
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
    'Circle Position Y',
  );
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('270');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(30);
  await page.waitForTimeout(50);
  assert.deepEqual(
    await page.evaluate(() => window.nect.document.layers[0].nodes[0].params.center.value),
    [370, 270],
  );
  await page.getByTitle('Ctrl+Z', { exact: true }).click();
  assert.deepEqual(
    await page.evaluate(() => window.nect.document.layers[0].nodes[0].params.center.value),
    [370, 250],
  );
  await page.getByTitle('Ctrl+Z', { exact: true }).click();
  assert.deepEqual(
    await page.evaluate(() => window.nect.document.layers[0].nodes[0].params.center.value),
    [350, 250],
  );
  let initial = await page.locator('.shape').getAttribute('d');
  await page
    .locator('.node')
    .filter({ has: page.locator('strong', { hasText: /^Circle$/ }) })
    .getByLabel('Circle radius', { exact: true })
    .fill('90');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(30);
  assert.notEqual(await page.locator('.shape').getAttribute('d'), initial);
  await page.getByTitle('Ctrl+Z', { exact: true }).click();
  assert.equal(await page.locator('.shape').getAttribute('d'), initial);
  await page.getByTitle('Ctrl+Shift+Z', { exact: true }).click();
  assert.notEqual(await page.locator('.shape').getAttribute('d'), initial);
  for (const action of ['Open JSON', 'Import SVG', 'New document']) {
    const beforeCancel = await page.evaluate(() => JSON.stringify(window.nect.document));
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: action, exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.stringify(window.nect.document)), beforeCancel);
  }
  await page.getByLabel('Add node', { exact: true }).selectOption('Value');
  const valId = await page.evaluate(() => window.nect.document.layers[0].nodes.at(-1).id);
  let valueNode = page.locator(`.node[data-id="${valId}"]`);
  await valueNode.getByLabel('Value value', { exact: true }).fill('45');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(30);
  const circleId = await page.evaluate(() => window.nect.document.layers[0].nodes[0].id);
  await page.locator('.graph-scroll').evaluate((el) => {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  });
  // Place the new node visibly beside the generator via a real node-header drag.
  await valueNode.scrollIntoViewIfNeeded();
  let header = await valueNode.locator('.node-head').boundingBox();
  await page.mouse.move(header.x + 40, header.y + 15);
  await page.mouse.down();
  await page.mouse.move(header.x + 60, header.y + 75, { steps: 8 });
  await page.mouse.up();
  // Dynamic socket use through DOM pointer events permits offscreen graph targets, then independently checks visible DOM.
  await page.locator(`[data-source="${valId}"]`).dispatchEvent('pointerdown', { button: 0 });
  await page.locator(`.node[data-id="${circleId}"]`).scrollIntoViewIfNeeded();
  assert.ok(await page.locator('.compatible').count());
  await assertBorderSockets();
  await page.screenshot({ path: 'test-results/editor-ports-connecting.png', fullPage: true });
  await page
    .locator(`.graph .field[data-node="${circleId}"][data-key="radius"]`)
    .dispatchEvent('pointerup', { button: 0 });
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[0].nodes[0].params.radius.source),
    valId,
  );
  assert.equal(
    await page.locator(`.graph .field[data-node="${circleId}"][data-key="radius"] .input`).count(),
    1,
  );
  await assertBorderSockets();
  const inputPort = page.locator(
    `.graph .field[data-node="${circleId}"][data-key="radius"] .input`,
  );
  const inputBox = await inputPort.boundingBox();
  assert.equal(
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('.socket.input'), {
      x: inputBox.x + 2,
      y: inputBox.y + inputBox.height / 2,
    }),
    true,
  );
  await page.screenshot({ path: 'test-results/editor-ports-connected.png', fullPage: true });
  const circleNode = page.locator(`.node[data-id="${circleId}"]`);
  const widthBefore = (await circleNode.boundingBox()).width;
  await circleNode.locator('.node-resize').scrollIntoViewIfNeeded();
  const resize = await circleNode.locator('.node-resize').boundingBox();
  assert.equal(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x + 8, y + 8)?.classList.contains('node-resize'),
      resize,
    ),
    true,
    'Resize handle must be unobstructed by neighboring cards',
  );
  await page.mouse.move(resize.x + 8, resize.y + 8);
  await page.mouse.down();
  await page.mouse.move(resize.x + 48, resize.y + 8, { steps: 4 });
  await page.mouse.up();
  assert.equal((await circleNode.boundingBox()).width, widthBefore + 40);
  await assertBorderSockets();
  await page.getByTitle('Ctrl+Z', { exact: true }).click();
  assert.equal((await circleNode.boundingBox()).width, widthBefore);
  await assertBorderSockets();
  await page
    .locator(`.graph .field[data-node="${circleId}"][data-key="radius"] .input`)
    .dispatchEvent('contextmenu');
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[0].nodes[0].params.radius.source),
    undefined,
  );
  assert.equal(
    await page.evaluate(() => window.nect.document.layers[0].nodes[0].params.radius.value),
    90,
  );
  await page.getByRole('button', { name: 'Pen / Curve', exact: true }).click();
  let box = await page.locator('.artboard').boundingBox();
  let a = [box.x + box.width * 0.3, box.y + box.height * 0.25],
    b = [box.x + box.width * 0.65, box.y + box.height * 0.3],
    c = [box.x + box.width * 0.5, box.y + box.height * 0.7];
  await page.mouse.click(...a);
  await page.mouse.move(...b);
  await page.mouse.down();
  await page.mouse.move(b[0] + 20, b[1] + 15, { steps: 5 });
  await page.mouse.up();
  await page.mouse.click(...c);
  await page.mouse.click(...a);
  let curve = await page.evaluate(() => window.nect.document.layers.at(-1).nodes[0]);
  assert.equal(curve.points.length, 3);
  assert.equal(curve.params.closed.value, true);
  assert.ok(curve.points[1].handleB.value[0] > 0);
  // Pen retains the old composition. Explicit graph editing remains available separately.
  const oldLayer = await page.evaluate(() => window.nect.document.layers[0].id);
  await page.locator(`[data-select-layer="${oldLayer}"]`).click();
  await page.getByLabel('Add node', { exact: true }).selectOption('Curve');
  curve = await page.evaluate(() => window.nect.document.layers[0].nodes.at(-1));
  // Connect the explicitly added source curve through Boolean and Remap with form controls.
  let boolId = await page.evaluate(
      () => window.nect.document.layers[0].nodes.find((n) => n.type === 'Boolean').id,
    ),
    remapId = await page.evaluate(
      () => window.nect.document.layers[0].nodes.find((n) => n.type === 'Path Remap').id,
    );
  await page.locator(`.node[data-id="${boolId}"] [data-key="a"] select`).selectOption(curve.id);
  await page.locator(`[data-preview="${remapId}"]`).click();
  assert.equal(await page.evaluate(() => window.nect.evaluate().error), null);
  // New-card placement must not overlap, including the tall explicit source Curve.
  const curveBox = await page.locator(`.node[data-id="${curve.id}"]`).boundingBox();
  const otherBoxes = await page.locator(`.node:not([data-id="${curve.id}"])`).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );
  assert.ok(
    otherBoxes.every(
      (b) =>
        curveBox.x >= b.x + b.width ||
        curveBox.x + curveBox.width <= b.x ||
        curveBox.y >= b.y + b.height ||
        curveBox.y + curveBox.height <= b.y,
    ),
  );
  await page
    .locator(`.node[data-id="${remapId}"] .node-head`)
    .click({ position: { x: 40, y: 15 } });
  const remapPoint = await page.evaluate(
    (id) => window.nect.evaluate().run(id).contours[0].points[0],
    remapId,
  );
  const vertex = await page.locator(`.vertex[data-point="${remapPoint.id}"]`).boundingBox();
  await page.mouse.move(vertex.x + vertex.width / 2, vertex.y + vertex.height / 2);
  await page.mouse.down();
  await page.mouse.move(vertex.x + vertex.width / 2 + 8, vertex.y + vertex.height / 2 + 6, {
    steps: 4,
  });
  await page.mouse.up();
  const remapKey = `remap.${remapPoint.id}.position`;
  let remapField = page.locator(`.graph .field[data-node="${remapId}"][data-key="${remapKey}"]`);
  assert.equal(await remapField.count(), 1);
  page.once('dialog', (dialog) => dialog.accept('4; 6'));
  await remapField.locator('[data-fx]').click();
  await page.getByLabel('Add node', { exact: true }).selectOption('Vector');
  const vectorId = await page.evaluate(() => window.nect.document.layers[0].nodes.at(-1).id);
  await page
    .locator(`.node[data-id="${vectorId}"]`)
    .getByLabel('Vector value X', { exact: true })
    .fill('10');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(30);
  await page
    .locator(`.node[data-id="${vectorId}"]`)
    .getByLabel('Vector value Y', { exact: true })
    .fill('20');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(30);
  await remapField.locator('[data-connect-menu]').click();
  await page.getByRole('dialog').getByLabel('Input source').selectOption(vectorId);
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  assert.equal(
    await page.evaluate(
      (id) =>
        window.nect.document.layers[0].nodes.find((n) => n.id === id).edits[0].params.position
          .source,
      remapId,
    ),
    vectorId,
  );
  await remapField.locator('.input').dispatchEvent('contextmenu');
  assert.equal(
    await page.evaluate(
      (id) =>
        window.nect.document.layers[0].nodes.find((n) => n.id === id).edits[0].params.position
          .expression,
      remapId,
    ),
    '4; 6',
  );
  const retained = await page.evaluate(
    (id) => JSON.stringify(window.nect.document.layers[0].nodes.find((n) => n.id === id).edits),
    remapId,
  );
  const rectangleId = await page.evaluate(
    () => window.nect.document.layers[0].nodes.find((n) => n.type === 'Rectangle').id,
  );
  await page
    .locator(`.node[data-id="${rectangleId}"]`)
    .getByLabel('Rectangle size X', { exact: true })
    .fill('190');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(30);
  assert.ok(
    (await page.evaluate(() => window.nect.evaluate().warnings)).some((w) =>
      w.includes('suspended'),
    ),
  );
  assert.equal(
    await page.evaluate(
      (id) => JSON.stringify(window.nect.document.layers[0].nodes.find((n) => n.id === id).edits),
      remapId,
    ),
    retained,
  );
  await page.locator(`[data-rebind-remap="${remapPoint.id}"]`).click();
  assert.equal((await page.evaluate(() => window.nect.evaluate().warnings)).length, 0);
  const batchIds = await page.evaluate(
    (id) =>
      window.nect
        .evaluate()
        .run(id)
        .contours[0].points.slice(0, 3)
        .map((p) => p.id),
    remapId,
  );
  assert.equal(batchIds.length, 3);
  const beforeBlockedBatch = await page.evaluate(() => JSON.stringify(window.nect.document));
  await page.locator(`[data-batch-point="${batchIds[0]}"]`).check();
  await page.locator(`[data-batch-point="${batchIds[1]}"]`).check();
  await page.getByLabel('Batch delta X', { exact: true }).fill('5');
  await page.getByLabel('Batch delta Y', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Move selected points', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.stringify(window.nect.document)), beforeBlockedBatch);
  assert.match(await page.locator('.status').innerText(), /locked or driven/);
  await page.getByRole('button', { name: 'Deselect points', exact: true }).click();
  for (const id of batchIds.slice(1)) await page.locator(`[data-batch-point="${id}"]`).check();
  const beforeBatch = await page.evaluate(() => JSON.stringify(window.nect.document));
  const originalBatchPoint = await page.evaluate(
    (id) => window.nect.evaluate().run(id).contours[0].points[1].position,
    remapId,
  );
  await page.getByRole('button', { name: 'Move selected points', exact: true }).click();
  assert.deepEqual(
    await page.evaluate(
      (id) => window.nect.evaluate().run(id).contours[0].points[1].position,
      remapId,
    ),
    originalBatchPoint.map((v, i) => v + [5, 7][i]),
  );
  await page.getByTitle('Ctrl+Z', { exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.stringify(window.nect.document)), beforeBatch);
  await page.getByTitle('Ctrl+Shift+Z', { exact: true }).click();
  let before = await page.evaluate(() => window.nect.export()),
    saved = await page.evaluate(() => JSON.stringify(window.nect.document));
  await page.evaluate((text) => window.nect.load(text), saved);
  assert.equal(await page.evaluate(() => window.nect.export()), before);
  // Invalid load leaves the existing project intact.
  await page.evaluate(() => {
    try {
      window.nect.load('{"schemaVersion":999}');
    } catch {}
  });
  assert.equal(await page.evaluate(() => window.nect.export()), before);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG', exact: true }).click();
  assert.equal((await dl).suggestedFilename(), 'nect-artwork.svg');
  await page.locator('.graph-scroll').evaluate((el) => {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  });
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/editor-1600x900.png', fullPage: true });
  await page
    .locator(`.node[data-id="${remapId}"] .node-head`)
    .click({ position: { x: 40, y: 15 } });
  await page.screenshot({ path: 'test-results/editor-remap-controls.png', fullPage: true });
  await page.locator(`.node[data-id="${curve.id}"] [data-add-point]`).scrollIntoViewIfNeeded();
  await assertBorderSockets();
  const lastButton = await page
      .locator(`.node[data-id="${curve.id}"] [data-add-point]`)
      .boundingBox(),
    graphViewport = await page.locator('.graph-scroll').boundingBox();
  assert.ok(
    lastButton.y >= graphViewport.y &&
      lastButton.y + lastButton.height <= graphViewport.y + graphViewport.height,
  );
  await page.screenshot({ path: 'test-results/editor-curve-scroll.png', fullPage: true });
  // Practical editable fixture, with browser file input and a source-node edit at 1920×1080.
  await page.setViewportSize({ width: 1920, height: 1080 });
  page.once('dialog', (dialog) => dialog.accept());
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open JSON', exact: true }).click();
  await (await choosing).setFiles('examples/vr-converters.json');
  await page.waitForFunction(() => window.nect.document.name.includes('V/R Converters'));
  assert.equal(await page.locator('.shape').count(), 4);
  assert.deepEqual(
    await page.locator('.graph-scroll').evaluate((el) => [el.scrollLeft, el.scrollTop]),
    [0, 0],
  );
  const firstLoadedCard = await page.locator('.node').first().boundingBox();
  const loadedViewport = await page.locator('.graph-scroll').boundingBox();
  assert.ok(firstLoadedCard.x >= loadedViewport.x && firstLoadedCard.y >= loadedViewport.y);
  const practiceBefore = await page.evaluate(() => window.nect.export());
  const vId = await page.evaluate(() => window.nect.document.layers[0].nodes[0].id);
  const pointX = page
    .locator(`.node[data-id="${vId}"]`)
    .getByLabel('V / editable outline position X', { exact: true })
    .first();
  await pointX.fill('180');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(30);
  assert.notEqual(await page.evaluate(() => window.nect.export()), practiceBefore);
  const practiceSaved = await page.evaluate(() => JSON.stringify(window.nect.document));
  const practiceSVG = await page.evaluate(() => window.nect.export());
  await page.evaluate((text) => window.nect.load(text), practiceSaved);
  assert.equal(await page.evaluate(() => window.nect.export()), practiceSVG);
  await page.screenshot({ path: 'test-results/vr-editable-1920x1080.png', fullPage: true });
  const practiceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG', exact: true }).click();
  assert.equal((await practiceDownload).suggestedFilename(), 'nect-artwork.svg');

  // Compact nodes keep their edges and persisted layout; hidden inputs reappear during wiring.
  await page.evaluate((text) => window.nect.load(text), initialDocument);
  const compactNodes = await page.evaluate(() => window.nect.document.layers[0].nodes);
  const compactSVG = await page.evaluate(() => window.nect.export());
  const compactBoolean = compactNodes.find((n) => n.type === 'Boolean');
  const compactCircle = compactNodes.find((n) => n.type === 'Circle');
  const compactRectangle = compactNodes.find((n) => n.type === 'Rectangle');
  for (const n of compactNodes) await page.locator(`[data-collapse="${n.id}"]`).click();
  assert.equal(await page.locator('.node.collapsed').count(), compactNodes.length);
  assert.equal(await page.evaluate(() => window.nect.export()), compactSVG);
  for (const n of compactNodes) {
    const actual = await page.evaluate(
      (id) => window.nect.document.layers[0].nodes.find((n) => n.id === id),
      n.id,
    );
    assert.equal(actual.width, n.width);
    assert.deepEqual(actual.position, n.position);
  }
  assert.equal(await page.locator('.node.selected').getAttribute('data-id'), compactCircle.id);
  const compactToggle = page.locator(`[data-collapse="${compactCircle.id}"]`);
  await compactToggle.focus();
  await page.keyboard.press('Enter');
  assert.equal(await compactToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await compactToggle.evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await compactToggle.getAttribute('aria-expanded'), 'false');
  const compactInput = page.locator(`.node[data-id="${compactBoolean.id}"] .input`);
  const compactBoxes = await compactInput.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { y: r.y, height: r.height };
    }),
  );
  assert.equal(compactBoxes.length, 2);
  assert.ok(compactBoxes[1].y - compactBoxes[0].y >= 24);
  assert.ok(
    (await page.locator(`.node[data-id="${compactBoolean.id}"]`).boundingBox()).height < 100,
  );
  await assertBorderSockets();
  await page.screenshot({ path: 'test-results/editor-nodes-collapsed.png', fullPage: true });
  await page.locator(`[data-source="${compactCircle.id}"]`).dispatchEvent('pointerdown');
  const compactB = page.locator(`.graph [data-node="${compactBoolean.id}"][data-key="b"]`);
  await compactB.dispatchEvent('pointerup');
  assert.equal(
    await page.evaluate(
      (id) => window.nect.document.layers[0].nodes.find((n) => n.id === id).params.b.source,
      compactBoolean.id,
    ),
    compactCircle.id,
  );
  await compactB.locator('.input').dispatchEvent('contextmenu');
  assert.equal(await compactB.locator('.available-input').isVisible(), false);
  const beforeCancelledWire = await page.evaluate(() => JSON.stringify(window.nect.document));
  await page.locator(`[data-source="${compactRectangle.id}"]`).dispatchEvent('pointerdown');
  assert.equal(await compactB.locator('.available-input').isVisible(), true);
  await assertBorderSockets();
  await page.screenshot({ path: 'test-results/editor-collapsed-wiring.png', fullPage: true });
  await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel')));
  assert.equal(await compactB.locator('.available-input').isVisible(), false);
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.nect.document)),
    beforeCancelledWire,
  );
  await page.locator(`[data-source="${compactRectangle.id}"]`).dispatchEvent('pointerdown');
  await compactB.locator('.available-input').dispatchEvent('pointerup');
  await assertBorderSockets();
  assert.equal(await page.evaluate(() => window.nect.export()), compactSVG);
  const compactSaved = await page.evaluate(() => JSON.stringify(window.nect.document));
  await page.evaluate((text) => window.nect.load(text), compactSaved);
  assert.equal(await page.locator('.node.collapsed').count(), compactNodes.length);
  await page.locator(`[data-collapse="${compactBoolean.id}"]`).click();
  await page.locator(`[data-operation="${compactBoolean.id}"]`).selectOption('union');
  await page.waitForTimeout(50);
  assert.notEqual(await page.evaluate(() => window.nect.export()), compactSVG);
  await assertBorderSockets();
  await page.screenshot({ path: 'test-results/editor-node-expanded.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: render, parameter propagation, undo/redo, dynamic socket connection/disconnection, pen handles/close, Curve → Boolean → Remap → Output, save/reload, rejected load preservation, SVG download. No page errors.',
  );
} catch (error) {
  await fs.mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/editor-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
}
