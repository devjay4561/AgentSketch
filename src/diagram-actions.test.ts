import test from 'node:test';
import assert from 'node:assert/strict';
import {createNode,emptyDocument,validateDocument} from './model.ts';
import {addNextStep,splitConnection} from './diagram-actions.ts';

test('quick next step retains appearance and location context without evidence approval',()=>{
 const doc=emptyDocument(),source=createNode('rect',0,0);source.fill='#ffaa00';source.groupId='group';source.details={role:'resource',status:'verified',source:'C:\\private.xlsx',owner:'운영팀',checkedBy:'검토자'};doc.nodes=[source];
 const id=addNextStep(doc,source.id),next=doc.nodes.find(n=>n.id===id)!;
 assert.equal(next.fill,source.fill);assert.equal(next.details?.owner,'운영팀');assert.equal(next.details?.role,'step');assert.equal(next.details?.status,undefined);assert.equal(next.details?.source,undefined);assert.equal(next.groupId,undefined);assert.equal(doc.edges[0].from,source.id);assert.equal(doc.edges[0].to,id);validateDocument(doc);
});
test('splitting preserves relationship identity and first label while clearing manual guides',()=>{
 const doc=emptyDocument(),source=createNode('rect',0,0);doc.nodes=[source];const targetId=addNextStep(doc,source.id),edge=doc.edges[0];edge.label='확인 후 진행';edge.waypoints=[{x:250,y:-100}];edge.relation='alternative';const id=splitConnection(doc,edge.id);
 assert.equal(doc.nodes.length,3);assert.equal(doc.edges.length,2);assert.equal(doc.edges[0].id,edge.id);assert.equal(doc.edges[0].to,id);assert.equal(doc.edges[1].from,id);assert.equal(doc.edges[1].to,targetId);assert.equal(doc.edges[0].label,'확인 후 진행');assert.equal(doc.edges[1].label,'');assert.equal(doc.edges[1].relation,'alternative');assert.ok(doc.edges.every(e=>!e.waypoints));validateDocument(doc);
});
test('existing node insertion does not duplicate nodes and rejects endpoints or locked nodes atomically',()=>{
 const doc=emptyDocument(),a=createNode('rect',0,0);doc.nodes=[a];const b=addNextStep(doc,a.id),middle=createNode('rect',240,200);doc.nodes.push(middle);const edge=doc.edges[0];
 assert.throws(()=>splitConnection(doc,edge.id,b));assert.equal(doc.edges.length,1);middle.locked=true;assert.throws(()=>splitConnection(doc,edge.id,middle.id));assert.equal(doc.edges.length,1);middle.locked=false;assert.equal(splitConnection(doc,edge.id,middle.id),middle.id);assert.equal(doc.nodes.length,3);
});

test('quick actions honor default layer and whole-group locks',()=>{
 const doc=emptyDocument(),a=createNode('rect',0,0),b=createNode('rect',400,0);doc.nodes=[a,b];a.groupId=b.groupId='group';b.locked=true;
 assert.throws(()=>addNextStep(doc,a.id));assert.equal(doc.nodes.length,2);b.locked=false;doc.workspace={layers:[{id:'layer-main',name:'기본',locked:true}]};
 assert.throws(()=>addNextStep(doc,a.id));assert.equal(doc.nodes.length,2);
});
