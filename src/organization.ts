import type { Box, FlowDocument, FlowNode, Point } from './types.ts';
import type { WorkspaceData, WorkspaceGroup } from './workspace-types.ts';
import { bounds } from './geometry.ts';
import { cloneDocument, uid, validateDocument } from './model.ts';

export const DEFAULT_PAGE = 'page-main';
export const DEFAULT_LAYER = 'layer-main';

/** Upgrade legacy group IDs lazily; object identity and coordinates remain intact. */
export function ensureWorkspace(doc: FlowDocument): WorkspaceData {
  const workspace = doc.workspace ??= {};
  workspace.pages ??= [{ id: DEFAULT_PAGE, name: '기본 페이지' }];
  if (!workspace.pages.some(p => p.id === DEFAULT_PAGE)) workspace.pages.unshift({ id: DEFAULT_PAGE, name: '기본 페이지' });
  workspace.activePageId ??= DEFAULT_PAGE;
  workspace.layers ??= [{ id: DEFAULT_LAYER, name: '기본 레이어' }];
  if (!workspace.layers.some(l => l.id === DEFAULT_LAYER)) workspace.layers.unshift({ id: DEFAULT_LAYER, name: '기본 레이어' });
  workspace.groups ??= [];
  const known = new Set(workspace.groups.map(g => g.id));
  for (const node of doc.nodes) if (node.groupId && !known.has(node.groupId)) {
    workspace.groups.push({ id: node.groupId, name: `그룹 ${workspace.groups.length + 1}` }); known.add(node.groupId);
  }
  workspace.bookmarks ??= [];
  return workspace;
}

export function descendantGroups(doc: FlowDocument, groupId: string): Set<string> {
  const result = new Set([groupId]);
  const children = new Map<string, string[]>();
  for (const group of doc.workspace?.groups ?? []) if (group.parentId) {
    const list = children.get(group.parentId) ?? []; list.push(group.id); children.set(group.parentId, list);
  }
  const queue = [groupId];
  for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) ?? []) {
    if (!result.has(child)) { result.add(child); queue.push(child); }
  }
  return result;
}

export function groupMembers(doc: FlowDocument, groupId: string): FlowNode[] {
  const groups = descendantGroups(doc, groupId);
  return doc.nodes.filter(n => n.groupId && groups.has(n.groupId));
}

export function topGroupId(doc: FlowDocument, groupId: string): string {
  const groups = new Map((doc.workspace?.groups ?? []).map(g => [g.id, g]));
  const visited = new Set<string>(); let current = groupId;
  while (!visited.has(current)) {
    visited.add(current); const parent = groups.get(current)?.parentId;
    if (!parent) break; current = parent;
  }
  return current;
}

function pageOf(node: FlowNode): string { return node.details?.pageId ?? DEFAULT_PAGE; }
function onActivePage(doc: FlowDocument, node: FlowNode): boolean { return pageOf(node) === (doc.workspace?.activePageId ?? DEFAULT_PAGE); }

export function editableNodeIds(doc: FlowDocument): Set<string> {
  const layers = new Map((doc.workspace?.layers ?? []).map(l => [l.id, l]));
  const parents=new Map((doc.workspace?.groups??[]).map(g=>[g.id,g.parentId])),roots=new Map<string,string>();
  const root=(id:string)=>{
    const known=roots.get(id);if(known)return known;
    const path:string[]=[],seen=new Set<string>();let current=id;
    while(!seen.has(current)){seen.add(current);path.push(current);const cached=roots.get(current);if(cached){current=cached;break;}const parent=parents.get(current);if(!parent)break;current=parent;}
    for(const member of path)roots.set(member,current);return current;
  };
  const frozenGroups = new Set<string>();
  for (const node of doc.nodes) {
    const layer = layers.get(node.details?.layerId ?? DEFAULT_LAYER);
    if ((node.locked || layer?.locked) && node.groupId) frozenGroups.add(root(node.groupId));
  }
  return new Set(doc.nodes.filter(n => {
    const layer = layers.get(n.details?.layerId ?? DEFAULT_LAYER);
    return onActivePage(doc, n) && !n.locked && !layer?.locked && !layer?.hidden && !(n.groupId && frozenGroups.has(root(n.groupId)));
  }).map(n => n.id));
}

