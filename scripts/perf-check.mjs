import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-features=AutofillAiWalletPrivatePasses'] });
try {
  const page = await browser.newPage({locale:'ko-KR',viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.goto('http://localhost:18440', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer.ts');
    const { createNode, emptyDocument } = await import('/src/model.ts');
    const { bounds } = await import('/src/geometry.ts');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:white';
    document.body.append(canvas);
    let state, renderCalls = 0, invalidations = 0, queued = false;
    const paint = () => { renderCalls++; renderer.render(state); };
    const renderer = new Renderer(canvas, () => {
      invalidations++;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; if (state) paint(); });
    });
    renderer.resize(1280, 800);
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const summary = values => {
      const sorted = values.toSorted((a, b) => a - b);
      const pick = p => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 100) / 100;
      return { count: sorted.length, medianMs: pick(.5), p95Ms: pick(.95), maxMs: pick(1), samplesMs: values.map(n => Math.round(n * 100) / 100) };
    };
    const fixtures = [];
    for (const count of [1000, 2000]) {
      const doc = emptyDocument();
      doc.title = `Synthetic ${count}`;
      const columns = 40;
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / columns), col = i % columns;
        const node = createNode(i % 10 === 0 ? 'diamond' : 'round', col * 180, row * 105);
        node.id = `node${i}`; node.w = 130; node.h = 64; node.fontSize = 12; node.text = `자료 확인 ${i + 1}\n월간보고 준비`;
        node.fill = ['#ffffff', '#eef5ed', '#f9efd7'][i % 3];
        doc.nodes.push(node);
        if (i) doc.edges.push({ id: `edge${i}`, from: `node${i - 1}`, to: node.id, fromPort: 'right', toPort: 'left', label: '', color: '#879a8c', width: 1.5, style: i % 3 ? 'elbow' : 'curve', dashed: false, arrow: 'end' });
      }
      const b = bounds(doc.nodes);
      for (const mode of ['ordinary', 'overview']) {
        const zoom = mode === 'ordinary' ? 1 : Math.min(1220 / b.w, 740 / b.h);
        doc.viewport = { x: 30, y: 30, zoom };
        state = { doc, selection: new Set(), edgeSelection: null, grid: true };
        for (let i = 0; i < 5; i++) { paint(); await nextFrame(); }
        const times = [];
        for (let i = 0; i < 30; i++) {
          const started = performance.now(); paint(); times.push(performance.now() - started);
          await nextFrame();
        }
        fixtures.push({ nodes: count, edges: count - 1, mode, zoom: Math.round(zoom * 10000) / 10000, ...summary(times) });
      }
    }
    const beforeIdle = renderCalls;
    await delay(700);
    const idle = { durationMs: 700, renderCallsBefore: beforeIdle, renderCallsAfter: renderCalls, extraRenders: renderCalls - beforeIdle };
    const source = document.createElement('canvas'); source.width = 4096; source.height = 3072;
    const sourceCtx = source.getContext('2d');
    const gradient = sourceCtx.createLinearGradient(0, 0, 4096, 3072);
    gradient.addColorStop(0, '#cfe3d8'); gradient.addColorStop(1, '#f8e6b7');
    sourceCtx.fillStyle = gradient; sourceCtx.fillRect(0, 0, 4096, 3072);
    sourceCtx.fillStyle = '#28665a'; sourceCtx.font = '160px sans-serif'; sourceCtx.fillText('AgentSketch synthetic image', 180, 1500);
    const data = source.toDataURL('image/png'); source.width = source.height = 1;
    const imageDoc = emptyDocument();
    imageDoc.assets.shared = { id: 'shared', data, name: 'synthetic.png', width: 4096, height: 3072 };
    for (let i = 0; i < 100; i++) {
      const node = createNode('image', (i % 10) * 120, Math.floor(i / 10) * 72);
      node.assetId = 'shared'; node.w = 112; node.h = 64; imageDoc.nodes.push(node);
    }
    imageDoc.viewport = { x: 20, y: 20, zoom: 1 };
    let decodeCalls = 0;
    const originalDecode = globalThis.createImageBitmap;
    globalThis.createImageBitmap = (...args) => { decodeCalls++; return originalDecode(...args); };
    state = { doc: imageDoc, selection: new Set(), edgeSelection: null, grid: false };
    paint();
    const deadline = performance.now() + 15000;
    while ([...renderer.images.values()].some(image => image.loading) && performance.now() < deadline) await delay(25);
    await nextFrame();
    const initialDecodes = decodeCalls;
    for (let i = 0; i < 30; i++) { paint(); await nextFrame(); }
    const imageResult = {
      sourceSize: [4096, 3072], sourcePngBytes: Math.round(data.length * .75), nodesSharingAsset: 100,
      initialDecodeCalls: initialDecodes, decodeCallsAfter30Renders: decodeCalls,
      cacheEntries: renderer.images.size,
      decodedPixels: renderer.imagePixels,
      approximateBitmapBytes: renderer.imagePixels * 4,
      pendingDecodes: renderer.decodes,
      failed: [...renderer.images.values()].some(image => image.failed),
    };
    const imageIdleBefore = renderCalls;
    await delay(700);
    imageResult.idleExtraRenders = renderCalls - imageIdleBefore;
    state = { doc: emptyDocument(), selection: new Set(), edgeSelection: null, grid: false }; paint();
    imageResult.cacheEntriesAfterLeavingDocument = renderer.images.size;
    imageResult.decodedPixelsAfterLeavingDocument = renderer.imagePixels;
    globalThis.createImageBitmap = originalDecode;
    renderer.dispose(); canvas.remove();
    return { userAgent: navigator.userAgent, viewport: [1280, 800], dpr: devicePixelRatio, fixtures, idle, image: imageResult, invalidations };
  });
  let baseline;
  if (process.argv.includes('--compare')) {
    const previous = JSON.parse(await readFile(resolve('output/performance.json'), 'utf8'));
    baseline = previous.baseline ?? { recordedAt: previous.recordedAt, method: previous.method, fixtures: previous.fixtures, idle: previous.idle, image: previous.image };
  }
  const report = {
    recordedAt: new Date().toISOString(),
    environment: 'Windows, headless Microsoft Edge, development modules served by Vite localhost:18440',
    method: 'Synthetic fixtures; 5 warmups + 30 samples per case. Each sample times Renderer.render CPU command submission with a requestAnimationFrame yield after the sample. This is not GPU completion time, interaction latency, FPS, or a production-memory benchmark.',
    ...result,
    ...(baseline ? { baseline, optimization: 'Per-paint endpoint Map replaces repeated full-node searches. Canvas overview omits body text rendered below 5 CSS pixels; PNG/SVG keep all text.' } : {}),
  };
  await mkdir(resolve('output'), { recursive: true });
  await writeFile(resolve('output/performance.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ fixtures: report.fixtures.map(({ samplesMs, ...entry }) => entry), idle: report.idle, image: report.image }, null, 2));
} finally {
  await browser.close();
}
