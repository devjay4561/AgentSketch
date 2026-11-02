import test from 'node:test';
import assert from 'node:assert/strict';
import {createNode,emptyDocument,cloneDocument} from './model.ts';
import {computeLayout,applyLayout,layoutFingerprint} from './layout-engine.ts';
import type {LayoutMode} from './layout-engine.ts';
import type {FlowDocument,FlowNode} from './types.ts';
import type {NodeDetails} from './workspace-types.ts';

function fixture(){const d=emptyDocument();d.nodes=Array.from({length:7},(_,i)=>{const n=createNode('rect',i%3*80,Math.floor(i/3)*45);n.id=`n${i}`;n.w=140;n.h=80;return n;});
  for(const [i,[a,b]] of [[0,1],[0,2],[1,3],[2,3],[3,4],[4,5],[5,3]].entries())d.edges.push({id:`e${i}`,from:`n${a}`,to:`n${b}`,fromPort:'right',toPort:'left',label:'',color:'#888888',width:2,style:'elbow',dashed:false,arrow:'end'});return d;}
const collides=(a:FlowNode,b:FlowNode)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;

test('all layout modes are deterministic, cycle safe, nonmutating and produce separated nodes',()=>{
  for(const mode of ['horizontal','vertical','tree','radial','swimlane'] as LayoutMode[]){const doc=fixture(),before=JSON.stringify(doc);const first=computeLayout(doc,{mode});
    assert.equal(JSON.stringify(doc),before);assert.deepEqual(computeLayout(doc,{mode}),first);assert.equal(first.cycles,1);assert.equal(first.positions.length,7);
    applyLayout(doc,first);for(let i=0;i<doc.nodes.length;i++)for(let j=i+1;j<doc.nodes.length;j++)assert.equal(collides(doc.nodes[i],doc.nodes[j]),false,`${mode}: ${i}/${j}`);
  }
});

test('partial layout preserves unselected and locked group geometry and internal routes',()=>{
  const doc=fixture();doc.nodes[0].groupId=doc.nodes[1].groupId='pair';doc.nodes[1].x=doc.nodes[0].x+170;doc.nodes[2].locked=true;
  doc.edges[0].waypoints=[{x:155,y:-60}];const before=cloneDocument(doc);
  const plan=computeLayout(doc,{selection:['n0','n2','n3'],mode:'vertical'});applyLayout(doc,plan);
  const dx=doc.nodes[0].x-before.nodes[0].x,dy=doc.nodes[0].y-before.nodes[0].y;
  assert.equal(doc.nodes[1].x-before.nodes[1].x,dx);assert.equal(doc.nodes[1].y-before.nodes[1].y,dy);
  assert.deepEqual(doc.edges[0].waypoints,[{x:155+dx,y:-60+dy}]);
  for(const id of [2,4,5,6])assert.deepEqual(doc.nodes[id],before.nodes[id]);
});

test('preserve positions repairs overlaps without moving already separated nodes',()=>{
  const doc=fixture();doc.nodes=doc.nodes.slice(0,3);doc.edges=[];doc.nodes[0].x=0;doc.nodes[0].y=0;doc.nodes[1].x=500;doc.nodes[1].y=0;doc.nodes[2].x=10;doc.nodes[2].y=10;
  const plan=computeLayout(doc,{preservePositions:true});applyLayout(doc,plan);
  assert.equal(doc.nodes[0].x,0);assert.equal(doc.nodes[0].y,0);assert.equal(doc.nodes[1].x,500);assert.equal(doc.nodes[1].y,0);assert.ok(doc.nodes[2].y>=80);
});

test('swimlanes separate owners, and keeping manual paths leaves external guides intact',()=>{
  const doc=fixture();for(const [i,n] of doc.nodes.entries())(n as FlowNode&{details:NodeDetails}).details={owner:i%2?'기획팀':'영업팀'};
  doc.edges[0].waypoints=[{x:200,y:-100}];const plan=computeLayout(doc,{mode:'swimlane',keepManualRoutes:true});applyLayout(doc,plan);
  assert.equal(plan.lanes.length,2);assert.deepEqual(doc.edges[0].waypoints,[{x:200,y:-100}]);
  for(const lane of plan.lanes){const ownerNodes=doc.nodes.filter(n=>(n as FlowNode&{details:NodeDetails}).details.owner===lane.name);assert.ok(ownerNodes.every(n=>n.y>=lane.y));}
});

test('empty selection does not silently lay out the whole document and fingerprints detect constraints',()=>{
  const doc=fixture();assert.equal(computeLayout(doc,{selection:[]}).positions.length,0);const before=layoutFingerprint(doc);doc.nodes[0].locked=true;assert.notEqual(layoutFingerprint(doc),before);
});

test('a long dependency chain is handled without recursive traversal',()=>{
  const doc:FlowDocument=emptyDocument();for(let i=0;i<1500;i++){const n=createNode('rect',0,i*2);n.id=`n${i}`;doc.nodes.push(n);if(i)doc.edges.push({id:`e${i}`,from:`n${i-1}`,to:n.id,fromPort:'right',toPort:'left',label:'',color:'#888888',width:2,style:'elbow',dashed:false,arrow:'end'});}
  const plan=computeLayout(doc);assert.equal(plan.positions.length,1500);assert.equal(plan.cycles,0);assert.ok(plan.positions.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});

test('default-layer lock, hidden group members and other-page group members freeze the entire unit',()=>{
  for(const constraint of ['default-lock','hidden','other-page']){
    const doc=fixture();doc.nodes[0].groupId=doc.nodes[1].groupId='pair';
    doc.workspace={pages:[{id:'page-main',name:'기본'},{id:'page-other',name:'다른 페이지'}],activePageId:'page-main',layers:[{id:'layer-main',name:'기본',locked:constraint==='default-lock'},{id:'hidden',name:'숨김',hidden:true}]};
    if(constraint==='hidden')doc.nodes[1].details={layerId:'hidden'};
    if(constraint==='other-page')doc.nodes[1].details={pageId:'page-other'};
    const plan=computeLayout(doc,{selection:['n0','n2']});assert.ok(!plan.positions.some(p=>p.id==='n0'||p.id==='n1'));
    if(constraint==='default-lock')assert.equal(plan.positions.length,0);
  }
});

test('applying an older plan cannot move newly locked or hidden group members',()=>{
  const doc=fixture();doc.nodes[0].groupId=doc.nodes[1].groupId='pair';const plan=computeLayout(doc);const before=cloneDocument(doc);
  doc.nodes[1].locked=true;applyLayout(doc,plan);
  for(const i of [0,1]){assert.equal(doc.nodes[i].x,before.nodes[i].x);assert.equal(doc.nodes[i].y,before.nodes[i].y);}
});

test('common-row and common-column constraints retain spacing while avoiding locked obstacles',()=>{
  for(const alignment of ['row','column'] as const){const doc=fixture();doc.nodes[6].locked=true;const plan=computeLayout(doc,{alignment});applyLayout(doc,plan);
    const moving=doc.nodes.filter(n=>!n.locked);assert.ok(moving.every(n=>alignment==='row'?n.y===moving[0].y:n.x===moving[0].x));
    for(let i=0;i<doc.nodes.length;i++)for(let j=i+1;j<doc.nodes.length;j++)assert.equal(collides(doc.nodes[i],doc.nodes[j]),false);
  }
});