const projectedDocuments = new WeakMap<FlowDocument,FlowDocument>();
/** A transient view. Never save it: folded members remain in the source document. */
export function projectVisibleDocument(doc: FlowDocument): FlowDocument {
  const layers = new Map((doc.workspace?.layers ?? []).map((l,i) => [l.id, { ...l, order:i }]));
  const groups = new Map((doc.workspace?.groups ?? []).map(g => [g.id, g]));
  const eligible = doc.nodes.filter(n => onActivePage(doc,n) && !layers.get(n.details?.layerId ?? DEFAULT_LAYER)?.hidden);
  const folded = new Map<string, FlowNode[]>(), plain:FlowNode[] = [], mapping = new Map<string,string>(),foldedMembers=new Set<string>();
  for (const node of eligible) {
    let id=node.groupId, collapse:string|undefined; const seen = new Set<string>();
    while (id && !seen.has(id)) { seen.add(id); const group=groups.get(id); if(group?.collapsed)collapse=id; id=group?.parentId; }
    if (collapse) { const list=folded.get(collapse)??[];list.push(node);folded.set(collapse,list); }
    else { plain.push(node);mapping.set(node.id,node.id); }
  }
  for (const [id,members] of folded) {
    const box=bounds(members), representative=members[0];
    plain.push({ ...representative, id:representative.id, kind:'round', groupId:id, x:box.x, y:box.y, w:Math.min(280,Math.max(220,box.w)), h:90,
      text:`${groups.get(id)?.name || '그룹'}\n${members.length}개 요소 · 접힘`, assetId:undefined, points:undefined, crop:undefined,
      fill:'#fff0e5',stroke:'#e4a574',color:'#612b10',fontSize:15,align:'center',locked:members.some(n=>n.locked),rotation:0 });
    members.forEach(n=>{mapping.set(n.id,representative.id);foldedMembers.add(n.id);});
  }
  const order=new Map(doc.nodes.map((node,index)=>[node.id,index]));
  plain.sort((a,b)=>(layers.get(a.details?.layerId??DEFAULT_LAYER)?.order??0)-(layers.get(b.details?.layerId??DEFAULT_LAYER)?.order??0)||(order.get(a.id)??0)-(order.get(b.id)??0));
  const edges=doc.edges.flatMap(edge=>{
    const from=mapping.get(edge.from),to=mapping.get(edge.to);
    if(!from||!to||from===to)return [];
    return !foldedMembers.has(edge.from)&&!foldedMembers.has(edge.to) ? [edge] : [{...edge,from,to,waypoints:undefined,fromAnchor:undefined,toAnchor:undefined}];
  });
  let projected=projectedDocuments.get(doc);
  if(projected)Object.assign(projected,doc,{nodes:plain,edges});
  else {projected={...doc,nodes:plain,edges};projectedDocuments.set(doc,projected);}
  return projected;
}

export function setGroupParent(doc: FlowDocument, id: string, parentId?: string): void {
  const workspace=ensureWorkspace(doc),group=workspace.groups!.find(g=>g.id===id);
  if(!group)throw new Error('그룹을 찾을 수 없습니다.');
  if(parentId && (!workspace.groups!.some(g=>g.id===parentId)||descendantGroups(doc,id).has(parentId))) throw new Error('자기 자신이나 하위 그룹 안으로 넣을 수 없습니다.');
  if(parentId){
    const pages=new Set([...groupMembers(doc,id),...groupMembers(doc,parentId)].map(pageOf));
    if(pages.size>1)throw new Error('같은 페이지의 그룹끼리 묶으세요.');
    group.parentId=parentId;
  }else delete group.parentId;
}

