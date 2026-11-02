import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneDocument,createNode,duplicateSelection,emptyDocument,validateDocument} from './model.ts';
import {formatNodeTextRange,normalizeNodeTable,normalizeTextRuns,parseTableText,safeTextHref,setNodeChecklist,setNodePlainText,setNodeRichText,setNodeTable} from './rich-text.ts';

test('partial formatting splits only the selected Korean text and preserves existing styles',()=>{
  const node=createNode('text',0,0);setNodeRichText(node,[{text:'선행 자료 확인',color:'#123456'}]);
  assert.equal(formatNodeTextRange(node,3,5,{bold:true,fontSize:24}),true);
  assert.deepEqual(node.textRuns,[{text:'선행 ',color:'#123456'},{text:'자료',bold:true,color:'#123456',fontSize:24},{text:' 확인',color:'#123456'}]);
  assert.equal(node.text,'선행 자료 확인');assert.equal(node.contentMode,'text');
});

test('formatting and clearing a hyperlink never changes text or permits executable schemes',()=>{
  const node=createNode('text',0,0);setNodePlainText(node,'문서 링크');
  formatNodeTextRange(node,3,5,{href:'https://example.com/docs'});assert.equal(node.textRuns![1].href,'https://example.com/docs');
  formatNodeTextRange(node,3,5,{href:''});assert.deepEqual(node.textRuns,[{text:'문서 링크'}]);
  for(const href of ['javascript:alert(1)','data:text/html,hello','file:///C:/secret','https://user:pass@example.com','https://example.com\n'])assert.equal(safeTextHref(href),false);
  assert.equal(safeTextHref('mailto:review@example.com'),true);
  assert.throws(()=>formatNodeTextRange(node,0,2,{href:'javascript:bad'}));assert.equal(node.text,'문서 링크');
});

test('empty ranges do nothing and plain text replacement removes stale format ranges',()=>{
  const node=createNode('text',0,0);setNodeRichText(node,[{text:'확인',bold:true}]);
  assert.equal(formatNodeTextRange(node,1,1,{color:'#ff0000'}),false);
  setNodePlainText(node,'교체된 본문');assert.equal(node.textRuns,undefined);
  assert.throws(()=>formatNodeTextRange(node,-1,2,{bold:true}));assert.throws(()=>formatNodeTextRange(node,0,500,{bold:true}));
});

test('table paste parses tab-separated cells and rejects inconsistent or oversized grids',()=>{
  assert.deepEqual(parseTableText('자료\t상태\r\n판매량\t확인\r\n'),{columns:['자료','상태'],rows:[['판매량','확인']]});
  assert.throws(()=>parseTableText('자료\t상태\n판매량'));
  assert.throws(()=>normalizeNodeTable({columns:Array(21).fill('열'),rows:[]}));
  assert.throws(()=>normalizeNodeTable({columns:Array(20).fill('열'),rows:Array.from({length:200},()=>Array(20).fill('값'))}));
});

test('rich text, table and checklist survive file validation and independent undo/duplicate snapshots',()=>{
  const doc=emptyDocument(),node=createNode('rect',0,0);node.id='source';doc.nodes=[node];
  setNodeRichText(node,[{text:'수량 ',bold:true},{text:'표',href:'https://example.com'}]);
  setNodeTable(node,{columns:['항목','수량'],rows:[['판매량','3']]});
  const tableDoc=validateDocument(JSON.parse(JSON.stringify(doc)));assert.deepEqual(tableDoc.nodes[0].table,node.table);
  const before=cloneDocument(doc);node.table!.rows[0][1]='4';node.textRuns![0].bold=false;
  assert.equal(before.nodes[0].table!.rows[0][1],'3');assert.equal(before.nodes[0].textRuns![0].bold,true);
  const copies=duplicateSelection(doc,['source']),copy=doc.nodes.find(n=>n.id===copies[0])!;copy.table!.columns[0]='다름';assert.equal(node.table!.columns[0],'항목');
  setNodeChecklist(node,[{id:'check',text:'확인 완료',done:true}]);assert.equal(node.contentMode,'checklist');assert.deepEqual(validateDocument(doc).nodes[0].details!.checklist,node.details!.checklist);
});

test('malformed formatting cannot enter a document and unknown fields are discarded',()=>{
  assert.throws(()=>normalizeTextRuns([{text:'A',fontSize:Infinity}]));assert.throws(()=>normalizeTextRuns([{text:'A',color:'red;display:none'}]));
  assert.throws(()=>normalizeTextRuns([{text:'A'}],'different'));
  assert.throws(()=>normalizeTextRuns(Array.from({length:1001},()=>({text:'a'}))));
  const doc=emptyDocument(),node=createNode('text',0,0);doc.nodes=[node];const raw=JSON.parse(JSON.stringify(doc));
  raw.nodes[0].textRuns=[{text:node.text,bold:true,onclick:'bad'}];assert.equal('onclick' in validateDocument(raw).nodes[0].textRuns![0],false);
  raw.nodes[0].textRuns[0].text='mismatch';assert.throws(()=>validateDocument(raw));
});
