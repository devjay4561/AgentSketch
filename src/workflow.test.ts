import test from 'node:test';
import assert from 'node:assert/strict';
import { createNode, emptyDocument } from './model.ts';
import { analyzeWorkflow, traceNodes, evaluateEdgeCondition } from './workflow.ts';
import type { FlowDocument, FlowEdge, FlowNode } from './types.ts';

const now = '2026-10-30T12:00:00+09:00';
function resource(id: string, verified = true): FlowNode {
  return {...createNode('rect',0,0),id,text:id,details:{role:'resource',source:`C:\\자료\\${id}.pdf`,status:verified?'verified':'collected',checkedBy:'담당자',checkedAt:'2026-10-29T09:00:00+09:00'}};
}
function step(id: string): FlowNode { return {...createNode('rect',0,0),id,text:id,details:{role:'step'}}; }
function edge(from: string, to: string, relation: FlowEdge['relation'] = 'required'): FlowEdge {
  return {id:`${from}-${to}`,from,to,fromPort:'right',toPort:'left',style:'elbow',width:2,color:'#111111',label:'',dashed:false,arrow:'end',relation};
}
function board(nodes: FlowNode[], edges: FlowEdge[] = []): FlowDocument { return {...emptyDocument(),nodes,edges}; }

test('a resource needs recorded content confirmation, not merely a source path',()=>{
  const a=resource('a',false), b=resource('b'); delete b.details!.source;
  const c=resource('c'); delete c.details!.checkedBy;
  const d=resource('d'); delete d.details!.checkedAt;
  const result=analyzeWorkflow(board([a,b,c,d,resource('e')]),now);
  for(const id of ['a','b','c','d']) assert.equal(result.nodes.get(id)!.status,'blocked');
  assert.equal(result.nodes.get('e')!.ready,true);
  assert.equal(result.summary.resources,5);assert.equal(result.summary.ready,1);
});

test('all requirements gate a step independently of its manual completion',()=>{
  const a=resource('a'), b=resource('b',false), report=step('report');report.details!.status='verified';
  const doc=board([a,b,report],[edge('a','report'),edge('b','report')]);
  let result=analyzeWorkflow(doc,now);
  assert.equal(result.nodes.get('report')!.ready,false);
  assert.deepEqual(result.nodes.get('report')!.blockers,['b']);
  b.details!.status='verified';report.details!.status='reviewing';
  result=analyzeWorkflow(doc,now);
  assert.equal(result.nodes.get('report')!.ready,true);
  assert.equal(result.nodes.get('report')!.manualStatus,'reviewing');
});

test('any requirements and alternative groups distinguish sufficient from mandatory inputs',()=>{
  const nodes=[resource('required',false),resource('altA'),resource('altB',false),step('report')];
  const doc=board(nodes,[edge('required','report'),edge('altA','report','alternative'),edge('altB','report','alternative')]);
  assert.equal(analyzeWorkflow(doc,now).nodes.get('report')!.ready,false);
  nodes[0].details!.status='verified';
  assert.equal(analyzeWorkflow(doc,now).nodes.get('report')!.ready,true);
  nodes[0].details!.status='collected';nodes[3].details!.requirement='any';
  assert.equal(analyzeWorkflow(doc,now).nodes.get('report')!.ready,true);
  nodes[1].details!.status='reviewing';
  assert.equal(analyzeWorkflow(doc,now).nodes.get('report')!.ready,false);
});

test('optional and reference inputs do not block readiness or create dependency cycles',()=>{
  const a=resource('a'), b=resource('b',false), report=step('report');
  const doc=board([a,b,report],[edge('a','report'),edge('b','report','optional'),edge('report','a','reference')]);
  const result=analyzeWorkflow(doc,now);
  assert.equal(result.nodes.get('report')!.ready,true);assert.equal(result.summary.cycle,0);
});

