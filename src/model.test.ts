import test from 'node:test';
import assert from 'node:assert/strict';
import { alignNodes, autoLayout, cloneDocument, createNode, distributeNodes, duplicateSelection, emptyDocument, groupNodes, History, removeSelection, ungroupNodes, validateDocument } from './model.ts';
import { bounds, contains, distanceToSegment, edgePoints, intersects, portPoint } from './geometry.ts';
import { createSample } from './sample.ts';
import type { FlowDocument, FlowEdge, FlowNode } from './types.ts';

function connect(from: FlowNode, to: FlowNode, id = `${from.id}_${to.id}`): FlowEdge {
  return { id, from: from.id, to: to.id, fromPort: 'right', toPort: 'left', label: '', color: '#718278', width: 2, style: 'elbow', dashed: false, arrow: 'end' };
}
function fixture(): FlowDocument {
  const doc = emptyDocument();
  doc.nodes = [createNode('rect', 10, 20), createNode('diamond', 400, 200), createNode('rect', 800, 20)];
  doc.edges = [connect(doc.nodes[0], doc.nodes[1]), connect(doc.nodes[1], doc.nodes[2])];
  return doc;
}

test('all templates serialize, validate, and preserve their editable content', () => {
  for (const template of ['blank', 'simple', 'launch'] as const) {
    const doc = createSample(template);
    const read = validateDocument(JSON.parse(JSON.stringify(doc)));
    assert.equal(read.title, doc.title);
    assert.deepEqual(read.nodes.map(n => n.text), doc.nodes.map(n => n.text));
    assert.deepEqual(read.edges, doc.edges);
  }
  assert.ok(createSample('launch').nodes.some(n => n.text.includes('설명용 예시')));
});

test('a document with nonfinite geometry or unknown versions cannot be imported', () => {
  const doc = fixture();
  doc.nodes[0].x = Infinity;
  assert.throws(() => validateDocument(doc), /가로 위치/);
  doc.nodes[0].x = 10;
  assert.throws(() => validateDocument({ ...doc, version: 2 }), /지원하는/);
  doc.nodes[0].w = 0;
  assert.throws(() => validateDocument(doc), /너비/);
});

test('dangling and duplicate identifiers are rejected instead of producing broken edges', () => {
  const doc = fixture();
  doc.edges[0].to = 'missing';
  assert.throws(() => validateDocument(doc), /존재하지 않는/);
  doc.edges = [];
  doc.nodes[1].id = doc.nodes[0].id;
  assert.throws(() => validateDocument(doc), /중복된/);
});

test('import only accepts raster data and strips unrecognized fields', () => {
  const doc = fixture();
  const image = createNode('image', 0, 0); image.assetId = 'img'; doc.nodes.push(image);
  doc.assets.img = { id: 'img', data: 'https://evil.example/image.png', name: 'image', width: 10, height: 10 };
  assert.throws(() => validateDocument(doc), /이미지 데이터만/);
  doc.assets.img.data = 'data:image/svg+xml;base64,PHN2Zz4=';
  assert.throws(() => validateDocument(doc), /이미지 데이터만/);
  doc.assets.img.data = 'data:image/png;base64,iVBORw0KGgo=';
  const imported = validateDocument({ ...doc, onload: 'alert(1)' });
  assert.equal('onload' in imported, false);
  assert.equal(imported.assets.img.data, doc.assets.img.data);
  delete doc.assets.img;
  assert.throws(() => validateDocument(doc), /이미지가 문서에 없습니다/);
});

test('CSS, markup identifiers and prototype pollution keys cannot enter document style records', () => {
  const doc = fixture();
  doc.nodes[0].fill = 'url(https://example.test)';
  assert.throws(() => validateDocument(doc), /색상 형식/);
  doc.nodes[0].fill = '#ffffff';
  doc.nodes[0].id = '__proto__';
  assert.throws(() => validateDocument(doc), /식별자/);
  doc.nodes[0].id = 'normal';
  const polluted = JSON.parse('{"__proto__":{"id":"__proto__","data":"data:image/png;base64,AA==","width":1,"height":1}}');
  assert.throws(() => validateDocument({ ...doc, assets: polluted }), /식별자/);
});

