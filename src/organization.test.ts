import test from 'node:test';
import assert from 'node:assert/strict';
import {createNode,emptyDocument,validateDocument,cloneDocument} from './model.ts';
import {ensureWorkspace,createGroup,groupMembers,setGroupParent,ungroup,resizeGroup,projectVisibleDocument,editableNodeIds,addPage,moveToPage,removePage,addLayer,assignLayer,removeLayer,createLibraryItem,insertLibraryItem,addBookmark,reparentDroppedNodes} from './organization.ts';

function fixture(){
  const doc=emptyDocument();doc.nodes=[createNode('rect',0,0),createNode('text',300,0),createNode('rect',700,0)];
  doc.edges=[{id:'edge',from:doc.nodes[1].id,to:doc.nodes[2].id,fromPort:'right',toPort:'left',label:'',color:'#111111',width:2,style:'elbow',dashed:false,arrow:'end',waypoints:[{x:650,y:200}]}];return doc;
}
test('nested groups preserve existing children and cannot become cyclic',()=>{
  const doc=fixture(),[a,b,c]=doc.nodes;
  const child=createGroup(doc,[a.id,b.id],'자료'),parent=createGroup(doc,[a.id,c.id],'보고 준비');
  assert.equal(doc.workspace!.groups!.find(g=>g.id===child)!.parentId,parent);
  assert.equal(groupMembers(doc,parent).length,3);assert.equal(groupMembers(doc,child).length,2);
  assert.throws(()=>setGroupParent(doc,parent,child));
  ungroup(doc,parent);assert.equal(doc.workspace!.groups!.find(g=>g.id===child)!.parentId,undefined);assert.equal(c.groupId,undefined);
  assert.equal(groupMembers(doc,child).length,2);assert.doesNotThrow(()=>validateDocument(doc));
});
test('collapsed groups render a proxy and preserve external connections without mutating stored elements',()=>{
  const doc=fixture(),[a,b,c]=doc.nodes,group=createGroup(doc,[a.id,b.id],'자료');
  doc.workspace!.groups!.find(g=>g.id===group)!.collapsed=true;
  const before=JSON.stringify(doc),view=projectVisibleDocument(doc);
  assert.equal(view.nodes.length,2);assert.equal(view.edges.length,1);assert.equal(view.edges[0].from,a.id);assert.equal(view.edges[0].to,c.id);
  assert.equal(view.edges[0].waypoints,undefined);assert.match(view.nodes[0].text,/자료/);
  assert.equal(JSON.stringify(doc),before);assert.equal(projectVisibleDocument(doc),view,'view identity keeps route cache usable');
});
test('page and layer filtering preserve source nodes and merging pages retains data',()=>{
  const doc=fixture(),[a,b]=doc.nodes,page=addPage(doc,'다음 단계'),layer=addLayer(doc,'참고');
  moveToPage(doc,[a.id],page);assignLayer(doc,[b.id],layer);
  const l=doc.workspace!.layers!.find(l=>l.id===layer)!;l.hidden=true;
  assert.equal(projectVisibleDocument(doc).nodes.length,1);assert.equal(doc.nodes.length,3);
  doc.workspace!.activePageId=page;assert.deepEqual(projectVisibleDocument(doc).nodes.map(n=>n.id),[a.id]);
  removePage(doc,page);assert.equal(doc.workspace!.activePageId,'page-main');assert.equal(a.details!.pageId,'page-main');
  removeLayer(doc,layer);assert.equal(projectVisibleDocument(doc).nodes.length,3);assert.equal(b.details!.layerId,undefined);
  assert.doesNotThrow(()=>validateDocument(doc));
});
test('layer or member locks freeze a whole group and resizing preserves internal guides',()=>{
  const doc=fixture(),[a,b,c]=doc.nodes,group=createGroup(doc,[a.id,b.id],'자료');
  doc.edges[0].to=a.id;const oldWidth=a.w,oldGuide={...doc.edges[0].waypoints![0]};
  resizeGroup(doc,group,2);assert.equal(a.w,oldWidth*2);assert.equal(doc.edges[0].waypoints![0].x,oldGuide.x*2);
  const layer=addLayer(doc,'고정');assignLayer(doc,[b.id],layer);doc.workspace!.layers!.find(l=>l.id===layer)!.locked=true;
  const editable=editableNodeIds(doc);assert.ok(!editable.has(a.id)&&!editable.has(b.id)&&editable.has(c.id));
  assert.throws(()=>resizeGroup(doc,group,2));
  const page=addPage(doc,'다른 페이지');assert.throws(()=>moveToPage(doc,[a.id],page));assert.throws(()=>assignLayer(doc,[a.id],'layer-main'));
});
test('library items survive validation and insertion remaps groups, guides, and asset IDs',()=>{
  const doc=fixture(),[a,b]=doc.nodes,group=createGroup(doc,[a.id,b.id],'공통 자료');
  doc.workspace!.groups!.find(g=>g.id===group)!.description='월간보고 전에 확인할 공통 자료입니다.';
  doc.edges[0].to=a.id;const item=createLibraryItem(doc,[a.id],'내 자료');
  assert.equal(item.document.nodes.length,2);assert.doesNotThrow(()=>validateDocument(item.document));
  const ids=insertLibraryItem(doc,item,{x:1000,y:500});assert.equal(ids.length,2);assert.equal(doc.nodes.length,5);assert.equal(doc.edges.length,2);
  assert.notEqual(doc.nodes[3].groupId,group);assert.equal(doc.nodes[3].x,1000);assert.equal(doc.edges[1].waypoints![0].x,1650);
  assert.equal(doc.workspace!.groups!.find(g=>g.id===doc.nodes[3].groupId)!.description,'월간보고 전에 확인할 공통 자료입니다.');
  assert.equal(new Set(doc.nodes.map(n=>n.id)).size,5);assert.doesNotThrow(()=>validateDocument(doc));
});
test('failed library insertion is atomic and bookmarks survive document snapshots',()=>{
  const doc=fixture(),item=createLibraryItem(doc,[doc.nodes[0].id],'도형');ensureWorkspace(doc);
  const before=JSON.stringify(doc);assert.throws(()=>insertLibraryItem(doc,item,{x:2000000,y:0}));assert.equal(JSON.stringify(doc),before);
  addBookmark(doc,'자료 위치',doc.nodes[0].id);const copy=cloneDocument(doc);doc.workspace!.bookmarks![0].viewport.x+=10;
  assert.notEqual(copy.workspace!.bookmarks![0].viewport.x,doc.workspace!.bookmarks![0].viewport.x);assert.doesNotThrow(()=>validateDocument(copy));
});

