import test from 'node:test';
import assert from 'node:assert/strict';
import { createNode, emptyDocument, validateDocument } from './model.ts';
import { cardTextRuns } from './rich-render.ts';
import { nearestTheme, tidyBoard, SHAPE_THEMES } from './shape-themes.ts';
import { renderSVG } from './renderer.ts';
import { runCommandInPlace } from './commands.ts';

function card(text: string) {
  const node = createNode('round', 0, 0);
  Object.assign(node, { text, fill: '#EAF2FF', color: '#1E4783', textStyle: 'card' as const });
  return node;
}

test('card text: bold title, quieter details, quietest notes, and the exact text survives', () => {
  const runs = cardTextRuns(card('③ 입고\n구입 보고\n※ 담당 확인 필요'))!;
  assert.equal(runs.map(r => r.text).join(''), '③ 입고\n구입 보고\n※ 담당 확인 필요');
  assert.equal(runs[0].bold, true); assert.equal(runs[0].color, '#1E4783');
  assert.equal(runs[1].bold, false); assert.notEqual(runs[1].color, '#1E4783');
  const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
  assert.ok(lum(runs[2].color!) > lum(runs[1].color!), 'notes are lighter than details');
  assert.equal(cardTextRuns(card('한 줄')), undefined, 'single line stays plain');
  const plain = card('a\nb'); delete plain.textStyle;
  assert.equal(cardTextRuns(plain), undefined);
});

test('card text is part of the file format and reaches SVG export', () => {
  const doc = emptyDocument(); doc.nodes.push(card('제목\n세부'));
  const read = validateDocument(JSON.parse(JSON.stringify(doc)));
  assert.equal(read.nodes[0].textStyle, 'card');
  assert.match(renderSVG(read), /font-weight="600"[^>]*>제목/);
  assert.throws(() => validateDocument({ ...JSON.parse(JSON.stringify(doc)), nodes: [{ ...doc.nodes[0], textStyle: 'fancy' }] }));
});

test('tidy board maps colours to the nearest preset, keeps meaning, and is idempotent', () => {
  assert.equal(nearestTheme({ fill: '#FFFFFF', stroke: '#2F6FED' }).name, 'Blue');
  assert.equal(nearestTheme({ fill: '#FFF7ED', stroke: '#EA8A2E' }).name, 'Amber');
  assert.equal(nearestTheme({ fill: '#F4F5F7', stroke: '#B8BEC8' }).name, 'Slate');
  assert.equal(nearestTheme({ fill: '#FFF1E6', stroke: '#E0603A' }).name, 'Rose', 'red-orange accent stays distinct from orange');
  const doc = emptyDocument();
  const blue = createNode('round', 0, 0); Object.assign(blue, { text: '단계\n세부', fill: '#F3F7FF', stroke: '#2F6FED', strokeWidth: 2 });
  const out = createNode('rect', 300, 0); Object.assign(out, { text: '범위 밖', fill: '#F4F5F7', stroke: '#B8BEC8', dashed: true });
  const note = createNode('note', 600, 0); const noteBefore = { ...note };
  doc.nodes.push(blue, out, note);
  doc.edges.push({ id: 'e', from: blue.id, to: out.id, fromPort: 'right', toPort: 'left', label: '', color: '#7B8798', width: 2.5, style: 'elbow', dashed: false, arrow: 'end' });
  const ids = new Set(doc.nodes.map(n => n.id));
  assert.ok(tidyBoard(doc, ids) > 0);
  const blueTheme = SHAPE_THEMES.find(t => t.name === 'Blue')!;
  assert.equal(blue.stroke, blueTheme.soft.stroke); assert.equal(blue.strokeWidth, 1); assert.equal(blue.textStyle, 'card');
  assert.equal(out.dashed, true); assert.equal(out.textStyle, undefined);
  assert.deepEqual(note, noteBefore);
  assert.equal(doc.edges[0].width, 1.5);
  assert.equal(tidyBoard(doc, ids), 0);
  validateDocument(JSON.parse(JSON.stringify(doc)));
});

test('board.tidy is available to agents', () => {
  const doc = emptyDocument(); const n = createNode('rect', 0, 0); Object.assign(n, { stroke: '#2F6FED', text: 'a\nb' }); doc.nodes.push(n);
  const result = runCommandInPlace(doc, { command: 'board.tidy' }) as { changed: number };
  assert.equal(result.changed, 1); assert.equal(doc.nodes[0].textStyle, 'card');
});