test('changed versions, source fingerprints and expiry revoke recorded readiness',()=>{
  const a=resource('a');a.details!.version='v2';a.details!.verifiedVersion='v1';
  const b=resource('b');b.details!.sourceFingerprint='new';b.details!.verifiedSourceFingerprint='old';
  const c=resource('c');c.details!.dueAt='2026-10-29';
  const report=step('report'),doc=board([a,b,c,report],[edge('a','report'),edge('b','report'),edge('c','report')]);
  const result=analyzeWorkflow(doc,now);
  assert.equal(result.summary.stale,3);assert.equal(result.nodes.get('report')!.ready,false);
  assert.deepEqual(traceNodes(doc,'a','downstream'),new Set(['report']));
});

test('missing confirmed version and incomplete checklists require attention',()=>{
  const a=resource('a');a.details!.version='v1';
  const b=resource('b');b.details!.checklist=[{id:'check',text:'수량 대조',done:false}];
  const result=analyzeWorkflow(board([a,b]),now);
  assert.equal(result.nodes.get('a')!.ready,false);assert.equal(result.nodes.get('b')!.ready,false);
  assert.ok(result.issues.some(i=>i.code==='missing-confirmed-version'));
  assert.ok(result.issues.some(i=>i.code==='checklist'));
});

test('a newly checked source fingerprint requires a matching explicit confirmation',()=>{
  const a=resource('a');a.details!.sourceFingerprint='current';
  let result=analyzeWorkflow(board([a]),now);
  assert.equal(result.nodes.get('a')!.ready,false);
  assert.ok(result.issues.some(i=>i.code==='missing-confirmed-source'));
  a.details!.verifiedSourceFingerprint='current';
  result=analyzeWorkflow(board([a]),now);assert.equal(result.nodes.get('a')!.ready,true);
});

test('cycles and their descendants stay blocked without recursive traversal',()=>{
  const doc=board([step('a'),step('b'),step('c'),resource('independent')],[edge('a','b'),edge('b','a'),edge('b','c')]);
  const result=analyzeWorkflow(doc,now);
  assert.equal(result.nodes.get('a')!.status,'cycle');assert.equal(result.nodes.get('b')!.status,'cycle');
  assert.equal(result.nodes.get('c')!.status,'blocked');assert.equal(result.nodes.get('independent')!.ready,true);
  assert.deepEqual(traceNodes(doc,'a','downstream'),new Set(['b','c']));
  assert.deepEqual(traceNodes(doc,'c','upstream'),new Set(['b','a']));
});

test('drawing elements without recorded criteria never become verified evidence',()=>{
  const a=createNode('text',0,0), b=step('b'), c=step('c');c.details!.status='verified';
  const doc=board([a,b,c],[edge(a.id,'b')]);const result=analyzeWorkflow(doc,now);
  assert.equal(result.nodes.get(a.id)!.status,'untracked');assert.equal(result.nodes.get('b')!.status,'blocked');
  assert.equal(result.nodes.get('c')!.ready,true);assert.equal(result.summary.untracked,1);
});

test('dangling prerequisites and future confirmations are reported rather than silently ready',()=>{
  const a=resource('a');a.details!.checkedAt='2027-01-01T00:00:00Z';
  const doc=board([a,step('b')],[edge('unknown','b')]);const result=analyzeWorkflow(doc,now);
  assert.equal(result.nodes.get('a')!.ready,false);assert.equal(result.nodes.get('b')!.ready,false);
  assert.ok(result.issues.some(i=>i.code==='missing-input'));
  assert.ok(result.issues.some(i=>i.code==='future-confirmation'));
  assert.deepEqual(traceNodes(doc,'absent','upstream'),new Set());
});

test('ten thousand linked steps evaluate with bounded traversal data and unchanged source document',()=>{
  const nodes=[resource('0')],edges:FlowEdge[]=[];
  for(let i=1;i<10000;i++){nodes.push(step(String(i)));edges.push(edge(String(i-1),String(i)));}
  const doc=board(nodes,edges),before=JSON.stringify(doc),result=analyzeWorkflow(doc,now);
  assert.equal(result.summary.ready,10000);assert.equal(result.issues.length,0);
  assert.equal(traceNodes(doc,'0','downstream').size,9999);assert.equal(JSON.stringify(doc),before);
});

