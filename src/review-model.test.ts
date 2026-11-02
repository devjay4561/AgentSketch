import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneDocument,createNode,emptyDocument} from './model.ts';
import {applyComparedDocument,compareDocuments,presentationStops} from './review-model.ts';
import type {FlowDocument} from './types.ts';

function fixture(){const doc=emptyDocument();const a=createNode('rect',0,0),b=createNode('rect',300,0);a.id='a';a.text='자료';b.id='b';b.text='보고';doc.nodes=[a,b];doc.edges=[{id:'ab',from:'a',to:'b',fromPort:'right',toPort:'left',label:'입력',color:'#444444',width:2,style:'elbow',dashed:false,arrow:'end'}];return doc;}

test('document comparison ignores viewport and object key order, and detects substantive edits',()=>{
  const doc=fixture(),next=cloneDocument(doc);next.viewport={x:900,y:80,zoom:.4};
  next.nodes[0].details={status:'verified',owner:'담당자'};doc.nodes[0].details={owner:'담당자',status:'verified'};
  assert.equal(compareDocuments(doc,next).same,true);
  next.nodes[0].details.owner='새 담당자';next.edges[0].label='확인';next.title='새 제목';
  const changes=compareDocuments(doc,next);assert.deepEqual(changes.counts,{added:0,removed:0,changed:3});
  assert.deepEqual(changes.changes[0].fields,['details']);
});

test('comparison tracks added/removed content, image leaves and stacking order',()=>{
  const doc=fixture(),next=cloneDocument(doc);doc.assets.image={id:'image',data:'data:image/png;base64,AAAA',name:'증빙',width:1,height:1};
  next.assets.image={...doc.assets.image,data:'data:image/png;base64,BBBB'};
  next.nodes.reverse();const third=createNode('text',0,200);third.id='c';next.nodes.push(third);next.edges=[];
  const comparison=compareDocuments(doc,next);
  assert.ok(comparison.changes.some(c=>c.kind==='asset'&&c.fields.includes('data')));
  assert.ok(comparison.changes.some(c=>c.id==='node-order'));
  assert.deepEqual(comparison.counts,{added:1,removed:1,changed:2});
});

test('comparison application rejects stale previews without modifying target',()=>{
  const target=fixture(),baseline=cloneDocument(target),incoming=cloneDocument(target);incoming.nodes[0].text='새 자료';
  target.nodes[1].text='작업 중';const current=cloneDocument(target);
  assert.equal(applyComparedDocument(target,incoming,baseline),false);assert.deepEqual(target,current);
});

test('comparison application preserves current view and deep copies metadata while removing absent workspace',()=>{
  const target=fixture();target.workspace={comments:[{id:'review',author:'검토자',text:'확인',createdAt:'2026-10-30'}]};
  const baseline=cloneDocument(target),incoming=fixture();incoming.nodes[0].details={checklist:[{id:'check',text:'서명',done:false}]};
  target.viewport.x=450;
  assert.equal(applyComparedDocument(target,incoming,baseline),true);assert.equal(target.viewport.x,450);assert.equal(target.workspace,undefined);
  incoming.nodes[0].details!.checklist![0].done=true;
  assert.equal(target.nodes[0].details!.checklist![0].done,false);
});

test('presentation follows dependency order, omits hidden decorations, and remains finite with cycles',()=>{
  const doc=fixture();doc.nodes.reverse();
  assert.deepEqual(presentationStops(doc).map(s=>s.id),['a','b']);
  doc.edges.push({...doc.edges[0],id:'ba',from:'b',to:'a'});
  const decoration=createNode('frame',0,0);decoration.id='frame';doc.nodes.push(decoration);
  assert.deepEqual(presentationStops(doc).map(s=>s.id),['b','a']);
  doc.workspace={layers:[{id:'hidden',name:'내부 검토',hidden:true}]};doc.nodes[0].details={layerId:'hidden'};
  assert.deepEqual(presentationStops(doc).map(s=>s.id),['a']);
  assert.deepEqual(presentationStops(doc,new Set(['b']),'selection'),[]);
});

test('bookmarks retain saved view and order, and use node page information when available',()=>{
  const doc:FlowDocument=fixture();doc.nodes[0].details={pageId:'sources'};
  doc.workspace={bookmarks:[{id:'first',name:'개요',nodeId:'absent',viewport:{x:10,y:20,zoom:.5}},{id:'second',name:'자료',nodeId:'a',viewport:{x:40,y:50,zoom:1}}]};
  const stops=presentationStops(doc,new Set(),'bookmarks');assert.deepEqual(stops[0].nodeIds,[]);assert.equal(stops[0].viewport!.zoom,.5);
  assert.equal(stops[1].pageId,'sources');assert.deepEqual(stops[1].nodeIds,['a']);
  stops[0].viewport!.x=500;assert.equal(doc.workspace.bookmarks![0].viewport.x,10);
});
