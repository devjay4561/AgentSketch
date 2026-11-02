import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer, renderSVG } from './renderer.ts';
import { createNode, emptyDocument, validateDocument } from './model.ts';

test('SVG escapes user text and document titles', () => {
  const doc = emptyDocument();
  doc.title = '<script>alert("x")</script>';
  const node = createNode('rect', 0, 0);
  node.text = '<text>& "한글"';
  doc.nodes.push(node);
  const svg = renderSVG(doc);
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(svg.includes('&lt;text&gt;&amp;'));
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('한글'));
});

test('SVG omits external and SVG image sources', () => {
  const doc = emptyDocument();
  const node = createNode('image', 0, 0); node.assetId = 'asset';
  doc.nodes.push(node);
  for (const data of ['https://example.com/image.png', 'data:image/svg+xml;base64,PHN2Zy8+']) {
    doc.assets.asset = { id: 'asset', data, name: 'image', width: 100, height: 100 };
    const svg = renderSVG(doc);
    assert.ok(!svg.includes('<image'));
    assert.ok(!svg.includes(data));
  }
});

test('SVG preserves raster image embedding and handles an empty document', () => {
  const doc = emptyDocument();
  assert.match(renderSVG(doc), /viewBox="-40 -40 80 80"/);
  const node = createNode('image', 0, 0); node.assetId = 'asset'; doc.nodes.push(node);
  doc.assets.asset = { id: 'asset', data: 'data:image/png;base64,aGVsbG8=', name: 'test', width: 100, height: 100 };
  assert.ok(renderSVG(doc).includes('xlink:href="data:image/png;base64,aGVsbG8="'));
});

test('SVG paints frames before connectors and other nodes', () => {
  const doc = emptyDocument();
  const a = createNode('rect', 20, 60), b = createNode('rect', 400, 60), frame = createNode('frame', 0, 0);
  frame.text = 'FRAME'; doc.nodes.push(a, b, frame);
  doc.edges.push({ id: 'edge', from: a.id, to: b.id, fromPort: 'right', toPort: 'left', label: 'EDGE', color: '#333333', width: 2, style: 'straight', dashed: false, arrow: 'end' });
  const svg = renderSVG(doc);
  assert.ok(svg.indexOf('FRAME') < svg.indexOf('EDGE'));
  assert.ok(svg.indexOf('FRAME') < svg.indexOf('<polyline'));
});

test('SVG uses Pretendard first while preserving colors from saved documents', () => {
  const doc = emptyDocument();
  const a = createNode('rect', 20, 60), b = createNode('rect', 400, 60);
  a.fill = '#355d4d'; a.stroke = '#8ca591'; a.color = '#ffffff';
  doc.nodes.push(a, b);
  doc.edges.push({ id: 'edge', from: a.id, to: b.id, fromPort: 'right', toPort: 'left', label: '기존 연결', color: '#73907a', width: 2, style: 'straight', dashed: false, arrow: 'end' });
  const restored = validateDocument(JSON.parse(JSON.stringify(doc)));
  assert.equal(restored.nodes[0].fill, '#355d4d');
  assert.equal(restored.nodes[0].stroke, '#8ca591');
  assert.equal(restored.edges[0].color, '#73907a');
  const svg = renderSVG(restored);
  assert.ok(svg.includes('font-family="&quot;Pretendard Variable&quot;, Pretendard,'));
  assert.ok(svg.includes('fill="#355d4d"'));
  assert.ok(svg.includes('stroke="#73907a"'));
});

test('a short text heading keeps its first line inside the canvas clip and matches SVG placement', () => {
  const doc = emptyDocument();
  doc.viewport = { x: 0, y: 0, zoom: 1 };
  const heading = createNode('text', 0, 20);
  heading.text = '원천 자료 확인'; heading.w = 260; heading.h = 34; heading.fontSize = 16;
  doc.nodes.push(heading);
  const geometryBefore = { x: heading.x, y: heading.y, w: heading.w, h: heading.h };
  let pathRect: { x: number; y: number; w: number; h: number } | undefined;
  let clipRect: typeof pathRect;
  const lines: Array<{ text: string; y: number; clip: NonNullable<typeof pathRect> }> = [];
  const context = new Proxy({
    rect(x: number, y: number, w: number, h: number) { pathRect = { x, y, w, h }; },
    clip() { clipRect = pathRect; },
    measureText(text: string) { return { width: [...text].length * 16 }; },
    fillText(text: string, _x: number, y: number) { if (clipRect) lines.push({ text, y, clip: clipRect }); },
  } as Record<string, unknown>, {
    get(target, key) { return target[String(key)] ?? (() => {}); },
    set(target, key, value) { target[String(key)] = value; return true; },
  });
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const renderer = new Renderer(canvas, () => {});
  renderer.render({ doc, selection: new Set(), edgeSelection: null, grid: false });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, heading.text);
  // The actual clipping rectangle must contain the full nominal glyph height.
  assert.ok(lines[0].y - heading.fontSize / 2 >= lines[0].clip.y);
  assert.ok(lines[0].y + heading.fontSize / 2 <= lines[0].clip.y + lines[0].clip.h);
  const svgY = Number(renderSVG(doc).match(/<tspan x="[^"]+" y="([^"]+)"/)?.[1]);
  assert.equal(svgY, lines[0].y);
  assert.deepEqual({ x: heading.x, y: heading.y, w: heading.w, h: heading.h }, geometryBefore);
});