test('review interval remains valid at its boundary and expires one millisecond later without mutation',()=>{
  const a=resource('a');a.details!.checkedAt='2026-10-29T09:00:00+09:00';a.details!.reviewIntervalDays=1;
  const doc=board([a]),before=JSON.stringify(doc),deadline=Date.parse(a.details!.checkedAt)+86_400_000;
  assert.equal(analyzeWorkflow(doc,deadline).nodes.get('a')!.ready,true);
  const overdue=analyzeWorkflow(doc,deadline+1);
  assert.equal(overdue.nodes.get('a')!.status,'stale');
  assert.ok(overdue.issues.some(issue=>issue.code==='review-expired'));
  assert.equal(JSON.stringify(doc),before);
});

test('review interval does not legitimize missing or future confirmation and earliest deadline wins',()=>{
  const a=resource('a');a.details!.reviewIntervalDays=365;delete a.details!.checkedAt;
  const b=resource('b');b.details!.reviewIntervalDays=365;b.details!.checkedAt='2027-01-01T00:00:00Z';
  const c=resource('c');c.details!.reviewIntervalDays=365;c.details!.dueAt='2026-10-28';
  const result=analyzeWorkflow(board([a,b,c]),now);
  assert.equal(result.nodes.get('a')!.status,'blocked');
  assert.equal(result.nodes.get('b')!.status,'blocked');
  assert.equal(result.nodes.get('c')!.status,'stale');
  assert.ok(result.issues.some(issue=>issue.nodeId==='a'&&issue.code==='missing-confirmation'));
  assert.ok(result.issues.some(issue=>issue.nodeId==='b'&&issue.code==='future-confirmation'));
});

test('existing embedded attachment satisfies source registration but never confirmation',()=>{
  const a=resource('a'),b=resource('b',false),c=resource('c'),d=resource('d');
  for(const node of [a,b,c,d]) { delete node.details!.source;node.details!.attachmentIds=['file-1']; }
  delete c.details!.checkedBy;d.details!.attachmentIds=['missing-file'];
  const doc=board([a,b,c,d]);
  // The engine only reads attachment identity; payload validation belongs to validateDocument.
  doc.workspace={attachments:[{id:'file-1',name:'시험 자료.txt',mime:'text/plain',size:1,data:'QQ=='}]};
  const result=analyzeWorkflow(doc,now);
  assert.equal(result.nodes.get('a')!.ready,true);
  for(const id of ['b','c','d']) assert.equal(result.nodes.get(id)!.ready,false);
  assert.ok(result.issues.some(issue=>issue.nodeId==='d'&&issue.code==='missing-source'));
  assert.ok(result.issues.some(issue=>issue.nodeId==='c'&&issue.code==='missing-confirmation'));
});

test('literal custom fields activate only matching conditional prerequisites',()=>{
  const a=resource('a',false), report=step('report'), settings=step('settings');
  settings.details!.customFields={market:'국내'};
  const e=edge('a','report');e.condition={nodeId:'settings',field:'market',operator:'equals',value:'수출'};
  const doc=board([a,report,settings],[e]),before=JSON.stringify(doc);
  assert.equal(evaluateEdgeCondition(e,settings),'inactive');
  assert.equal(analyzeWorkflow(doc,now).nodes.get('report')!.ready,true);
  assert.equal(JSON.stringify(doc),before);
  settings.details!.customFields!.market='수출';
  assert.equal(analyzeWorkflow(doc,now).nodes.get('report')!.ready,false);
  a.details!.status='verified';assert.equal(analyzeWorkflow(doc,now).nodes.get('report')!.ready,true);
});

test('notEquals and reserved status compare exact strings without expression evaluation',()=>{
  const a=resource('a'), report=step('report'), settings=step('settings');
  settings.details!.status='reviewing';settings.details!.customFields={status:'verified',expression:'1+1'};
  const e=edge('a','report');e.condition={nodeId:'settings',field:'status',operator:'notEquals',value:'verified'};
  assert.equal(evaluateEdgeCondition(e,settings),'active');
  settings.details!.status='verified';assert.equal(evaluateEdgeCondition(e,settings),'inactive');
  e.condition={nodeId:'settings',field:'expression',operator:'equals',value:'2'};
  assert.equal(evaluateEdgeCondition(e,settings),'inactive');
  e.condition.value='1+1';assert.equal(evaluateEdgeCondition(e,settings),'active');
  settings.details!.customFields!.expression=' 1+1';assert.equal(evaluateEdgeCondition(e,settings),'inactive');
  assert.equal(analyzeWorkflow(board([a,report,settings],[e]),now).nodes.get('report')!.ready,true);
});