test('history captures independent node/point state, retains image strings, and clears redo after a new edit', () => {
  let doc = fixture();
  doc.nodes[0].points = [{ x: 0, y: 1 }];
  doc.assets.pic = { id: 'pic', data: 'data:image/png;base64,AA==', name: 'picture', width: 1, height: 1 };
  const history = new History(2);
  history.push(doc);
  doc.nodes[0].x = 300; doc.nodes[0].points[0].y = 99;
  const original = history.undo(doc)!;
  assert.equal(original.nodes[0].x, 10);
  assert.equal(original.nodes[0].points![0].y, 1);
  assert.equal(original.assets.pic.data, doc.assets.pic.data);
  assert.equal(history.canRedo, true);
  doc = history.redo(original)!;
  assert.equal(doc.nodes[0].x, 300);
  assert.equal(doc.nodes[0].points![0].y, 99);
  history.undo(doc);
  history.push(original);
  assert.equal(history.canRedo, false);
});

test('bounded history evicts oldest snapshots and has predictable empty operations', () => {
  let doc = fixture(); const history = new History(2);
  assert.equal(history.undo(doc), null);
  for (let i = 0; i < 3; i++) { history.push(doc); doc.nodes[0].x += 10; }
  doc = history.undo(doc)!; assert.equal(doc.nodes[0].x, 30);
  doc = history.undo(doc)!; assert.equal(doc.nodes[0].x, 20);
  assert.equal(history.undo(doc), null);
  history.clear(); assert.equal(history.canUndo, false); assert.equal(history.canRedo, false);
});

test('duplicate remaps internal connections and groups while preserving external relationships', () => {
  const doc = fixture();
  groupNodes(doc, doc.nodes.slice(0, 2).map(n => n.id));
  const originalGroup = doc.nodes[0].groupId;
  const ids = duplicateSelection(doc, doc.nodes.slice(0, 2).map(n => n.id));
  assert.equal(doc.nodes.length, 5);
  assert.equal(doc.edges.length, 3);
  const copies = doc.nodes.filter(n => ids.includes(n.id));
  assert.equal(copies[0].x, 34);
  assert.notEqual(copies[0].groupId, originalGroup);
  assert.equal(copies[0].groupId, copies[1].groupId);
  assert.equal(doc.edges[2].from, copies[0].id);
  assert.equal(doc.edges[2].to, copies[1].id);
  assert.equal(doc.edges.some(e => e.from === copies[1].id && e.to === doc.nodes[2].id), false);
});

test('delete keeps locked elements, removes incident edges, and drops unreferenced image data', () => {
  const doc = fixture(); doc.nodes[0].locked = true;
  doc.assets.unused = { id: 'unused', data: 'data:image/png;base64,AA==', name: 'x', width: 1, height: 1 };
  removeSelection(doc, [doc.nodes[0].id, doc.nodes[1].id]);
  assert.equal(doc.nodes.length, 2);
  assert.equal(doc.nodes[0].locked, true);
  assert.equal(doc.edges.length, 0);
  assert.equal(Object.keys(doc.assets).length, 0);
});

test('alignment respects variable sizes and ignores locked nodes', () => {
  const doc = fixture(); doc.nodes[2].locked = true;
  alignNodes(doc, doc.nodes.map(n => n.id), 'right');
  assert.equal(doc.nodes[0].x + doc.nodes[0].w, doc.nodes[1].x + doc.nodes[1].w);
  assert.equal(doc.nodes[2].x, 800);
  alignNodes(doc, doc.nodes.map(n => n.id), 'centerY');
  assert.equal(doc.nodes[0].y + doc.nodes[0].h / 2, doc.nodes[1].y + doc.nodes[1].h / 2);
});

test('distribution equalizes edge-to-edge gaps with mixed widths and fixed endpoints', () => {
  const doc = fixture(); const beforeLast = doc.nodes[2].x;
  distributeNodes(doc, doc.nodes.map(n => n.id), 'horizontal');
  const [a, b, c] = doc.nodes;
  assert.equal(b.x - (a.x + a.w), c.x - (b.x + b.w));
  assert.equal(a.x, 10); assert.equal(c.x, beforeLast);
});

