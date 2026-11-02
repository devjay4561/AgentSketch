import test from 'node:test';
import assert from 'node:assert/strict';
import {addAttachment,applySourceRelink,attachmentBlob,ATTACHMENT_LIMITS,prepareAttachment,previewSourceRelink,removeAttachment,validateAttachment,validateAttachments} from './attachments.ts';
import {cloneDocument,createNode,duplicateSelection,emptyDocument,validateDocument} from './model.ts';
import {normalizeNodeTable,setNodeChecklist} from './rich-text.ts';

test('portable attachment retains exact bytes through save, validation and download',async()=>{
  const file=new File(['업무 자료\n원본 확인'],'설명.txt',{type:'text/plain'}),attachment=await prepareAttachment(file);
  const doc=emptyDocument(),node=createNode('rect',0,0);doc.nodes=[node];addAttachment(doc,node.id,attachment);
  const restored=validateDocument(JSON.parse(JSON.stringify(doc))),saved=restored.workspace!.attachments![0];
  assert.equal(await attachmentBlob(saved).text(),'업무 자료\n원본 확인');assert.deepEqual(restored.nodes[0].details!.attachmentIds,[attachment.id]);
  assert.equal(saved.size,file.size);
});

test('identical bytes are stored once and snapshots isolate lists while sharing immutable strings',async()=>{
  const attachment=await prepareAttachment(new File(['자료'],'설명.txt'));
  const doc=emptyDocument(),a=createNode('rect',0,0),b=createNode('rect',300,0);doc.nodes=[a,b];
  addAttachment(doc,a.id,attachment);const second=addAttachment(doc,b.id,{...attachment,id:'second'});assert.equal(second,attachment.id);assert.equal(doc.workspace!.attachments!.length,1);
  const snapshot=cloneDocument(doc);a.details!.attachmentIds!.push('not-real');doc.workspace!.attachments![0].name='changed.txt';
  assert.deepEqual(snapshot.nodes[0].details!.attachmentIds,[attachment.id]);assert.equal(snapshot.workspace!.attachments![0].name,'설명.txt');assert.equal(snapshot.workspace!.attachments![0].data,attachment.data);
});

test('duplicate and removal keep attachment references coherent and require rechecking verified evidence',async()=>{
  const attachment=await prepareAttachment(new File(['자료'],'설명.txt')),doc=emptyDocument(),node=createNode('rect',0,0);doc.nodes=[node];node.details={status:'verified'};
  addAttachment(doc,node.id,attachment);assert.equal(node.details.status,'stale');node.details.status='verified';
  const copied=duplicateSelection(doc,[node.id]);assert.deepEqual(doc.nodes.find(n=>n.id===copied[0])!.details!.attachmentIds,[attachment.id]);
  removeAttachment(doc,attachment.id);assert.equal(node.details.status,'stale');assert.equal(doc.workspace!.attachments!.length,0);assert.doesNotThrow(()=>validateDocument(doc));
});

test('unsafe names, executable disguises, invalid references and excessive payloads are rejected',async()=>{
  await assert.rejects(()=>prepareAttachment(new File(['MZbad'],'report.pdf')));
  await assert.rejects(()=>prepareAttachment(new File(['MZbad'],'report.exe')));
  await assert.rejects(()=>prepareAttachment(new File([new Uint8Array(ATTACHMENT_LIMITS.single+1)],'large.txt')));
  const attachment=await prepareAttachment(new File(['safe'],'file.txt'));
  assert.throws(()=>validateAttachment({...attachment,name:'../file.txt'}));assert.throws(()=>validateAttachment({...attachment,size:999}));assert.throws(()=>validateAttachment({...attachment,data:'!!!!'}));
  assert.throws(()=>validateAttachments([attachment,attachment]));
  const doc=emptyDocument(),node=createNode('rect',0,0);node.details={attachmentIds:['missing']};doc.nodes=[node];assert.throws(()=>validateDocument(doc));
  doc.workspace={attachments:[attachment]};assert.throws(()=>validateDocument(doc));
});

test('attachment limits apply to the complete project and cannot be bypassed through locked elements',async()=>{
  const attachment=await prepareAttachment(new File(['x'.repeat(ATTACHMENT_LIMITS.single)],'large.txt'));
  const doc=emptyDocument(),node=createNode('rect',0,0);doc.nodes=[node];node.locked=true;assert.throws(()=>addAttachment(doc,node.id,attachment));node.locked=false;
  addAttachment(doc,node.id,attachment);node.locked=true;assert.throws(()=>removeAttachment(doc,attachment.id));node.locked=false;
  // Distinct valid text payloads still count their decoded byte sizes.
  doc.workspace!.attachments=Array.from({length:4},(_,i)=>({...attachment,id:`full-${i}`}));node.details!.attachmentIds=[];
  const extra=await prepareAttachment(new File(['different'],'extra.txt'));assert.throws(()=>addAttachment(doc,node.id,extra));
});

test('source relink previews exact folder prefixes, respects locks and rejects stale previews atomically',()=>{
  const doc=emptyDocument(),nodes=[createNode('rect',0,0),createNode('rect',300,0),createNode('rect',600,0)];doc.nodes=nodes;
  nodes[0].details={source:'C:\\자료\\a.pdf',status:'verified',sourceFingerprint:'old'};nodes[1].details={source:'C:\\자료함\\b.pdf'};nodes[2].details={source:'C:\\자료\\c.pdf'};nodes[2].locked=true;
  const changes=previewSourceRelink(doc,'c:\\자료','D:\\새자료');assert.equal(changes.length,1);assert.equal(nodes[0].details.source,'C:\\자료\\a.pdf');
  assert.equal(applySourceRelink(doc,changes),1);assert.equal(nodes[0].details.source,'D:\\새자료\\a.pdf');assert.equal(nodes[0].details.status,'stale');assert.equal(nodes[0].details.sourceFingerprint,undefined);
  assert.equal(applySourceRelink(doc,changes),0);
  const next=[{nodeId:nodes[0].id,oldSource:nodes[0].details.source,newSource:'valid'},{nodeId:nodes[1].id,oldSource:nodes[1].details.source!,newSource:'bad\n'}];
  assert.throws(()=>applySourceRelink(doc,next));assert.equal(nodes[0].details.source,'D:\\새자료\\a.pdf');
});

test('rich tables and checklists have a total text budget, not just per-cell limits',()=>{
  assert.throws(()=>normalizeNodeTable({columns:['A'],rows:Array.from({length:30},()=>['x'.repeat(2000)])}));
  const node=createNode('rect',0,0),checklist=Array.from({length:30},(_,i)=>({id:'i'+i,text:'x'.repeat(2000),done:false}));
  assert.throws(()=>setNodeChecklist(node,checklist));const doc=emptyDocument();node.details={checklist};doc.nodes=[node];assert.throws(()=>validateDocument(doc));
  node.details={reviewIntervalDays:1.5};assert.throws(()=>validateDocument(doc));
});
