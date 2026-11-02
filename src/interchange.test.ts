import test from 'node:test';
import assert from 'node:assert/strict';
import {createNode,emptyDocument} from './model.ts';
import {exportCSV,importCSV,exportDrawio,importDrawio} from './interchange.ts';

function fixture(){
  const doc=emptyDocument();doc.title='자료, 검증 "보드"';
  const a=createNode('round',-120,80),b=createNode('diamond',350,150);
  a.text='=매출\n입고, 확인';a.details={role:'resource',owner:'홍길동',source:'C:\\data\\입고.csv',status:'collected'};
  b.text='<월간보고> & 확인';doc.nodes=[a,b];
  doc.edges=[{id:'connection',from:a.id,to:b.id,label:'검토 "완료"',fromPort:'right',toPort:'top',style:'elbow',color:'#666666',width:2,dashed:true,arrow:'end',waypoints:[{x:260,y:50}]}];
  return doc;
}

test('CSV preserves multiline formulas as literal text, evidence, geometry and routes',()=>{
  const doc=fixture(),text=exportCSV(doc),restored=importCSV(text);
  assert.ok(text.includes("'=매출"));assert.equal(restored.document.title,doc.title);
  assert.equal(restored.document.nodes[0].text,doc.nodes[0].text);
  assert.deepEqual(restored.document.nodes[0].details,doc.nodes[0].details);
  assert.equal(restored.document.nodes[0].x,-120);
  assert.deepEqual(restored.document.edges,doc.edges);assert.deepEqual(restored.warnings,[]);
});

test('CSV rejects malformed quoting and dangling connections instead of silently losing data',()=>{
  assert.throws(()=>importCSV('record,id\nnode,"broken'),/따옴표/);
  assert.throws(()=>importCSV('record,id\nnode,"id"garbage'),/따옴표/);
  const doc=fixture();doc.edges[0].to='missing';assert.throws(()=>importCSV(exportCSV(doc)),/존재하지 않는/);
});

test('CSV includes shared image data once and rejects non-raster imported assets',()=>{
  const doc=fixture(),image=createNode('image',0,0);image.assetId='asset';doc.nodes.push(image);
  doc.assets.asset={id:'asset',name:'image.png',data:'data:image/png;base64,iVBORw0KGgo=',width:1,height:1};
  const copied={...image,id:'image-copy'};doc.nodes.push(copied);
  const result=importCSV(exportCSV(doc)).document;
  assert.equal(Object.keys(result.assets).length,1);assert.equal(result.nodes[2].assetId,result.nodes[3].assetId);
  doc.assets.asset.data='https://example.com/image.png';assert.throws(()=>importCSV(exportCSV(doc)));
});

test('draw.io roundtrip preserves supported shapes text ports styles and guide points',()=>{
  const doc=fixture(),exported=exportDrawio(doc),restored=importDrawio(exported.text).document;
  assert.ok(exported.warnings.some(s=>s.includes('업무 자료')));
  assert.deepEqual(restored.nodes.map(n=>({text:n.text,kind:n.kind,x:n.x,y:n.y,w:n.w,h:n.h})),doc.nodes.map(n=>({text:n.text,kind:n.kind,x:n.x,y:n.y,w:n.w,h:n.h})));
  assert.deepEqual(restored.edges[0].waypoints,doc.edges[0].waypoints);
  assert.equal(restored.edges[0].toPort,'top');assert.equal(restored.edges[0].dashed,true);
});

test('draw.io warns for external image placeholders and multiple pages without fetching URLs',()=>{
  const xml='<mxfile><diagram name="첫 장"><mxGraphModel><root><mxCell id="a" vertex="1" style="shape=image;image=https://example.com/a.png;"><mxGeometry x="1" y="2" width="30" height="40"/></mxCell></root></mxGraphModel></diagram><diagram><mxGraphModel><root/></mxGraphModel></diagram></mxfile>';
  const result=importDrawio(xml);assert.equal(result.document.nodes[0].kind,'rect');assert.equal(Object.keys(result.document.assets).length,0);
  assert.ok(result.warnings.some(s=>s.includes('첫 번째')));assert.ok(result.warnings.some(s=>s.includes('이미지')));
});