test('group operations create and remove shared identity without changing geometry', () => {
  const doc = fixture(), ids = doc.nodes.slice(0, 2).map(n => n.id), copy = cloneDocument(doc);
  const group = groupNodes(doc, ids); assert.ok(group);
  assert.equal(doc.nodes[0].groupId, doc.nodes[1].groupId);
  ungroupNodes(doc, [doc.nodes[0].id]);
  assert.equal(doc.nodes[1].groupId, undefined);
  assert.deepEqual(doc.nodes.map(n => [n.x, n.y]), copy.nodes.map(n => [n.x, n.y]));
});

test('aligning a partially selected image-caption group moves the whole group and preserves offsets', () => {
  const doc = emptyDocument();
  const image = { ...createNode('image', 20, 30), w: 220, h: 150, groupId: 'captioned' };
  const caption = { ...createNode('text', 40, 60), w: 140, h: 35, groupId: 'captioned' };
  const target = createNode('rect', 500, 350);
  doc.nodes = [image, caption, target];
  alignNodes(doc, [caption.id, target.id], 'right');
  assert.equal(image.x + image.w, target.x + target.w);
  assert.equal(caption.x - image.x, 20);
  assert.equal(caption.y - image.y, 30);
  assert.equal(image.w, 220); assert.equal(caption.w, 140);
  const before = doc.nodes.map(n => [n.x, n.y]);
  alignNodes(doc, [image.id, caption.id], 'left');
  assert.deepEqual(doc.nodes.map(n => [n.x, n.y]), before, 'one group alone has no alignment peers');
});

test('distribution treats a group as one box and keeps its caption attached', () => {
  const doc = fixture();
  const middle = doc.nodes[1]; middle.groupId = 'middle';
  const caption = { ...createNode('text', middle.x + 30, middle.y + 20), w: 60, h: 30, groupId: 'middle' };
  doc.nodes.push(caption);
  distributeNodes(doc, [doc.nodes[0].id, caption.id, doc.nodes[2].id], 'horizontal');
  const [a, b, c] = doc.nodes;
  assert.equal(b.x - (a.x + a.w), c.x - (b.x + b.w));
  assert.equal(caption.x - b.x, 30); assert.equal(caption.y - b.y, 20);
});

test('a locked group member freezes the entire group for alignment, distribution, and automatic layout', () => {
  const doc = fixture();
  const image = { ...createNode('image', 1_100, 900), w: 200, h: 130, groupId: 'frozen', locked: true };
  const caption = { ...createNode('text', 1_125, 920), w: 140, h: 40, groupId: 'frozen' };
  doc.nodes.push(image, caption);
  doc.edges.push(connect(caption, doc.nodes[0], 'locked-connection'));
  const ids = doc.nodes.map(n => n.id), frozen = [image, caption].map(n => ({ ...n }));
  alignNodes(doc, ids, 'left');
  distributeNodes(doc, ids, 'vertical');
  autoLayout(doc, ids, 'vertical');
  assert.deepEqual([image, caption], frozen);
  assert.equal(doc.edges.at(-1)!.fromPort, 'right', 'connection to an excluded group keeps its routing ports');
});

test('automatic layout projects group connections into a cyclic graph without breaking internal composition', () => {
  const doc = emptyDocument();
  const image = { ...createNode('image', 700, 200), w: 220, h: 150, groupId: 'composite' };
  const caption = { ...createNode('text', 720, 260), w: 140, h: 40, groupId: 'composite' };
  const middle = createNode('rect', 50, 50), end = createNode('rect', 80, 800);
  const frame = createNode('frame', -200, -200), heading = createNode('text', -100, -100);
  const internal = { ...connect(image, caption, 'internal'), fromPort: 'bottom' as const, toPort: 'top' as const };
  doc.nodes = [frame, heading, image, caption, middle, end];
  doc.edges = [internal, connect(caption, middle), connect(middle, image), connect(middle, end)];
  autoLayout(doc);
  assert.equal(image.x, middle.x, 'cycle units share one graph rank');
  assert.ok(end.x > middle.x);
  assert.equal(caption.x - image.x, 20); assert.equal(caption.y - image.y, 60);
  assert.equal(internal.fromPort, 'bottom'); assert.equal(internal.toPort, 'top');
  assert.equal(frame.x, -200); assert.equal(frame.y, -200);
  assert.equal(heading.x, -100); assert.equal(heading.y, -100);
  assert.equal(doc.nodes.length, 6); assert.equal(doc.edges.length, 4);
});