export function createGroup(doc: FlowDocument, ids: Iterable<string>, name='새 그룹', parentId?: string): string {
  const workspace=ensureWorkspace(doc), selected=new Set(ids), selectedGroups=new Set<string>();
  for(const node of doc.nodes) if(selected.has(node.id)&&node.groupId) selectedGroups.add(topGroupId(doc,node.groupId));
  for(const group of selectedGroups) groupMembers(doc,group).forEach(n=>selected.add(n.id));
  const members=doc.nodes.filter(n=>selected.has(n.id));
  if(members.length<2)throw new Error('두 개 이상의 요소를 선택하세요.');
  if(new Set(members.map(pageOf)).size>1)throw new Error('같은 페이지의 요소끼리 묶으세요.');
  const editable=editableNodeIds(doc);if(members.some(n=>!editable.has(n.id)))throw new Error('잠기거나 숨겨진 요소는 그룹으로 묶을 수 없습니다.');
  if(parentId&&(!workspace.groups!.some(g=>g.id===parentId)||selectedGroups.has(parentId)))throw new Error('상위 그룹을 다시 선택하세요.');
  const id=uid(),group:WorkspaceGroup={id,name:name.trim().slice(0,200)||'새 그룹',...(parentId?{parentId}:{})};
  workspace.groups!.push(group);
  for(const child of workspace.groups!)if(selectedGroups.has(child.id))child.parentId=id;
  for(const node of members)if(!node.groupId)node.groupId=id;
  return id;
}

export function ungroup(doc: FlowDocument, id: string): void {
  const workspace=ensureWorkspace(doc),group=workspace.groups!.find(g=>g.id===id);if(!group)return;
  for(const child of workspace.groups!)if(child.parentId===id){if(group.parentId)child.parentId=group.parentId;else delete child.parentId;}
  for(const node of doc.nodes)if(node.groupId===id){if(group.parentId)node.groupId=group.parentId;else delete node.groupId;}
  workspace.groups=workspace.groups!.filter(g=>g.id!==id);
}

/** Alt-drop: move complete nested groups as a unit; move individually selected
 * members without destroying siblings. Dropping outside detaches from parent. */
export function reparentDroppedNodes(doc:FlowDocument, ids:Iterable<string>, targetGroupId?:string):void {
  const workspace=ensureWorkspace(doc),selected=new Set(ids),members=doc.nodes.filter(n=>selected.has(n.id));
  if(!members.length)return;
  const editable=editableNodeIds(doc);
  if(members.some(n=>!editable.has(n.id)))throw new Error('잠기거나 숨겨진 요소는 그룹 사이로 이동할 수 없습니다.');
  const active=workspace.activePageId??DEFAULT_PAGE;
  if(members.some(n=>pageOf(n)!==active))throw new Error('현재 페이지의 요소만 옮길 수 있습니다.');
  if(targetGroupId){
    if(!workspace.groups!.some(g=>g.id===targetGroupId))throw new Error('도착 그룹을 찾을 수 없습니다.');
    const targetMembers=groupMembers(doc,targetGroupId);
    if(targetMembers.some(n=>pageOf(n)!==active))throw new Error('다른 페이지의 그룹에는 넣을 수 없습니다.');
    if(targetMembers.some(n=>!editable.has(n.id)))throw new Error('잠기거나 숨겨진 요소가 있는 그룹에는 넣을 수 없습니다.');
  }
  const complete=new Set<string>();
  for(const group of workspace.groups!){const children=groupMembers(doc,group.id);if(children.length&&children.every(n=>selected.has(n.id)))complete.add(group.id);}
  const movedGroups=workspace.groups!.filter(g=>complete.has(g.id)&&!(g.parentId&&complete.has(g.parentId)));
  if(targetGroupId&&movedGroups.some(g=>descendantGroups(doc,g.id).has(targetGroupId)))throw new Error('그룹을 자기 자신이나 하위 그룹 안으로 넣을 수 없습니다.');
  const keptMembers=new Set(movedGroups.flatMap(g=>groupMembers(doc,g.id).map(n=>n.id)));
  for(const group of movedGroups){if(targetGroupId)group.parentId=targetGroupId;else delete group.parentId;}
  for(const node of members)if(!keptMembers.has(node.id)){if(targetGroupId)node.groupId=targetGroupId;else delete node.groupId;}
}

