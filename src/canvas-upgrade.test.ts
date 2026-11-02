import test from 'node:test';
import assert from 'node:assert/strict';
import {createNode,emptyDocument,validateDocument} from './model.ts';
import {connectionPoint,edgePoints,intersects,prepareRoutes} from './geometry.ts';
import {layoutEdgeLabels,pointAlong} from './edge-labels.ts';
import {Renderer,renderSVG} from './renderer.ts';
import type {FlowEdge} from './types.ts';
const connector=(from:string,to:string,id='edge'):FlowEdge=>({id,from,to,fromPort:'right',toPort:'left',label:'확인 완료',color:'#334455',width:2,style:'elbow',dashed:false,arrow:'end'});
test('custom connection anchors preserve side and normalized position after resizing',()=>{
 const n=createNode('rect',10,20);n.w=200;n.h=100;
 assert.deepEqual(connectionPoint(n,'right',{x:.2,y:.3}),{x:210,y:50});
 const doc=emptyDocument(),b=createNode('rect',500,20);doc.nodes=[n,b];const edge=connector(n.id,b.id);edge.fromAnchor={x:1,y:.3};doc.edges=[edge];
 assert.deepEqual(edgePoints(edge,doc)[0],{x:210,y:50});n.h=200;assert.deepEqual(edgePoints(edge,doc)[0],{x:210,y:80});
});
test('ellipse and decision anchors sit on the visible shape and still route orthogonally',()=>{
 for(const kind of ['ellipse','diamond'] as const){
  const doc=emptyDocument(),a=createNode(kind,0,0),b=createNode('rect',600,0);a.w=200;a.h=100;doc.nodes=[a,b];const edge=connector(a.id,b.id);edge.fromAnchor={x:1,y:.2};doc.edges=[edge];
  const point=connectionPoint(a,'right',edge.fromAnchor);assert.ok(point.x<200&&point.x>100);assert.equal(point.y,20);
  const path=edgePoints(edge,doc);assert.ok(path.length);assert.deepEqual(path[0],point);assert.ok(path.slice(1).every((p,i)=>p.x===path[i].x||p.y===path[i].y));
 }
});
test('safe automatic lanes separate duplicate connections while manual guides stay authoritative',()=>{
 const doc=emptyDocument(),a=createNode('rect',0,0),b=createNode('rect',600,0);doc.nodes=[a,b];doc.edges=[connector(a.id,b.id,'one'),connector(a.id,b.id,'two')];
 const index=new Map(doc.nodes.map(n=>[n.id,n]));prepareRoutes(doc,index);
 const one=edgePoints(doc.edges[0],doc,index),two=edgePoints(doc.edges[1],doc,index);
 assert.ok(one.length&&two.length);assert.notDeepEqual(one,two);
 for(const path of [one,two])assert.ok(path.slice(1).every((p,i)=>p.x===path[i].x||p.y===path[i].y));
 doc.edges[0].waypoints=[{x:300,y:-100}];prepareRoutes(doc,index);assert.ok(edgePoints(doc.edges[0],doc,index).some(p=>p.x===300&&p.y===-100));
});
test('labels move off occupied shapes and other captions without dropping text',()=>{
 const doc=emptyDocument(),a=createNode('rect',0,0),b=createNode('rect',600,0),block=createNode('rect',260,0);doc.nodes=[a,b,block];
 doc.edges=[connector(a.id,b.id,'one'),connector(a.id,b.id,'two')];doc.edges[1].label='두 번째 설명';
 const paths=new Map(doc.edges.map(e=>[e.id,[{x:220,y:50},{x:600,y:50}]]));const labels=layoutEdgeLabels(doc,paths);
 assert.equal(labels.size,2);for(const label of labels.values())assert.ok(!doc.nodes.some(n=>intersects(n,label.box)));
 assert.ok(!intersects(labels.get('one')!.box,labels.get('two')!.box));
 assert.equal(labels.get('one')!.lines.join(''),doc.edges[0].label);
 assert.deepEqual(pointAlong([{x:0,y:0},{x:100,y:0},{x:100,y:100}],.75),{x:100,y:50});
});
test('SVG preserves cropped rotated image source and emits crossing casing',()=>{
 const doc=emptyDocument(),a=createNode('image',0,0),b=createNode('rect',600,0);a.assetId='img';a.crop={x:.25,y:.1,w:.5,h:.6};a.rotation=90;doc.nodes=[a,b];doc.edges=[connector(a.id,b.id)];
 doc.assets.img={id:'img',name:'crop.png',data:'data:image/png;base64,aGVsbG8=',width:100,height:200};
 const svg=renderSVG(validateDocument(JSON.parse(JSON.stringify(doc))));
 assert.match(svg,/viewBox="25 20 50 120"/);assert.match(svg,/rotate\(90 /);assert.match(svg,/stroke="white" stroke-width="6"/);assert.match(svg,/xlink:href="data:image\/png;base64,aGVsbG8="/);
});
test('vertical label uses rotated collision bounds and preserves selected background in SVG',()=>{
 const doc=emptyDocument(),a=createNode('rect',0,0),b=createNode('rect',600,0),block=createNode('text',300,-20);block.w=120;block.h=140;doc.nodes=[a,b,block];
 const edge=connector(a.id,b.id);edge.label='긴 연결선 설명';edge.labelAngle=90;edge.labelBackground='#fff1e6';doc.edges=[edge];
 const restored=validateDocument(JSON.parse(JSON.stringify(doc))),paths=new Map([[edge.id,edgePoints(restored.edges[0],restored)]]),label=layoutEdgeLabels(restored,paths).get(edge.id)!;
 assert.equal(label.angle,90);assert.equal(label.box.w,label.textHeight);assert.equal(label.box.h,label.textWidth);assert.ok(!doc.nodes.some(n=>intersects(n,label.box)));
 const svg=renderSVG(restored);assert.match(svg,/rotate\(90\)/);assert.match(svg,/fill="#fff1e6"/);
 const bad=JSON.parse(JSON.stringify(doc));bad.edges[0].labelAngle=45;assert.throws(()=>validateDocument(bad));
});
test('Canvas applies the selected label angle and background during actual edge painting',()=>{
 const doc=emptyDocument(),a=createNode('rect',-400,0),b=createNode('rect',400,0);doc.viewport={x:0,y:0,zoom:1};doc.nodes=[a,b];
 const edge=connector(a.id,b.id);edge.labelAngle=-90;edge.labelBackground='#fff1e6';doc.edges=[edge];
 const rotations:number[]=[],fills:string[]=[];const target:Record<string,unknown>={measureText:(text:string)=>({width:text.length*12}),rotate:(r:number)=>rotations.push(r)};
 target.fill=()=>fills.push(String(target.fillStyle));const ctx=new Proxy(target,{get:(t,k)=>t[String(k)]??(()=>{}),set:(t,k,v)=>{t[String(k)]=v;return true;}});
 const renderer=new Renderer({getContext:()=>ctx} as unknown as HTMLCanvasElement,()=>{});renderer.render({doc,selection:new Set(),edgeSelection:edge.id,grid:false});
 assert.ok(rotations.some(r=>Math.abs(r+Math.PI/2)<.0001));assert.ok(fills.includes('#fff1e6'));renderer.dispose();
});
