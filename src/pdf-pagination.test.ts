import test from 'node:test';
import assert from 'node:assert/strict';
import { countPages, MAX_PDF_PAGES, planPages } from './pdf-pagination.ts';

test('fit preserves the complete diagram inside the printable rectangle', () => {
  const box = {x:-350,y:80,w:2400,h:900}, pages = planPages(box);
  assert.equal(pages.length,1);
  const p=pages[0];assert.deepEqual(p.size,[842,595]);assert.deepEqual(p.origin,{x:-350,y:80});
  assert.ok(box.w*p.scale<=p.clip.w+1e-8);assert.ok(box.h*p.scale<=p.clip.h+1e-8);
  assert.equal(p.clip.x,p.margin);assert.equal(p.clip.y,p.margin);
  assert.ok(Math.abs(p.clip.h+p.margin*2+p.header-p.size[1])<1e-8);
});

test('tile pages cover the full world area without gaps and preserve physical scale', () => {
  const box={x:-100,y:-250,w:2200,h:1500},pages=planPages(box,{printMode:'tile',printScalePercent:100,marginMm:12});
  assert.ok(pages.length>1);const first=pages[0];assert.equal(first.scale,.75);
  assert.equal(pages.length,first.rows*first.columns);
  assert.ok(first.columns*first.clip.w/first.scale>=box.w);
  assert.ok(first.rows*first.clip.h/first.scale>=box.h);
  for(const p of pages){
    assert.equal(p.origin.x,box.x+p.column*p.clip.w/p.scale);
    assert.equal(p.origin.y,box.y+p.row*p.clip.h/p.scale);
  }
  assert.equal(pages[1].row,0);assert.equal(pages[1].column,1);
  assert.equal(pages[first.columns].row,1);assert.equal(pages[first.columns].column,0);
});

test('exact tile boundaries do not create an extra blank page', () => {
  const p=planPages({x:0,y:0,w:100,h:100},{printMode:'tile'})[0];
  const exact={x:0,y:0,w:p.clip.w/p.scale*3,h:p.clip.h/p.scale*2};
  assert.equal(countPages(exact,{printMode:'tile'}),6);
});

test('margin and print scale clamp finite UI inputs to supported limits', () => {
  const b={x:0,y:0,w:100,h:100};
  const low=planPages(b,{printMode:'tile',marginMm:-100,printScalePercent:1})[0];
  const high=planPages(b,{printMode:'tile',marginMm:1000,printScalePercent:1000,paper:'a3',landscape:false})[0];
  assert.ok(Math.abs(low.margin-5*72/25.4)<1e-8);assert.equal(low.scale,.1875);
  assert.ok(Math.abs(high.margin-40*72/25.4)<1e-8);assert.equal(high.scale,1.5);
  assert.deepEqual(high.size,[842,1191]);
});

test('invalid geometry/options and excessive page plans fail before allocating pages', () => {
  const b={x:0,y:0,w:100,h:100};
  for(const bad of [{...b,w:0},{...b,h:-2},{...b,x:Infinity},{...b,y:NaN}])assert.throws(()=>planPages(bad));
  assert.throws(()=>planPages(b,{marginMm:NaN}));assert.throws(()=>planPages(b,{printScalePercent:Infinity}));
  assert.throws(()=>planPages(b,{paper:'a2' as 'a4'}));assert.throws(()=>planPages(b,{printMode:'unknown' as 'fit'}));
  assert.throws(()=>planPages({...b,w:1e10,h:1e10},{printMode:'tile'}),new RegExp(String(MAX_PDF_PAGES)));
  assert.equal(countPages({...b,w:1e10,h:1e10},{printMode:'fit'}),1);
});