export function resizeGroup(doc: FlowDocument, id:string, scale:number): void {
  if(!Number.isFinite(scale)||scale<.1||scale>10)throw new Error('크기는 현재 크기의 10%에서 1000% 사이로 지정하세요.');
  const members=groupMembers(doc,id),editable=editableNodeIds(doc);
  if(members.some(n=>!editable.has(n.id)))throw new Error('잠기거나 숨겨진 요소가 있는 그룹은 크기를 바꿀 수 없습니다.');
  const box=bounds(members),keys=new Set(members.map(n=>n.id));
  if(members.some(n=>n.w*scale>100000||n.h*scale>100000||n.w*scale<1||n.h*scale<1||Math.abs(box.x+(n.x-box.x)*scale)>1000000||Math.abs(box.y+(n.y-box.y)*scale)>1000000))throw new Error('요소 위치나 크기가 허용 범위를 벗어납니다.');
  if(doc.edges.some(e=>keys.has(e.from)&&keys.has(e.to)&&e.waypoints?.some(p=>Math.abs(box.x+(p.x-box.x)*scale)>1000000||Math.abs(box.y+(p.y-box.y)*scale)>1000000)))throw new Error('연결선 경유점이 허용 범위를 벗어납니다.');
  for(const node of members){node.x=box.x+(node.x-box.x)*scale;node.y=box.y+(node.y-box.y)*scale;node.w*=scale;node.h*=scale;node.fontSize=Math.min(200,Math.max(6,node.fontSize*scale));if(node.points)node.points=node.points.map(p=>({x:p.x*scale,y:p.y*scale}));}
  for(const edge of doc.edges)if(keys.has(edge.from)&&keys.has(edge.to)&&edge.waypoints)edge.waypoints=edge.waypoints.map(p=>({x:box.x+(p.x-box.x)*scale,y:box.y+(p.y-box.y)*scale}));
}

