import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import JSZip from 'jszip';

const baseline = process.argv.includes('--baseline');
const output = `output/playwright/image-quality-${baseline ? 'before' : 'after'}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-features=AutofillAiWalletPrivatePasses'] });
try {
  const page = await browser.newPage({ locale: 'ko-KR', viewport: { width: 2160, height: 1320 }, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(process.env.AGENTSKETCH_TEST_URL ?? 'http://127.0.0.1:18442');
  await page.locator('#board').focus();
  await page.keyboard.press('Control+n');
  await page.getByText('빈 보드를 만들었습니다.', { exact: false }).waitFor();
  const original = await page.evaluate(async () => {
    const rendererUrl = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/renderer.ts').name;
    const { Renderer } = await import(rendererUrl);
    const render = Renderer.prototype.render;
    Renderer.prototype.render = function (state) {
      window.imageQuality = { doc: state.doc };
      render.call(this, state);
    };
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
      if (this.canvas.id === 'board') window.imageQuality.decodedWidth = image.width;
      return draw.call(this, image, ...args);
    };
    const source = document.createElement('canvas');
    source.width = 1920;
    source.height = 1080;
    const ctx = source.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, source.width, source.height);
    ctx.fillStyle = '#000';
    for (let x = 0; x < source.width; x += 8) ctx.fillRect(x, 0, 1, source.height);
    for (let y = 0; y < source.height; y += 8) ctx.fillRect(0, y, source.width, 1);
    ctx.font = '11px monospace';
    for (let y = 14; y < source.height; y += 40) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, y - 12, source.width, 13);
      ctx.fillStyle = '#000';
      ctx.fillText('AgentSketch image check 0123456789  '.repeat(20), 2, y);
    }
    const blob = await new Promise(resolve => source.toBlob(resolve, 'image/png'));
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([blob], 'quality-grid.png', { type: blob.type }));
    document.querySelector('#board').dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
    return source.toDataURL('image/png');
  });
  await writeFile(`${output}/source.png`, Buffer.from(original.split(',')[1], 'base64'));
  await page.waitForFunction(() => window.imageQuality?.decodedWidth > 0).catch(async error => {
    throw new Error(`Image did not render: ${await page.locator('#toast').textContent()} ${errors.join(', ')}`, { cause: error });
  });

  const readImage = () => page.evaluate(() => {
    const { doc, decodedWidth } = window.imageQuality;
    const node = doc.nodes[0];
    const { x, y, zoom } = doc.viewport;
    const board = document.querySelector('#board').getBoundingClientRect();
    return {
      x: board.x + x + node.x * zoom, y: board.y + y + node.y * zoom,
      width: node.w * zoom, height: node.h * zoom, zoom, decodedWidth,
      pixelRatio: devicePixelRatio, data: doc.assets[node.assetId].data, node,
    };
  });
  function measureGrid(base64) {
    return page.evaluate(async base64 => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      // Measure the same central region at both zoom levels, away from selection handles.
      const { data } = ctx.getImageData(canvas.width / 2 - 75, canvas.height / 2 - 60, 150, 120);
      const intensity = Array.from({ length: data.length / 4 }, (_, i) => data[i * 4]).sort((a, b) => a - b);
      return { screenshotSize: [canvas.width, canvas.height], contrast: intensity[Math.floor(intensity.length * .95)] - intensity[Math.floor(intensity.length * .05)] };
    }, base64);
  }
  async function capture(zoom, full) {
    const info = await readImage();
    const width = full ? Math.floor(info.width) : 120;
    const height = full ? Math.floor(info.height) : 100;
    const center = { x: info.x + info.width / 2, y: info.y + info.height / 2 };
    const clip = { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2), width, height };
    const png = await page.screenshot({ clip, path: `${output}/zoom-${zoom}.png` });
    return { center, zoom: info.zoom, physicalWidth: Math.round(info.width * info.pixelRatio), decodedWidth: info.decodedWidth, ...await measureGrid(png.toString('base64')) };
  }

  const source = await measureGrid(original.split(',')[1]);
  const at100 = await capture(100, true);
  const originalBytesPreserved = (await readImage()).data === original;
  const { x, y } = at100.center;
  await page.locator('#board').evaluate((board, point) => {
    for (const deltaY of [-120, -120, -120, -120, -120, -(Math.log(3) / .0018 - 600)]) {
      board.dispatchEvent(new WheelEvent('wheel', { clientX: point.x, clientY: point.y, deltaY, bubbles: true, cancelable: true }));
    }
  }, { x, y });
  await page.waitForFunction(() => window.imageQuality?.decodedWidth === 1920 && Math.abs(window.imageQuality.doc.viewport.zoom - 3) < 1e-6);
  const at300 = await capture(300, false);
  assert.equal(at100.zoom, 1);
  const checks = [];
  if (!baseline) {
    assert.ok(originalBytesPreserved);
    assert.equal(at100.physicalWidth, 1920);
    assert.equal(at100.decodedWidth, 1920);
    assert.deepEqual(at100.screenshotSize, source.screenshotSize);
    assert.ok(at100.contrast >= source.contrast * .85, '1px grid retains contrast at 100%');
    assert.ok(at300.contrast >= source.contrast * .6, '1px grid retains contrast at 300%');

    await page.getByRole('button', { name: '업무 도구', exact: true }).click();
    await page.locator('[data-panel=canvas]').click();
    const cropWidth = page.getByLabel('이미지 자르기 w');
    await cropWidth.fill('50');
    await cropWidth.press('Tab');
    await page.waitForFunction(() => window.imageQuality.doc.nodes[0].crop?.w === .5);
    const before = (await readImage()).node;
    await page.getByRole('button', { name: '원본 크기로', exact: true }).click();
    await page.waitForFunction(() => window.imageQuality.doc.nodes[0].w === 640);
    const resized = (await readImage()).node;
    assert.equal(resized.h, 720);
    assert.equal(resized.x + resized.w / 2, before.x + before.w / 2);
    assert.equal(resized.y + resized.h / 2, before.y + before.h / 2);
    assert.deepEqual(resized.crop, before.crop);
    await page.getByRole('button', { name: '업무 도구 닫기' }).click();
    await page.locator('#board').focus();
    await page.keyboard.press('Control+z');
    await page.waitForFunction(width => window.imageQuality.doc.nodes[0].w === width, before.w);
    assert.deepEqual((await readImage()).node, before);
    checks.push('Cropped original size keeps the center and supports undo.');

    const formats = await page.evaluate(async () => {
      const { importImages } = await import('/src/persistence.ts');
      const { emptyDocument, validateDocument } = await import('/src/model.ts');
      const { createPowerPoint } = await import('/src/export-binary.ts');
      const { Renderer } = await import('/src/renderer.ts');
      const { setGraphicsProfile } = await import('/src/graphics.ts');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#184824';
      ctx.fillRect(0, 0, 64, 64);
      const sources = ['png', 'jpeg', 'webp'].map(kind => canvas.toDataURL(`image/${kind}`));
      sources.push('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
      const files = await Promise.all(sources.map(async (data, index) => new File([await (await fetch(data)).blob()], `image-${index}`)));
      const imported = await importImages(files, { x: 0, y: 0 });
      const roundTrip = validateDocument(JSON.parse(JSON.stringify({ ...emptyDocument(), ...imported })));
      const preserved = roundTrip.nodes.map((node, index) => {
        const data = roundTrip.assets[node.assetId].data;
        const mime = ['png', 'jpeg', 'webp', 'gif'][index];
        return data === sources[index] && data.startsWith(`data:image/${mime};base64,`);
      });

      canvas.width = 4200;
      canvas.height = 64;
      ctx.fillStyle = '#184824';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const oversized = await new Promise(resolve => canvas.toBlob(resolve));
      const converted = await importImages([new File([oversized], 'over-limit.png')], { x: 0, y: 0 });
      const asset = Object.values(converted.assets)[0];
      const node = converted.nodes[0];
      node.crop = { x: .1, y: 0, w: .9, h: 1 };
      const cropped = await createPowerPoint({ ...emptyDocument(), ...converted });

      delete node.crop;
      node.w = 1000;
      node.h = node.w * asset.height / asset.width;
      const doc = { ...emptyDocument(), ...converted, viewport: { x: 10, y: 10, zoom: .5 } };
      const state = { doc, selection: new Set(), edgeSelection: null, grid: false };
      const preview = document.createElement('canvas');
      let invalidate;
      const renderer = new Renderer(preview, () => invalidate?.());
      const nextDecode = () => new Promise(resolve => { invalidate = resolve; });
      const decode = window.createImageBitmap;
      setGraphicsProfile(false);
      try {
        renderer.resize(350, 150);
        const initial = nextDecode();
        renderer.render(state);
        await initial;
        const first = renderer.images.get(asset.id).bitmap;
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        window.createImageBitmap = async (...args) => { await gate; return decode(...args); };
        const upgraded = nextDecode();
        doc.viewport.zoom = 1.5;
        renderer.render(state);
        const keptBitmap = renderer.images.get(asset.id).bitmap === first;
        const pixel = [...preview.getContext('2d').getImageData(100, 20, 1, 1).data];
        release();
        await upgraded;
        const upgradedWidth = renderer.images.get(asset.id).bitmap.width;
        return { preserved, width: asset.width, mime: asset.data.split(';')[0], pptx: cropped.base64, keptBitmap, pixel, upgradedWidth };
      } finally {
        window.createImageBitmap = decode;
        setGraphicsProfile(true);
        renderer.dispose();
      }
    });
    assert.deepEqual(formats.preserved, [true, true, true, true]);
    assert.equal(formats.width, 3840);
    assert.equal(formats.mime, 'data:image/png');
    const zip = await JSZip.loadAsync(formats.pptx, { base64: true });
    const png = await zip.file(/^ppt\/media\/.*\.png$/i)[0].async('nodebuffer');
    assert.equal(png.readUInt32BE(16), 3456, 'cropped PPTX retains image widths above 2400px');
    assert.ok(formats.keptBitmap, 'a pending upgrade retains the old bitmap');
    assert.deepEqual(formats.pixel, [24, 72, 36, 255], 'the old bitmap is still drawn');
    assert.equal(formats.upgradedWidth, 2048, 'the low profile caps the upgraded bitmap');
    checks.push('PNG, JPEG, WebP and GIF retain their bytes after validation and serialization. Oversized PNG and cropped PPTX retain the expected resolution.');
    checks.push('A delayed decode draws the old bitmap until the low-profile replacement is ready.');
  }
  assert.deepEqual(errors, []);
  const result = { originalBytesPreserved, source, at100, at300, checks };
  await writeFile(`${output}/metrics.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
