import type { Box, FlowDocument, FlowNode, Point, Port } from './types.ts';
import type { NodeDetails, WorkspaceData } from './workspace-types.ts';
import { bounds } from './geometry.ts';
import {editableNodeIds, groupMembers, topGroupId} from './organization.ts';

export type LayoutMode = 'horizontal' | 'vertical' | 'tree' | 'radial' | 'swimlane';
export interface LayoutOptions { mode?: LayoutMode; gap?: number; selection?: string[]; preservePositions?: boolean; keepManualRoutes?: boolean; alignment?:'none'|'row'|'column'; reverseOrder?:boolean }
export interface LayoutPlan {
  positions: { id: string; x: number; y: number }[];
  edges: { id: string; fromPort: Port; toPort: Port; waypoints?: Point[] }[];
  warnings: string[]; cycles: number; moved: number; mode: LayoutMode;
  lanes: { name: string; y: number; h: number }[];
}
interface Unit extends Box { id: string; members: FlowNode[]; locked: boolean; moving: boolean; owner: string; rank: number }
const details = (n: FlowNode) => (n as FlowNode & { details?: NodeDetails }).details;
const workspace = (d: FlowDocument) => (d as FlowDocument & {workspace?: WorkspaceData}).workspace;
const overlaps = (a: Box,b: Box,gap=0) => a.x < b.x+b.w+gap && a.x+a.w+gap > b.x && a.y < b.y+b.h+gap && a.y+a.h+gap > b.y;