export function addPage(doc:FlowDocument,name:string):string {
  const workspace=ensureWorkspace(doc);if(workspace.pages!.length>=100)throw new Error('페이지는 100개까지 사용할 수 있습니다.');
  const id=uid();workspace.pages!.push({id,name:name.trim().slice(0,200)||`페이지 ${workspace.pages!.length+1}`});return id;
}
export function moveToPage(doc:FlowDocument,ids:Iterable<string>,pageId:string):void {
  const workspace=ensureWorkspace(doc);if(!workspace.pages!.some(p=>p.id===pageId))throw new Error('페이지를 찾을 수 없습니다.');
  const selected=new Set(ids);
  for(const node of doc.nodes)if(selected.has(node.id)&&node.groupId)groupMembers(doc,topGroupId(doc,node.groupId)).forEach(n=>selected.add(n.id));
  const editable=editableNodeIds(doc);if(doc.nodes.some(n=>selected.has(n.id)&&!editable.has(n.id)))throw new Error('잠기거나 숨겨진 요소는 다른 페이지로 옮길 수 없습니다.');
  for(const node of doc.nodes)if(selected.has(node.id))node.details={...node.details,pageId};
}
export function removePage(doc:FlowDocument,id:string):void {
  if(id===DEFAULT_PAGE)throw new Error('기본 페이지는 삭제할 수 없습니다.');
  const workspace=ensureWorkspace(doc);for(const node of doc.nodes)if(node.details?.pageId===id)node.details.pageId=DEFAULT_PAGE;
  workspace.pages=workspace.pages!.filter(p=>p.id!==id);if(workspace.activePageId===id)workspace.activePageId=DEFAULT_PAGE;
}
export function addLayer(doc:FlowDocument,name:string):string {
  const workspace=ensureWorkspace(doc);if(workspace.layers!.length>=100)throw new Error('레이어는 100개까지 사용할 수 있습니다.');
  const id=uid();workspace.layers!.push({id,name:name.trim().slice(0,200)||`레이어 ${workspace.layers!.length+1}`});return id;
}
export function assignLayer(doc:FlowDocument,ids:Iterable<string>,layerId:string):void {
  layerId ||= DEFAULT_LAYER;
  const workspace=ensureWorkspace(doc);if(!workspace.layers!.some(l=>l.id===layerId))throw new Error('레이어를 찾을 수 없습니다.');
  const selected=new Set(ids),editable=editableNodeIds(doc);if(doc.nodes.some(n=>selected.has(n.id)&&!editable.has(n.id)))throw new Error('잠기거나 숨겨진 요소의 레이어는 바꿀 수 없습니다.');
  for(const node of doc.nodes)if(selected.has(node.id))node.details={...node.details,layerId};
}
export function removeLayer(doc:FlowDocument,id:string):void {
  if(id===DEFAULT_LAYER)throw new Error('기본 레이어는 삭제할 수 없습니다.');
  const workspace=ensureWorkspace(doc);for(const node of doc.nodes)if(node.details?.layerId===id)delete node.details.layerId;
  workspace.layers=workspace.layers!.filter(l=>l.id!==id);
}
export function addBookmark(doc:FlowDocument,name:string,nodeId?:string):string {
  const workspace=ensureWorkspace(doc);if(workspace.bookmarks!.length>=200)throw new Error('북마크는 200개까지 사용할 수 있습니다.');
  const id=uid();workspace.bookmarks!.push({id,name:name.trim().slice(0,200)||'저장한 보기',...(nodeId?{nodeId}:{}),viewport:{...doc.viewport}});return id;
}

