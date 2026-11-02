import test from 'node:test';
import assert from 'node:assert/strict';
import {createNode,emptyDocument,validateDocument} from './model.ts';
import {availableRouteSegments,fixRouteSegment,fixedRouteSegments,releaseRouteSegment} from './route-segments.ts';
import {edgePoints,distanceToSegment} from './geometry.ts';
import {clearSegment} from './routing.ts';
function fixture(){const doc=emptyDocument(),a=createNode('rect',0,100),b=createNode('rect',700,100);doc.nodes=[a,b];doc.edges=[{id:'e',from:a.id,to:b.id,fromPort:'right',toPort:'left',label:'',width:2,color:'#334455',style:'elbow',arrow:'end',dashed:false}];return {doc,edge:doc.edges[0]};}
test('segment end fixing adds two valid guides, survives save and can be released',()=>{
 const {doc,edge}=fixture(),segment=availableRouteSegments(doc,edge)[0];assert.ok(segment);fixRouteSegment(doc,edge,segment.index);assert.equal(edge.waypoints?.length,2);assert.equal(fixedRouteSegments(edge).length,1);assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))).edges[0].waypoints,edge.waypoints);releaseRouteSegment(edge,0);assert.equal(edge.waypoints,undefined);
});
test('fixed ends stay in place while a new obstacle between them is routed around safely',()=>{
 const {doc,edge}=fixture();fixRouteSegment(doc,edge,availableRouteSegments(doc,edge)[0].index);const before=edge.waypoints!.map(p=>({...p})),obstacle=createNode('rect',350,80);obstacle.w=100;obstacle.h=160;doc.nodes.push(obstacle);
 const path=edgePoints(edge,doc);assert.ok(path.length>2);assert.deepEqual(edge.waypoints,before);assert.ok(before.every(p=>path.some((q,i)=>i>0&&distanceToSegment(p,path[i-1],q)<.001)));assert.ok(path.slice(1).every((p,i)=>clearSegment(path[i],p,[obstacle])));
});
test('fixing is idempotent and invalid segment requests do not mutate a route',()=>{
 const {doc,edge}=fixture();fixRouteSegment(doc,edge,availableRouteSegments(doc,edge)[0].index);const before=JSON.stringify(edge);fixRouteSegment(doc,edge,availableRouteSegments(doc,edge)[0].index);assert.equal(JSON.stringify(edge),before);assert.throws(()=>fixRouteSegment(doc,edge,999));assert.equal(JSON.stringify(edge),before);
});