/** Only positions and routes leave the planner; image payloads and metadata remain shared. */
export function computeLayout(doc: FlowDocument, options: LayoutOptions = {}): LayoutPlan {
  const mode=options.mode??'horizontal', gap=Math.min(300,Math.max(20,options.gap??64));
  const plan:LayoutPlan={positions:[],edges:[],warnings:[],cycles:0,moved:0,mode,lanes:[]};
  const selected=options.selection?new Set(options.selection):undefined;
  const ws=workspace(doc), parents=new Map((ws?.groups??[]).map(g=>[g.id,g.parentId]));
  const groupRoot=(id:string) => { const seen=new Set<string>(); while(parents.get(id)&&!seen.has(id)){seen.add(id);id=parents.get(id)!;}return id; };
  const groups=new Map<string,FlowNode[]>(), nodeUnits=new Map<string,string>();
  const editable=editableNodeIds(doc);
  for(const n of doc.nodes){
    const key=n.groupId?`group:${groupRoot(n.groupId)}`:`node:${n.id}`;
    const group=groups.get(key)??[];group.push(n);groups.set(key,group);nodeUnits.set(n.id,key);
  }
  const units:Unit[]=[...groups].map(([id,members])=>({id,members,...bounds(members),rank:0,
    locked:members.some(n=>!editable.has(n.id)),
    moving: selected?members.some(n=>selected.has(n.id)):members.some(n=>n.groupId||!['frame','text','draw'].includes(n.kind)),
    owner:members.map(n=>details(n)?.owner?.trim()).find(Boolean)??'담당 미지정'}));
  const movable=units.filter(u=>u.moving&&!u.locked), byId=new Map(movable.map(u=>[u.id,u]));
  if(!movable.length){plan.warnings.push('배치할 잠기지 않은 요소가 없습니다.');return plan;}
  const adjacency=new Map(movable.map(u=>[u.id,new Set<string>()])), reverse=new Map(movable.map(u=>[u.id,new Set<string>()]));
  const selfLoops=new Set<string>();
  for(const edge of doc.edges){const from=nodeUnits.get(edge.from)!,to=nodeUnits.get(edge.to)!;
    if(!byId.has(from)||!byId.has(to))continue;
    if(from===to){if(edge.from===edge.to)selfLoops.add(from);continue;}
    adjacency.get(from)!.add(to);reverse.get(to)!.add(from);
  }
  // Iterative SCC decomposition keeps cycles finite and long chains off the JS stack.
  const seen=new Set<string>(), order:string[]=[];
  for(const u of movable){if(seen.has(u.id))continue;const stack:[string,boolean][]=[[u.id,false]];
    while(stack.length){const [id,done]=stack.pop()!;if(done){order.push(id);continue;}if(seen.has(id))continue;seen.add(id);stack.push([id,true]);for(const next of adjacency.get(id)!)if(!seen.has(next))stack.push([next,false]);}}
  const component=new Map<string,number>(), components:string[][]=[];
  for(const id of order.reverse()){if(component.has(id))continue;const index=components.length, group:string[]=[],stack=[id];component.set(id,index);
    while(stack.length){const key=stack.pop()!;group.push(key);for(const next of reverse.get(key)!)if(!component.has(next)){component.set(next,index);stack.push(next);}}components.push(group);}
  plan.cycles=components.filter(c=>c.length>1||selfLoops.has(c[0])).length;
  if(plan.cycles)plan.warnings.push(`순환 관계 ${plan.cycles}개를 같은 단계에 배치했습니다.`);
  const graph=components.map(()=>new Set<number>()), indegree=components.map(()=>0), ranks=components.map(()=>0);
  for(const [from,targets] of adjacency)for(const to of targets){const a=component.get(from)!,b=component.get(to)!;if(a!==b&&!graph[a].has(b)){graph[a].add(b);indegree[b]++;}}
  const queue=indegree.flatMap((v,i)=>v===0?[i]:[]);
  for(let i=0;i<queue.length;i++)for(const next of graph[queue[i]]){ranks[next]=Math.max(ranks[next],ranks[queue[i]]+1);if(--indegree[next]===0)queue.push(next);}
  for(const u of movable)u.rank=ranks[component.get(u.id)!];
  const vertical=mode==='vertical'||mode==='tree', cross=vertical?'x':'y';
  const levels=new Map<number,Unit[]>();for(const u of movable){const level=levels.get(u.rank)??[];level.push(u);levels.set(u.rank,level);}
  const ordered=[...levels.keys()].sort((a,b)=>a-b);
  for(const level of levels.values())level.sort((a,b)=>a[cross]-b[cross]||a.id.localeCompare(b.id));
  // Alternating barycentre sweeps reduce crossings while deterministic tie breaks preserve order.
  for(let pass=0;pass<4;pass++){
    const position=new Map<string,number>();for(const level of levels.values())level.forEach((u,i)=>position.set(u.id,i));
    for(const rank of pass%2?[...ordered].reverse():ordered){const level=levels.get(rank)!;
      const score=(u:Unit)=>{const neighbours=[...(pass%2?adjacency:reverse).get(u.id)!].filter(id=>byId.get(id)!.rank!==u.rank);return neighbours.length?neighbours.reduce((sum,id)=>sum+position.get(id)!,0)/neighbours.length:position.get(u.id)!;};
      const scores=new Map(level.map(u=>[u.id,score(u)]));level.sort((a,b)=>scores.get(a.id)!-scores.get(b.id)!||position.get(a.id)!-position.get(b.id)!);level.forEach((u,i)=>position.set(u.id,i));
    }
  }
  if(options.reverseOrder)for(const level of levels.values())level.reverse();
  const origin=bounds(movable), target=new Map<string,Point>();
  if(mode==='radial'){
    let radius=0;const cx=origin.x+origin.w/2,cy=origin.y+origin.h/2;
    for(const rank of ordered){const level=levels.get(rank)!,largest=Math.max(...level.map(u=>Math.hypot(u.w,u.h))), circumference=level.reduce((sum,u)=>sum+Math.hypot(u.w,u.h)+gap,0);
      if(rank>0||level.length>1)radius=Math.max(radius+largest+gap,circumference/(2*Math.PI));
      level.forEach((u,i)=>{const angle=-Math.PI/2+i*Math.PI*2/level.length;target.set(u.id,{x:cx+Math.cos(angle)*radius-u.w/2,y:cy+Math.sin(angle)*radius-u.h/2});});
    }
  }else if(mode==='swimlane'){
    const owners=[...new Set(movable.map(u=>u.owner))].sort((a,b)=>a.localeCompare(b));
    const columns=new Map<number,number>();let x=origin.x;for(const rank of ordered){columns.set(rank,x);x+=Math.max(...levels.get(rank)!.map(u=>u.w))+gap*2;}
    let y=origin.y;
    for(const owner of owners){let height=0;for(const rank of ordered){let yy=y;for(const u of levels.get(rank)!.filter(u=>u.owner===owner)){target.set(u.id,{x:columns.get(rank)!,y:yy});yy+=u.h+gap;}height=Math.max(height,yy-y);}
      height=Math.max(height,gap);plan.lanes.push({name:owner,y:y-gap/2,h:height});y+=height+gap;}
  }else{
    const widths=ordered.map(rank=>Math.max(...levels.get(rank)!.map(u=>vertical?u.h:u.w)));
    const crossExtents=ordered.map(rank=>levels.get(rank)!.reduce((sum,u)=>sum+(vertical?u.w:u.h)+gap,0)-gap), maxCross=Math.max(...crossExtents);
    let along=vertical?origin.y:origin.x;
    ordered.forEach((rank,i)=>{let across=(vertical?origin.x:origin.y)+(mode==='tree'?(maxCross-crossExtents[i])/2:0);for(const u of levels.get(rank)!){target.set(u.id,vertical?{x:across,y:along}:{x:along,y:across});across+=(vertical?u.w:u.h)+gap;}along+=widths[i]+gap*2;});
  }
  // Unconnected items form a readable grid instead of an arbitrarily tall column.
  const isolated=movable.filter(u=>!adjacency.get(u.id)!.size&&!reverse.get(u.id)!.size);
  if(isolated.length>3&&mode!=='radial'&&mode!=='swimlane'){
    const isolatedIds=new Set(isolated.map(u=>u.id)),connected=movable.filter(u=>!isolatedIds.has(u.id));
    const columns=Math.ceil(Math.sqrt(isolated.length)),width=Math.max(...isolated.map(u=>u.w))+gap,height=Math.max(...isolated.map(u=>u.h))+gap;
    const startY=connected.length?Math.max(...connected.map(u=>target.get(u.id)!.y+u.h))+gap*2:origin.y;
    isolated.forEach((u,i)=>target.set(u.id,{x:origin.x+(i%columns)*width,y:startY+Math.floor(i/columns)*height}));
  }
  if(options.alignment==='row'||options.alignment==='column'){
    let cursor=options.alignment==='row'?origin.x:origin.y;
    for(const rank of ordered)for(const u of levels.get(rank)!){target.set(u.id,options.alignment==='row'?{x:cursor,y:origin.y}:{x:origin.x,y:cursor});cursor+=(options.alignment==='row'?u.w:u.h)+gap;}
  }
  // Sparse buckets for obstacles; large frames are represented separately to bound grid size.
  const cell=400,buckets=new Map<string,Box[]>(),large:Box[]=[];
  const cells=(b:Box)=>{const x0=Math.floor(b.x/cell),x1=Math.floor((b.x+b.w)/cell),y0=Math.floor(b.y/cell),y1=Math.floor((b.y+b.h)/cell);if((x1-x0+1)*(y1-y0+1)>100)return null;const keys:string[]=[];for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)keys.push(`${x}:${y}`);return keys;};
  const add=(b:Box)=>{const keys=cells(b);if(!keys){large.push(b);return;}for(const key of keys){const list=buckets.get(key)??[];list.push(b);buckets.set(key,list);}};
  const conflicts=(b:Box)=>{const keys=cells({x:b.x-gap/2,y:b.y-gap/2,w:b.w+gap,h:b.h+gap});const candidates=new Set<Box>(large);if(keys)for(const key of keys)for(const item of buckets.get(key)??[])candidates.add(item);else for(const list of buckets.values())for(const item of list)candidates.add(item);return [...candidates].filter(item=>overlaps(b,item,gap/2));};
  // Frame backgrounds may contain the very nodes being arranged: only their heading is solid.
  for(const u of units.filter(u=>!u.moving||u.locked))add(u.members.length===1&&u.members[0].kind==='frame'?{...u,h:43}:u);
  let repaired=0;
  for(const u of [...movable].sort((a,b)=>a.rank-b.rank||a[cross]-b[cross])){
    let p=options.preservePositions&&!['row','column'].includes(options.alignment??'none')?{x:u.x,y:u.y}:target.get(u.id)!;
    let box={...p,w:u.w,h:u.h},found=conflicts(box),attempts=0;
    while(found.length&&attempts++<units.length+1){if(options.alignment==='row'||(vertical&&options.alignment!=='column'))box.x=Math.max(...found.map(b=>b.x+b.w))+gap;else box.y=Math.max(...found.map(b=>b.y+b.h))+gap;found=conflicts(box);}
    if(attempts)repaired++;if(found.length)plan.warnings.push('고정 요소 주변의 빈 공간을 확보하지 못한 항목이 있습니다.');
    if(Math.abs(box.x)>1_000_000||Math.abs(box.y)>1_000_000){plan.warnings.push('문서 좌표 범위를 넘는 배치를 제외했습니다. 간격이나 범위를 줄이세요.');box={x:u.x,y:u.y,w:u.w,h:u.h};}
    add(box);target.set(u.id,{x:box.x,y:box.y});
    for(const n of u.members){const x=n.x+box.x-u.x,y=n.y+box.y-u.y;plan.positions.push({id:n.id,x,y});if(x!==n.x||y!==n.y)plan.moved++;}
  }
  if(repaired)plan.warnings.push(`${repaired}개 묶음의 간격을 조정해 고정·주변 요소와 겹침을 줄였습니다.`);
  for(const edge of doc.edges){const from=nodeUnits.get(edge.from)!,to=nodeUnits.get(edge.to)!,a=byId.get(from),b=byId.get(to);
    if(!a&&!b)continue;
    if(from===to&&a){const p=target.get(from)!;plan.edges.push({id:edge.id,fromPort:edge.fromPort,toPort:edge.toPort,waypoints:edge.waypoints?.map(q=>({x:q.x+p.x-a.x,y:q.y+p.y-a.y}))});}
    else if(options.keepManualRoutes)continue;
    else { const ap=a?target.get(from):undefined,bp=b?target.get(to):undefined;
      if((!a||ap?.x===a.x&&ap?.y===a.y)&&(!b||bp?.x===b.x&&bp?.y===b.y))continue;
      plan.edges.push({id:edge.id,fromPort:a?(vertical?'bottom':'right'):edge.fromPort,toPort:b?(vertical?'top':'left'):edge.toPort});
    }
  }
  return plan;
}

