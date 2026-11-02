import test from 'node:test';
import assert from 'node:assert/strict';
import {createNode,emptyDocument,cloneDocument,validateDocument,duplicateSelection,alignNodes,autoLayout} from './model.ts';
import {edgePoints,routeHandles,prepareRoutes} from './geometry.ts';
import {clearSegment} from './routing.ts';
function fixture(){const doc=emptyDocument(),a=createNode('rect',0,100),b=createNode('rect',700,100),block=createNode('text',330,30);block.w=180;block.h=250;doc.nodes=[a,b,block];doc.edges=[{id:'e',from:a.id,to:b.id,fromPort:'right',toPort:'left',style:'elbow',label:'',color:'#111111',width:2,arrow:'end',dashed:false}];return {doc,block,edge:doc.edges[0]};}
test('orthogonal routes avoid text and shape interiors and update after an obstacle moves',()=>{const {doc,block,edge}=fixture();for(const y of [30,-130,220]){block.y=y;const ps=edgePoints(edge,doc);assert.ok(ps.length>1);for(let i=1;i<ps.length;i++){assert.ok(ps[i].x===ps[i-1].x||ps[i].y===ps[i-1].y);assert.ok(clearSegment(ps[i-1],ps[i],[block]));}}});
test('manual waypoints survive save, undo snapshots and duplicated groups without aliasing',()=>{const {doc,edge}=fixture();edge.waypoints=[{x:300,y:-100}];const ps=edgePoints(edge,doc);assert.ok(ps.some(p=>p.x===300&&p.y===-100));const restored=validateDocument(JSON.parse(JSON.stringify(doc)));assert.deepEqual(restored.edges[0].waypoints,edge.waypoints);const history=cloneDocument(doc);edge.waypoints[0].x=280;assert.equal(history.edges[0].waypoints![0].x,300);duplicateSelection(doc,[edge.from,edge.to]);assert.deepEqual(doc.edges[1].waypoints,[{x:304,y:-76}]);});
test('overlapping endpoints do not produce a line through a blocking shape',()=>{const {doc,block,edge}=fixture();block.x=210;block.y=100;assert.deepEqual(edgePoints(edge,doc),[]);});

test('cached routes invalidate when a new obstacle enters a previously clear segment',()=>{
  const {doc,block,edge}=fixture();block.y=600;
  const index=new Map(doc.nodes.map(n=>[n.id,n]));prepareRoutes(doc,index);
  const previous=edgePoints(edge,doc,index);assert.ok(previous.length);
  block.y=30;prepareRoutes(doc,index);const current=edgePoints(edge,doc,index);
  assert.notDeepEqual(current,previous);
  assert.ok(current.slice(1).every((p,i)=>clearSegment(current[i],p,[block])));
  doc.nodes=doc.nodes.filter(n=>n.id!==block.id);
  assert.ok(edgePoints(edge,doc).length);
});

test('corner and segment handles insert guides in path order and retain editable guide handles',()=>{
  const {doc,edge}=fixture();edge.waypoints=[{x:300,y:-100}];
  const handles=routeHandles(edge,edgePoints(edge,doc));
  assert.ok(handles.some(h=>!h.insert&&h.waypoint===0));
  assert.ok(handles.some(h=>h.insert&&h.waypoint===0));
  assert.ok(handles.some(h=>h.insert&&h.waypoint===1));
  edge.waypoints=Array.from({length:32},()=>({x:300,y:-100}));
  assert.ok(routeHandles(edge,edgePoints(edge,doc)).every(h=>!h.insert));
});

test('group alignment translates internal guides and automatic layout resets external guides',()=>{
  const {doc,edge,block}=fixture();doc.nodes[0].groupId=doc.nodes[1].groupId='group';
  edge.waypoints=[{x:300,y:-100}];block.y=-200;
  alignNodes(doc,doc.nodes.map(n=>n.id),'top');assert.deepEqual(edge.waypoints,[{x:300,y:-400}]);
  delete doc.nodes[0].groupId;delete doc.nodes[1].groupId;
  autoLayout(doc);assert.equal(edge.waypoints,undefined);
});

test('invalid or unbounded guide lists cannot enter a saved document',()=>{
  const {doc,edge}=fixture();edge.waypoints=[{x:Infinity,y:0}];assert.throws(()=>validateDocument(doc));
  edge.waypoints=Array.from({length:33},()=>({x:0,y:0}));assert.throws(()=>validateDocument(doc));
});
