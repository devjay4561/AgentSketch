import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneDocument,createNode,duplicateSelection,emptyDocument,removeSelection,validateDocument} from './model.ts';

function fixture(){
  const doc=emptyDocument(),a=createNode('rect',0,0),b=createNode('rect',400,0);a.id='a';b.id='b';a.groupId='child';b.groupId='child';
  a.details={role:'resource',source:'C:\\자료\\검사.xlsx',sourceSystem:'CRM',owner:'담당자',status:'verified',version:'2',verifiedVersion:'2',checkedBy:'검토자',checkedAt:'2026-10-30T01:00:00Z',dueAt:'2027-10-30',notes:'자료 확인',sourceFingerprint:'abc',verifiedSourceFingerprint:'abc',pageId:'page-main',layerId:'layer-main',checklist:[{id:'check-one',text:'확인',done:true}]};
  a.crop={x:0,y:0,w:.5,h:.5};a.rotation=90;a.customPorts=[{id:'port-a',point:{x:1,y:.3}}];
  doc.nodes=[a,b];doc.edges=[{id:'edge',from:'a',to:'b',fromPort:'right',toPort:'left',label:'입력',color:'#111111',width:2,style:'elbow',dashed:false,arrow:'end',relation:'required',labelPosition:.3,fromAnchor:{x:1,y:.3},toAnchor:{x:0,y:.6}}];
  doc.workspace={pages:[{id:'page-main',name:'업무'}],activePageId:'page-main',layers:[{id:'layer-main',name:'자료',hidden:false,locked:false}],groups:[{id:'parent',name:'전체'},{id:'child',parentId:'parent',name:'자료 묶음',collapsed:true}],comments:[{id:'comment-one',nodeId:'a',author:'검토자',text:'자료 갱신',createdAt:'2026-10-30T01:00:00Z'}],bookmarks:[{id:'bookmark-one',name:'자료로',nodeId:'a',viewport:{x:0,y:0,zoom:1}}]};return doc;
}

test('workspace and resource data survive JSON save and validation without losing original fields',()=>{
  const doc=fixture(),loaded=validateDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(loaded.nodes[0].details,doc.nodes[0].details);
  assert.deepEqual(loaded.workspace,doc.workspace);assert.deepEqual(loaded.edges[0],doc.edges[0]);
  assert.deepEqual(loaded.nodes[0].customPorts,doc.nodes[0].customPorts);
  assert.equal(validateDocument(emptyDocument()).workspace,undefined);
});

test('history snapshots isolate workspace, checklist, crop, custom ports and edge anchors',()=>{
  const doc=fixture(),snapshot=cloneDocument(doc);
  doc.nodes[0].details!.checklist![0].done=false;doc.nodes[0].crop!.w=.8;doc.nodes[0].customPorts![0].point.y=.9;
  doc.edges[0].fromAnchor!.y=.9;doc.workspace!.groups![0].name='changed';doc.workspace!.bookmarks![0].viewport.zoom=2;
  assert.equal(snapshot.nodes[0].details!.checklist![0].done,true);assert.equal(snapshot.nodes[0].crop!.w,.5);assert.equal(snapshot.nodes[0].customPorts![0].point.y,.3);
  assert.equal(snapshot.edges[0].fromAnchor!.y,.3);assert.equal(snapshot.workspace!.groups![0].name,'전체');assert.equal(snapshot.workspace!.bookmarks![0].viewport.zoom,1);
});

test('duplicating a nested group remaps the hierarchy and deep copies editable metadata',()=>{
  const doc=fixture(),ids=duplicateSelection(doc,['a','b']);const copy=doc.nodes.find(n=>n.id===ids[0])!;
  assert.notEqual(copy.groupId,'child');assert.notEqual(copy.details!.checklist![0].id,'check-one');
  const group=doc.workspace!.groups!.find(g=>g.id===copy.groupId)!;assert.notEqual(group.parentId,'parent');
  copy.details!.checklist![0].done=false;assert.equal(doc.nodes[0].details!.checklist![0].done,true);
  assert.doesNotThrow(()=>validateDocument(doc));
});

test('removing a node removes its comments and bookmarks without breaking document validation',()=>{
  const doc=fixture();removeSelection(doc,['a']);assert.deepEqual(doc.workspace!.comments,[]);assert.deepEqual(doc.workspace!.bookmarks,[]);assert.doesNotThrow(()=>validateDocument(doc));
});

