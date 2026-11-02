import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDocument,createNode,validateDocument,cloneDocument,duplicateSelection} from './model.ts';
test('linked cards preserve their original path through save, clone and duplication',()=>{
 const doc=emptyDocument(),n=createNode('round',0,0);n.details={documentPath:'C:\\자료\\월간보고.agentsketch'};doc.nodes.push(n);
 const loaded=validateDocument(JSON.parse(JSON.stringify(doc)));assert.equal(loaded.nodes[0].details?.documentPath,n.details.documentPath);
 assert.equal(cloneDocument(loaded).nodes[0].details?.documentPath,n.details.documentPath);
 duplicateSelection(loaded,new Set([n.id]));assert.equal(loaded.nodes[1].details?.documentPath,n.details.documentPath);
});
test('document cards reject executable, relative and malformed paths',()=>{
 for(const path of ['javascript:alert(1)','report.agentsketch','C:\\report.exe','C:\\bad\n.agentsketch']){
 const doc=emptyDocument(),n=createNode('round',0,0);n.details={documentPath:path};doc.nodes.push(n);assert.throws(()=>validateDocument(doc));}
});