export function applyLayout(doc:FlowDocument,plan:LayoutPlan):void {
  const editable=editableNodeIds(doc),groups=new Map<string,boolean>(),applied=new Set<string>();
  const nodes=new Map(doc.nodes.map(n=>[n.id,n]));for(const p of plan.positions){const n=nodes.get(p.id);if(!n||!editable.has(n.id))continue;
    if(n.groupId){const root=topGroupId(doc,n.groupId);if(!groups.has(root))groups.set(root,groupMembers(doc,root).every(member=>editable.has(member.id)));if(!groups.get(root))continue;}
    n.x=p.x;n.y=p.y;applied.add(n.id);
  }
  const edges=new Map(doc.edges.map(e=>[e.id,e]));for(const p of plan.edges){const e=edges.get(p.id);if(e&&(applied.has(e.from)||applied.has(e.to))){e.fromPort=p.fromPort;e.toPort=p.toPort;if(p.waypoints)e.waypoints=p.waypoints.map(q=>({...q}));else delete e.waypoints;}}
}

export function layoutFingerprint(doc:FlowDocument):string {
  return JSON.stringify([doc.nodes.map(n=>[n.id,n.x,n.y,n.w,n.h,n.locked,n.groupId,details(n)?.owner,details(n)?.pageId,details(n)?.layerId]),doc.edges.map(e=>[e.id,e.from,e.to,e.fromPort,e.toPort,e.waypoints]),workspace(doc)?.groups,workspace(doc)?.layers,workspace(doc)?.activePageId]);
}