test('unknown conditional input blocks even when any has a known ready alternative',()=>{
  const a=resource('a'), b=resource('b'), report=step('report');report.details!.requirement='any';
  const e=edge('a','report');e.condition={nodeId:'b',field:'missing',operator:'equals',value:'yes'};
  const doc=board([a,b,report],[e,edge('b','report')]);
  let result=analyzeWorkflow(doc,now);assert.equal(result.nodes.get('report')!.ready,false);
  assert.ok(result.issues.some(issue=>issue.nodeId==='report'&&issue.code==='condition-missing'));
  e.condition.nodeId='absent';result=analyzeWorkflow(doc,now);
  assert.equal(result.nodes.get('report')!.ready,false);
  assert.ok(result.nodes.get('report')!.blockers.includes('absent'));
});

test('unknown optional and reference conditions never gate readiness',()=>{
  const a=resource('a'),b=resource('b',false),report=step('report');
  const optional=edge('b','report','optional');optional.condition={nodeId:'absent',field:'missing',operator:'equals',value:'x'};
  const reference=edge('b','report','reference');reference.id='reference';reference.condition={...optional.condition};
  const result=analyzeWorkflow(board([a,b,report],[edge('a','report'),optional,reference]),now);
  assert.equal(result.nodes.get('report')!.ready,true);
  assert.ok(!result.issues.some(issue=>issue.code==='condition-missing'));
});

test('inactive conditions break dependency cycles but unknown conditions remain conservative',()=>{
  const a=step('a'),b=step('b'),settings=step('settings');settings.details!.customFields={enabled:'no'};
  const e=edge('b','a');e.condition={nodeId:'settings',field:'enabled',operator:'equals',value:'yes'};
  const doc=board([a,b,settings],[edge('a','b'),e]);
  let result=analyzeWorkflow(doc,now);assert.equal(result.summary.cycle,0);assert.equal(result.nodes.get('b')!.ready,true);
  delete settings.details!.customFields!.enabled;
  result=analyzeWorkflow(doc,now);assert.equal(result.summary.cycle,2);
  assert.ok(result.issues.some(issue=>issue.nodeId==='a'&&issue.code==='condition-missing'));
  assert.deepEqual(traceNodes(doc,'a','upstream'),new Set(['b','settings']));
});

test('waived conditions do not override own checklist or source confirmation requirements',()=>{
  const a=resource('a'),b=resource('b',false),report=step('report');
  a.details!.customFields={scope:'no'};report.details!.checklist=[{id:'check',text:'검토',done:false}];
  const e=edge('a','report');e.condition={nodeId:'a',field:'scope',operator:'equals',value:'yes'};
  const f=edge('a','b');f.condition={...e.condition};
  const result=analyzeWorkflow(board([a,b,report],[e,f]),now);
  assert.equal(result.nodes.get('report')!.ready,false);assert.equal(result.nodes.get('b')!.ready,false);
});

test('condition field providers participate in impact tracing even without a regular connector',()=>{
  const settings=step('settings'),a=resource('a'),report=step('report'),finish=step('finish');
  settings.details!.customFields={market:'국내'};
  const e=edge('a','report');e.condition={nodeId:'settings',field:'market',operator:'equals',value:'수출'};
  const doc=board([settings,a,report,finish],[e,edge('report','finish')]);
  assert.deepEqual(traceNodes(doc,'settings','downstream'),new Set(['report','finish']));
  assert.deepEqual(traceNodes(doc,'finish','upstream'),new Set(['report','a','settings']));
  assert.equal(analyzeWorkflow(doc,now).nodes.get('finish')!.ready,true);
});