test('invalid extension data, references and nested group cycles are rejected',()=>{
  const mutations=[
    (doc:ReturnType<typeof fixture>)=>{doc.nodes[0].crop!.x=.8;},
    (doc:ReturnType<typeof fixture>)=>{doc.nodes[0].details!.checkedAt='2026-02-31';},
    (doc:ReturnType<typeof fixture>)=>{doc.nodes[0].details!.pageId='missing';},
    (doc:ReturnType<typeof fixture>)=>{doc.workspace!.groups![0].parentId='child';},
    (doc:ReturnType<typeof fixture>)=>{doc.workspace!.groups![0].parentId='missing';},
    (doc:ReturnType<typeof fixture>)=>{doc.edges[0].fromAnchor!.x=Infinity;},
    (doc:ReturnType<typeof fixture>)=>{doc.workspace!.layers!.push({...doc.workspace!.layers![0]});},
    (doc:ReturnType<typeof fixture>)=>{doc.nodes[0].details!.checklist!.push({...doc.nodes[0].details!.checklist![0]});},
  ];for(const mutate of mutations){const doc=fixture();mutate(doc);assert.throws(()=>validateDocument(doc));}
});

test('unknown extension fields cannot inject executable content or prototype keys into the model',()=>{
  const doc=fixture();const raw=JSON.parse(JSON.stringify(doc));raw.nodes[0].details.onclick='alert(1)';raw.workspace.comments[0].html='<script>bad</script>';raw.workspace.unknown='unknown';
  const loaded=validateDocument(raw);assert.equal('onclick' in loaded.nodes[0].details!,false);assert.equal('html' in loaded.workspace!.comments![0],false);assert.equal('unknown' in loaded.workspace!,false);
});

test('conditional links and custom fields persist, deep clone, and remap on group duplication',()=>{
  const doc=fixture();doc.nodes[0].details!.customFields={'자료종류':'판매량'};
  doc.edges[0].condition={nodeId:'a',field:'자료종류',operator:'equals',value:'판매량'};
  doc.edges[0].labelBackground='#fff1e6';doc.edges[0].labelAngle=-90;doc.workspace!.groups![0].description='월간보고에 필요한 자료';
  const saved=validateDocument(JSON.parse(JSON.stringify(doc)));assert.deepEqual(saved.edges[0].condition,doc.edges[0].condition);assert.equal(saved.workspace!.groups![0].description,'월간보고에 필요한 자료');
  const snapshot=cloneDocument(doc);doc.nodes[0].details!.customFields['자료종류']='변경';doc.edges[0].condition.value='변경';
  assert.equal(snapshot.nodes[0].details!.customFields!['자료종류'],'판매량');assert.equal(snapshot.edges[0].condition!.value,'판매량');
  const copies=duplicateSelection(doc,['a','b']);const copyEdge=doc.edges.find(e=>e.from===copies[0])!;assert.equal(copyEdge.condition!.nodeId,copies[0]);assert.doesNotThrow(()=>validateDocument(doc));
});

test('conditional source deletion is rejected atomically while deleting its dependent edge endpoints is allowed',()=>{
  const doc=fixture(),settings=createNode('rect',800,0);settings.id='settings';settings.details={customFields:{mode:'active'}};doc.nodes.push(settings);
  doc.edges[0].condition={nodeId:'settings',field:'mode',operator:'equals',value:'active'};
  const original=JSON.stringify(doc);assert.throws(()=>removeSelection(doc,['settings']));assert.equal(JSON.stringify(doc),original);
  removeSelection(doc,['settings','b']);assert.equal(doc.edges.length,0);assert.doesNotThrow(()=>validateDocument(doc));
});

test('conditional references, operators, field limits and label styles validate without evaluating expressions',()=>{
  const changes=[
    (raw:any)=>{raw.edges[0].condition={nodeId:'missing',field:'status',operator:'equals',value:'verified'};},
    (raw:any)=>{raw.edges[0].condition={nodeId:'a',field:'status',operator:'eval',value:'alert(1)'};},
    (raw:any)=>{raw.nodes[0].details.customFields=JSON.parse('{"__proto__":"bad"}');},
    (raw:any)=>{raw.nodes[0].details.customFields={status:'verified'};},
    (raw:any)=>{raw.nodes[0].details.customFields=Object.fromEntries(Array.from({length:33},(_,i)=>['key'+i,'value']));},
    (raw:any)=>{raw.edges[0].labelBackground='#12345';},
    (raw:any)=>{raw.edges[0].labelAngle=45;},
  ];for(const change of changes){const raw=JSON.parse(JSON.stringify(fixture()));change(raw);assert.throws(()=>validateDocument(raw));}
});