export interface LibraryItem {id:string;name:string;createdAt:string;document:FlowDocument}
const LIBRARY_KEY='agentsketch.library.v1',LIBRARY_BYTES=5*1024*1024;
export function createLibraryItem(doc:FlowDocument,ids:Iterable<string>,name:string):LibraryItem {
  const selected=new Set(ids);for(const node of doc.nodes)if(selected.has(node.id)&&node.groupId)groupMembers(doc,topGroupId(doc,node.groupId)).forEach(n=>selected.add(n.id));
  if(!selected.size||selected.size>200)throw new Error('보관함에는 1개에서 200개의 요소를 한 묶음으로 저장할 수 있습니다.');
  const copy=cloneDocument(doc);copy.nodes=copy.nodes.filter(n=>selected.has(n.id));copy.edges=copy.edges.filter(e=>selected.has(e.from)&&selected.has(e.to));
  if(copy.edges.some(edge=>edge.condition&&!selected.has(edge.condition.nodeId)))throw new Error('연결 조건의 기준 요소도 함께 선택해서 보관하세요.');
  const assets=new Set(copy.nodes.map(n=>n.assetId));copy.assets=Object.fromEntries(Object.entries(copy.assets).filter(([id])=>assets.has(id)));
  const sourceGroups=new Map((copy.workspace?.groups??[]).map(g=>[g.id,g])),groups=new Set<string>();
  for(const node of copy.nodes){let id=node.groupId;while(id&&!groups.has(id)){groups.add(id);id=sourceGroups.get(id)?.parentId;}if(node.details){delete node.details.pageId;delete node.details.layerId;}}
  copy.workspace={groups:[...sourceGroups.values()].filter(g=>groups.has(g.id))};copy.title=name.trim().slice(0,200)||'저장한 묶음';
  if(new Blob([JSON.stringify(copy)]).size>LIBRARY_BYTES)throw new Error('묶음이 5MB를 넘습니다. 이미지를 줄이거나 파일로 보관하세요.');
  return {id:uid(),name:copy.title,createdAt:new Date().toISOString(),document:copy};
}
export function loadLibrary():LibraryItem[] {
  const raw=localStorage.getItem(LIBRARY_KEY);if(!raw)return [];
  if(raw.length>LIBRARY_BYTES*2)throw new Error('보관함 데이터가 허용 크기를 넘습니다.');
  const value:unknown=JSON.parse(raw);if(!Array.isArray(value)||value.length>20)throw new Error('보관함 데이터 형식이 올바르지 않습니다.');
  return value.map(item=>{if(!item||typeof item.id!=='string'||typeof item.name!=='string'||typeof item.createdAt!=='string')throw new Error('보관함 항목을 읽을 수 없습니다.');return {id:item.id,name:item.name.slice(0,200),createdAt:item.createdAt,document:validateDocument(item.document)};});
}
export function saveLibrary(items:LibraryItem[]):void {
  const data=JSON.stringify(items);if(items.length>20||new Blob([data]).size>LIBRARY_BYTES)throw new Error('보관함 한도는 20개 묶음, 총 5MB입니다. 사용하지 않는 묶음을 삭제하세요.');
  try{localStorage.setItem(LIBRARY_KEY,data);}catch{throw new Error('보관함 공간이 부족합니다. 문서 파일로 저장하거나 사용하지 않는 묶음을 삭제하세요.');}
}
export function insertLibraryItem(doc:FlowDocument,item:LibraryItem,at:Point):string[] {
  const source=validateDocument(item.document),workspace=ensureWorkspace(doc),box:Box=bounds(source.nodes);
  if(doc.nodes.length+source.nodes.length>10000||doc.edges.length+source.edges.length>30000)throw new Error('문서의 요소 또는 연결선 한도를 넘습니다.');
  const nodes=new Map(source.nodes.map(n=>[n.id,uid()])),groups=new Map((source.workspace?.groups??[]).map(g=>[g.id,uid()])),assets=new Map<string,string>();
  for(const node of source.nodes)if(node.groupId&&!groups.has(node.groupId))groups.set(node.groupId,uid());
  const dx=at.x-box.x,dy=at.y-box.y;
  const nextAssets={...doc.assets};
  for(const [id,asset] of Object.entries(source.assets)){const existing=Object.values(nextAssets).find(a=>a.data===asset.data);const next=existing?.id??uid();assets.set(id,next);if(!existing)nextAssets[next]={...asset,id:next};}
  const mapped=source.nodes.map(node=>({...node,id:nodes.get(node.id)!,x:node.x+dx,y:node.y+dy,locked:false,
    ...(node.groupId?{groupId:groups.get(node.groupId)}:{}),...(node.assetId?{assetId:assets.get(node.assetId)}:{}),details:{...node.details,pageId:workspace.activePageId,layerId:DEFAULT_LAYER}}));
  const nextGroups=[...workspace.groups!];
  for(const [id,next] of groups){const old=source.workspace?.groups?.find(g=>g.id===id);nextGroups.push({id:next,name:old?.name??item.name,...(old?.description?{description:old.description}:{}),...(old?.parentId&&groups.has(old.parentId)?{parentId:groups.get(old.parentId)}:{})});}
  const candidate:FlowDocument={...doc,workspace:{...workspace,groups:nextGroups},assets:nextAssets,nodes:[...doc.nodes,...mapped],edges:[...doc.edges,...source.edges.map(edge=>({...edge,id:uid(),from:nodes.get(edge.from)!,to:nodes.get(edge.to)!,...(edge.condition?{condition:{...edge.condition,nodeId:nodes.get(edge.condition.nodeId)!}}:{}),waypoints:edge.waypoints?.map(p=>({x:p.x+dx,y:p.y+dy}))}))]};
  validateDocument(candidate);
  doc.nodes=candidate.nodes;doc.edges=candidate.edges;doc.assets=nextAssets;doc.workspace=candidate.workspace;
  return mapped.map(n=>n.id);
}