test('group drag-in and drag-out preserve full nested groups and detach individual members',()=>{
  const doc=fixture(),[a,b,c]=doc.nodes,child=createGroup(doc,[a.id,b.id],'자료');
  const extra=createNode('rect',1000,0);doc.nodes.push(extra);const parent=createGroup(doc,[c.id,extra.id],'보고');
  reparentDroppedNodes(doc,[a.id,b.id],parent);assert.equal(doc.workspace!.groups!.find(g=>g.id===child)!.parentId,parent);assert.equal(a.groupId,child);
  assert.throws(()=>reparentDroppedNodes(doc,doc.nodes.map(n=>n.id),child));
  reparentDroppedNodes(doc,[a.id,b.id]);assert.equal(doc.workspace!.groups!.find(g=>g.id===child)!.parentId,undefined);assert.equal(a.groupId,child);
  reparentDroppedNodes(doc,[a.id],parent);assert.equal(a.groupId,parent);assert.equal(b.groupId,child);
  reparentDroppedNodes(doc,[a.id]);assert.equal(a.groupId,undefined);assert.doesNotThrow(()=>validateDocument(doc));
});

test('reusable groups preserve conditional references or require their missing source',()=>{
  const doc=fixture(),[a,b,c]=doc.nodes;doc.edges[0].condition={nodeId:a.id,field:'status',operator:'equals',value:'verified'};
  assert.throws(()=>createLibraryItem(doc,[b.id,c.id],'조건 자료'),/기준 요소/);
  const item=createLibraryItem(doc,[a.id,b.id,c.id],'조건 자료'),ids=insertLibraryItem(doc,item,{x:0,y:500});
  assert.equal(doc.edges[1].condition!.nodeId,ids[0]);assert.notEqual(doc.edges[1].condition!.nodeId,a.id);assert.doesNotThrow(()=>validateDocument(doc));
});