test('draw.io refuses external entities, malformed trees, duplicate ids and compressed documents',()=>{
  assert.throws(()=>importDrawio('<!DOCTYPE mxfile SYSTEM "file:///secrets"><mxfile/>'),/외부 선언/);
  assert.throws(()=>importDrawio('<mxfile><diagram></mxfile>'),/닫는 태그/);
  assert.throws(()=>importDrawio('<mxfile><diagram>compressed-data</diagram></mxfile>'),/비압축/);
  assert.throws(()=>importDrawio('<mxGraphModel><root><mxCell id="a"/><mxCell id="a"/></root></mxGraphModel>'),/중복/);
});

test('draw.io reads nested group child coordinates and reports format losses',()=>{
  const xml='<mxGraphModel><root><mxCell id="group" vertex="1" style="group;"><mxGeometry x="200" y="100" width="300" height="200"/></mxCell><mxCell id="child" vertex="1" parent="group" value="&lt;b&gt;자료&lt;/b&gt;&lt;br&gt;확인" style="html=1;"><mxGeometry x="30" y="40" width="100" height="60"/></mxCell></root></mxGraphModel>';
  const result=importDrawio(xml);assert.equal(result.document.nodes.length,1);assert.equal(result.document.nodes[0].x,230);assert.equal(result.document.nodes[0].y,140);assert.equal(result.document.nodes[0].text,'자료\n확인');assert.ok(result.warnings.length>=2);
});

test('draw.io flattens complete table and checklist content while reporting formatting loss',()=>{
  const doc=emptyDocument(),table=createNode('rect',0,0),checklist=createNode('rect',300,0),rich=createNode('text',600,0);
  table.text='자료 목록';table.contentMode='table';table.table={columns:['자료','담당'],rows:[['매출\n입고','홍길동'],['판매량','김담당']]};
  checklist.text='월간보고 확인';checklist.contentMode='checklist';checklist.details={checklist:[{id:'one',text:'수량 확인',done:true},{id:'two',text:'증빙 검토',done:false}]};
  rich.text='강조 링크';rich.textRuns=[{text:'강조 ',bold:true,color:'#C2410C',fontSize:24},{text:'링크',href:'https://example.com/source'}];
  doc.nodes=[table,checklist,rich];doc.edges=[{id:'edge',from:table.id,to:checklist.id,fromPort:'right',toPort:'left',label:'승인 후',style:'elbow',width:2,color:'#67768A',dashed:false,arrow:'end',labelAngle:90,labelBackground:'#FFF0E5',labelPosition:.25}];
  const result=exportDrawio(doc),restored=importDrawio(result.text).document;
  assert.equal(restored.nodes[0].text,'자료 목록\n자료 | 담당\n매출\n입고 | 홍길동\n판매량 | 김담당');
  assert.equal(restored.nodes[1].text,'월간보고 확인\n[완료] 수량 확인\n[미완료] 증빙 검토');
  assert.equal(restored.nodes[2].text,'강조 링크');
  assert.ok(result.warnings.some(s=>s.includes('셀 구조')));
  assert.ok(result.warnings.some(s=>s.includes('굵기·색상·크기·링크')));
  assert.ok(result.warnings.some(s=>s.includes('회전·배경색·수동 위치')));
  const csv=importCSV(exportCSV(doc)).document;
  assert.deepEqual(csv.nodes[0].table,table.table);assert.deepEqual(csv.nodes[1].details?.checklist,checklist.details.checklist);
  assert.deepEqual(csv.nodes[2].textRuns,rich.textRuns);assert.equal(csv.edges[0].labelAngle,90);assert.equal(csv.edges[0].labelBackground,'#FFF0E5');assert.equal(csv.edges[0].labelPosition,.25);
});
