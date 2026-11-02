import test from 'node:test';
import assert from 'node:assert/strict';
import {createNode} from './model.ts';
import {renderRichContent,svgRichContent,measureRichContentHeight} from './rich-render.ts';

test('rich SVG preserves local styles and safe links while escaping content',()=>{
 const node=createNode('rect',0,0);node.text='일부 강조 & 링크';node.textRuns=[{text:'일부 '},{text:'강조',bold:true,color:'#cc3300',fontSize:22},{text:' & 링크',href:'https://example.com/?a=1&b=2'}];
 const svg=svgRichContent(node,{x:10,y:10,w:200,h:120},'Pretendard')!;
 assert.match(svg,/font-size="22" font-weight="600"/);assert.match(svg,/fill="#cc3300"/);assert.match(svg,/href="https:\/\/example.com\/\?a=1&amp;b=2"/);assert.match(svg,/&amp; 링크/);
 assert.match(svg,/clip-path=/);assert.ok(!svg.includes('<script'));
});
test('rich rendering falls back to plain text on stale run content and drops unsafe links defensively',()=>{
 const node=createNode('rect',0,0);node.text='new';node.textRuns=[{text:'old'}];assert.equal(svgRichContent(node,node,'Pretendard'),null);
 node.text='safe';node.textRuns=[{text:'safe',href:'javascript:alert(1)'}];assert.ok(!svgRichContent(node,node,'Pretendard')!.includes('<a '));
});
test('table export retains every header and cell including rows outside the node clipping box',()=>{
 const node=createNode('rect',0,0);node.text='표 제목';node.contentMode='table';node.table={columns:['자료','상태'],rows:[['판매량','확인'],['반품량','재확인']]};
 const svg=svgRichContent(node,{x:0,y:0,w:250,h:40},'Pretendard')!;
 for(const text of ['표 제목','자료','상태','판매량','확인','반품량','재확인'])assert.ok(svg.includes(text));
 assert.equal((svg.match(/stroke="#CBD2DA"/g)??[]).length,6);
});
test('checklist drawing and SVG preserve completed check marks and all item labels',()=>{
 const node=createNode('rect',0,0);node.contentMode='checklist';node.details={checklist:[{id:'one',text:'자료 수집',done:true},{id:'two',text:'내용 검토',done:false}]};
 const svg=svgRichContent(node,{x:10,y:20,w:200,h:100},'Pretendard')!;assert.match(svg,/<polyline /);assert.ok(svg.includes('자료 수집')&&svg.includes('내용 검토'));
 const texts:string[]=[];const ctx=new Proxy({measureText:(s:string)=>({width:s.length*8}),fillText:(s:string)=>texts.push(s)} as Record<string,unknown>,{get:(t,k)=>t[String(k)]??(()=>{}),set:(t,k,v)=>{t[String(k)]=v;return true;}}) as unknown as CanvasRenderingContext2D;
 assert.equal(renderRichContent(ctx,node,{x:10,y:20,w:200,h:100},'Pretendard'),true);assert.deepEqual(texts,[node.text,'자료 수집','내용 검토']);
});

test('automatic rich height accounts for wrapped table rows and checklist items',()=>{
 const node=createNode('rect',0,0);node.contentMode='table';node.table={columns:['자료','상태'],rows:[['긴 설명을 여러 줄로 정리합니다','확인']]};
 const narrow=measureRichContentHeight(node,100,'Pretendard')!,wide=measureRichContentHeight(node,600,'Pretendard')!;
 assert.ok(narrow>wide&&wide>50);
 node.contentMode='checklist';node.details={checklist:[{id:'one',text:'자료 수집',done:true},{id:'two',text:'내용 검토',done:false}]};
 assert.ok(measureRichContentHeight(node,200,'Pretendard')!>40);
 node.contentMode='text';assert.equal(measureRichContentHeight(node,200,'Pretendard'),null);
});