test('auto layout preserves cycles and branches and changes only selected unlocked elements', () => {
  const doc = fixture();
  doc.edges.push(connect(doc.nodes[1], doc.nodes[0], 'cycle'));
  const originalIds = doc.nodes.map(n => n.id);
  const unrelated = createNode('note', 999, 888); doc.nodes.push(unrelated);
  autoLayout(doc, originalIds);
  assert.equal(doc.nodes[0].x, doc.nodes[1].x);
  assert.ok(doc.nodes[2].x > doc.nodes[1].x);
  assert.equal(doc.nodes.length, 4); assert.equal(doc.edges.length, 3);
  assert.deepEqual({ x: unrelated.x, y: unrelated.y }, { x: 999, y: 888 });
  assert.deepEqual(doc.nodes.slice(0, 3).map(n => n.id), originalIds);
  autoLayout(doc, originalIds, 'vertical');
  assert.ok(doc.nodes[2].y > doc.nodes[0].y);
  assert.equal(doc.edges[0].fromPort, 'bottom');
});

test('auto layout handles a long chain without recursive stack overflow', () => {
  const doc = emptyDocument();
  for (let i = 0; i < 4_000; i++) doc.nodes.push({ ...createNode('rect', 0, 0), w: 10, h: 10 });
  for (let i = 1; i < doc.nodes.length; i++) doc.edges.push(connect(doc.nodes[i - 1], doc.nodes[i]));
  autoLayout(doc);
  assert.ok(doc.nodes[3999].x > doc.nodes[3998].x);
  assert.equal(doc.nodes.length, 4_000);
});

test('geometry respects real diamond and ellipse boundaries, not just bounding boxes', () => {
  const diamond = { ...createNode('diamond', 10, 10), w: 100, h: 100 };
  assert.equal(contains({ x: 11, y: 11 }, diamond), false);
  assert.equal(contains({ x: 60, y: 60 }, diamond), true);
  assert.equal(contains({ x: 11, y: 11 }, { ...diamond, kind: 'ellipse' }), false);
  assert.equal(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 10, w: 5, h: 5 }), true);
  assert.deepEqual(bounds([]), { x: 0, y: 0, w: 0, h: 0 });
  assert.deepEqual(portPoint(diamond, 'right'), { x: 110, y: 60 });
  assert.equal(distanceToSegment({ x: 20, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 }), Math.sqrt(200));
});

test('connection routing follows moved nodes and all elbow segments are orthogonal', () => {
  const doc = fixture(), edge = doc.edges[0];
  let points = edgePoints(edge, doc);
  const index = new Map(doc.nodes.map(n => [n.id, n]));
  assert.deepEqual(edgePoints(edge, doc, index), points);
  for (let i = 1; i < points.length; i++) assert.ok(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y);
  doc.nodes[1].y += 70;
  points = edgePoints(edge, doc);
  assert.deepEqual(edgePoints(edge, doc, index), points);
  assert.deepEqual(points.at(-1), portPoint(doc.nodes[1], 'left'));
  edge.style = 'curve';
  points = edgePoints(edge, doc); assert.equal(points.length, 25);
  assert.deepEqual(points[0], portPoint(doc.nodes[0], 'right'));
  assert.deepEqual(points.at(-1), portPoint(doc.nodes[1], 'left'));
  edge.to = 'missing'; assert.deepEqual(edgePoints(edge, doc), []);
});

test('a pre-rename FlowPaper document opens and is saved back in the AgentSketch format', () => {
  const legacy = { ...JSON.parse(JSON.stringify(fixture())), format: 'flowpaper' };
  const read = validateDocument(legacy);
  assert.equal(read.format, 'agentsketch');
  assert.equal(read.nodes.length, 3);
});
