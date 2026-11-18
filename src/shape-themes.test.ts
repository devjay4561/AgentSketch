import test from 'node:test';
import assert from 'node:assert/strict';
import { boardShapeColors, SHAPE_THEMES, SHAPE_TONES } from './shape-themes.ts';
import { createNode, emptyDocument } from './model.ts';
import { editableNodeIds } from './organization.ts';

function rgb(hex: string): number[] {
  return [1, 3, 5].map(i => parseInt(hex.slice(i,i+2),16) / 255);
}

function luminance(rgb: number[]): number {
  const [r,g,b] = rgb.map(channel => channel <= .04045 ? channel/12.92 : ((channel+.055)/1.055)**2.4);
  return .2126*r + .7152*g + .0722*b;
}

test('all 12 shape presets meet AA through the Canvas and SVG lighting range', () => {
  assert.equal(SHAPE_THEMES.length * SHAPE_TONES.length, 12);
  for (const theme of SHAPE_THEMES) for (const tone of SHAPE_TONES) {
    const {fill,color} = theme[tone], ink = luminance(rgb(color));
    const backgrounds = [rgb(fill),rgb(fill).map(c=>c*.93+.07),rgb(fill).map((c,i)=>c*.975+rgb('#101828')[i]*.025)];
    for (const background of backgrounds) {
      const surface = luminance(background);
      const ratio = (Math.max(surface,ink)+.05)/(Math.min(surface,ink)+.05);
      assert.ok(ratio >= 4.5, `${theme.name} ${tone}: ${ratio.toFixed(2)}:1`);
    }
  }
});

test('board themes preserve a recognized tone and use the selected tone for custom colors', () => {
  const [slate,blue,teal] = SHAPE_THEMES;
  const node = createNode('rect',0,0);
  assert.equal(node.fill,slate.soft.fill);
  assert.equal(node.strokeWidth,1);
  assert.deepEqual(boardShapeColors(node,teal,'solid'),teal.soft);
  node.fill = blue.solid.fill.toLowerCase();
  assert.deepEqual(boardShapeColors(node,teal,'soft'),teal.solid);
  node.fill = '#ABCDEF';
  assert.deepEqual(boardShapeColors(node,teal,'solid'),teal.solid);
});

test('board-wide colors can reach other pages while honoring locks and hidden layers', () => {
  const doc = emptyDocument();
  doc.workspace = {activePageId:'page-main',pages:[{id:'page-main',name:'First'},{id:'other',name:'Second'}],layers:[{id:'hidden',name:'Hidden',hidden:true}]};
  const open = createNode('round',0,0), locked = createNode('round',250,0), hidden = createNode('round',500,0);
  open.details = {pageId:'other'};
  locked.details = {pageId:'other'};
  locked.locked = true;
  hidden.details = {pageId:'other',layerId:'hidden'};
  doc.nodes = [open,locked,hidden];
  assert.deepEqual([...editableNodeIds(doc)],[]);
  assert.deepEqual([...editableNodeIds(doc,true)],[open.id]);
});
