import test from 'node:test';
import assert from 'node:assert/strict';
import {createNode,emptyDocument,History} from './model.ts';

test('small boards retain the configured sixty undo steps',()=>{
  let doc=emptyDocument();doc.nodes=[createNode('rect',0,0)];const history=new History();
  for(let i=0;i<70;i++){doc.title=String(i);history.push(doc);}doc.title='70';
  let count=0;while(history.canUndo){doc=history.undo(doc)!;count++;}
  assert.equal(count,60);assert.equal(doc.title,'10');assert.ok(history.retainedObjects<=history.objectBudget);
  history.clear();assert.equal(history.retainedObjects,0);assert.equal(history.canRedo,false);
});

test('large boards discard oldest snapshots while preserving the retained undo and redo sequence',()=>{
  let doc=emptyDocument();const base=createNode('rect',0,0);doc.nodes=Array.from({length:10000},(_,i)=>({...base,id:'n'+i,x:i}));
  const history=new History();
  for(let i=0;i<15;i++){doc.title=String(i);history.push(doc);}doc.title='15';
  const originals:string[]=[];while(history.canUndo){doc=history.undo(doc)!;originals.push(doc.title);assert.equal(doc.nodes.length,10000);assert.ok(history.retainedObjects<=history.objectBudget);}
  assert.ok(originals.length<15&&originals.length>1);assert.equal(originals[0],'14');
  let redone=0;while(history.canRedo){doc=history.redo(doc)!;redone++;assert.ok(history.retainedObjects<=history.objectBudget);}
  assert.equal(redone,originals.length);assert.equal(doc.title,'15');
});

test('metadata contributes to the budget but shared payload strings do not multiply its charge',()=>{
  const doc=emptyDocument(),node=createNode('rect',0,0);doc.nodes=[node];node.details={checklist:Array.from({length:400},(_,i)=>({id:'c'+i,text:'확인',done:false}))};
  doc.workspace={attachments:[{id:'file',name:'example.txt',mime:'text/plain',size:100000,data:'x'.repeat(100000)}]};
  const history=new History(60,1000);for(let i=0;i<5;i++){doc.title=String(i);history.push(doc);}
  assert.ok(history.retainedObjects<1000);let count=0;let current=doc;
  while(history.canUndo){current=history.undo(current)!;count++;}
  assert.equal(count,2);assert.equal(current.workspace!.attachments![0].data,doc.workspace.attachments![0].data);
});
