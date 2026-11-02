import type { FlowDocument, FlowNode } from './types.ts';
import { cloneDocument } from './model.ts';

export interface DocumentChange {
  kind: 'node'|'edge'|'asset'|'workspace'|'title';
  id: string;
  label: string;
  change: 'added'|'removed'|'changed';
  fields: string[];
}
export interface DocumentComparison {
  changes: DocumentChange[];
  counts: { added:number; removed:number; changed:number };
  same: boolean;
}
export interface PresentationStop {
  id:string;
  label:string;
  nodeIds:string[];
  viewport?:FlowDocument['viewport'];
  pageId?:string;
}

/** Validated document objects have bounded, acyclic schema depth. Compare leaves
 * directly so embedded image strings are not serialized into temporary copies. */
function equivalent(a:unknown,b:unknown):boolean {
  if (a===b) return true;
  if (a===null || b===null || typeof a!=='object' || typeof b!=='object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length!==b.length) return false;
    return a.every((value,index)=>equivalent(value,b[index]));
  }
  const aa=a as Record<string,unknown>,bb=b as Record<string,unknown>;
  const keys=new Set([...Object.keys(aa),...Object.keys(bb)]);
  for(const key of keys) if(!equivalent(aa[key],bb[key])) return false;
  return true;
}
function changedFields(a:object,b:object):string[] {
  const aa=a as Record<string,unknown>,bb=b as Record<string,unknown>;
  return [...new Set([...Object.keys(aa),...Object.keys(bb)])].filter(key=>!equivalent(aa[key],bb[key])).sort();
}
function label(node:FlowNode):string { return (node.text.split('\n')[0] || (node.kind==='image'?'이미지':'이름 없는 요소')).slice(0,120); }

/** Viewport-only changes never count as document edits. Element order does,
 * because it controls stacking, but additions alone do not count as reordering. */
export function compareDocuments(before:FlowDocument,after:FlowDocument):DocumentComparison {
  const changes:DocumentChange[]=[];
  function entities<T extends {id:string}>(kind:'node'|'edge'|'asset',oldItems:T[],newItems:T[],name:(item:T)=>string) {
    const oldMap=new Map(oldItems.map(item=>[item.id,item])),newMap=new Map(newItems.map(item=>[item.id,item]));
    for(const item of oldItems) {
      const next=newMap.get(item.id);
      if(!next)changes.push({kind,id:item.id,label:name(item),change:'removed',fields:[]});
      else {const fields=changedFields(item,next);if(fields.length)changes.push({kind,id:item.id,label:name(next),change:'changed',fields});}
    }
    for(const item of newItems)if(!oldMap.has(item.id))changes.push({kind,id:item.id,label:name(item),change:'added',fields:[]});
    if(kind!=='asset'){
      const oldOrder=oldItems.filter(item=>newMap.has(item.id)).map(item=>item.id);
      const newOrder=newItems.filter(item=>oldMap.has(item.id)).map(item=>item.id);
      if(!equivalent(oldOrder,newOrder))changes.push({kind:'workspace',id:`${kind}-order`,label:kind==='node'?'요소 표시 순서':'연결선 표시 순서',change:'changed',fields:[`${kind}s.order`]});
    }
  }
  entities('node',before.nodes,after.nodes,label);
  entities('edge',before.edges,after.edges,edge=>(edge.label || '이름 없는 연결선').slice(0,120));
  entities('asset',Object.values(before.assets),Object.values(after.assets),asset=>asset.name.slice(0,120));
  if(before.title!==after.title)changes.push({kind:'title',id:'title',label:'문서 이름',change:'changed',fields:['title']});
  if(!equivalent(before.workspace,after.workspace))changes.push({kind:'workspace',id:'workspace',label:'페이지·레이어·그룹·검토 기록',change:'changed',fields:changedFields(before.workspace??{},after.workspace??{})});
  const counts={added:0,removed:0,changed:0};for(const change of changes)counts[change.change]++;
  return {changes,counts,same:changes.length===0};
}

/** Call inside host.mutate after showing an explicit preview/apply action.
 * Returns false without touching the document if edits made the preview stale. */
export function applyComparedDocument(target:FlowDocument,incoming:FlowDocument,baseline:FlowDocument):boolean {
  if(!compareDocuments(baseline,target).same)return false;
  const viewport={...target.viewport},next=cloneDocument(incoming);
  // Object.assign alone would retain an old optional workspace absent in next.
  delete target.workspace;
  Object.assign(target,next,{viewport});
  return true;
}

/** Produces a finite, deterministic presentation sequence without recursion.
 * Bookmark mode uses saved order. Node mode follows dependencies, then lists
 * cyclic components in existing board order so no item is silently omitted. */
export function presentationStops(doc:FlowDocument,selection:Set<string>=new Set(),mode:'nodes'|'bookmarks'|'selection'='nodes'):PresentationStop[] {
  const nodeMap=new Map(doc.nodes.map(node=>[node.id,node]));
  if(mode==='bookmarks')return (doc.workspace?.bookmarks??[]).map(bookmark=>{
    const node=bookmark.nodeId?nodeMap.get(bookmark.nodeId):undefined;
    return {id:bookmark.id,label:bookmark.name,nodeIds:node?[node.id]:[],viewport:{...bookmark.viewport},...(node?.details?.pageId?{pageId:node.details.pageId}:{})};
  });
  const hidden=new Set(doc.workspace?.layers?.filter(layer=>layer.hidden).map(layer=>layer.id)??[]);
  const nodes=doc.nodes.filter(node=>node.kind!=='frame'&&node.kind!=='draw'&&!(node.details?.layerId&&hidden.has(node.details.layerId))&&(mode!=='selection'||selection.has(node.id)));
  const ids=new Set(nodes.map(node=>node.id)),order=new Map(nodes.map((node,index)=>[node.id,index]));
  const incoming=new Map(nodes.map(node=>[node.id,0])),outgoing=new Map(nodes.map(node=>[node.id,new Set<string>()]));
  for(const edge of doc.edges){
    if(!ids.has(edge.from)||!ids.has(edge.to)||edge.from===edge.to||edge.relation==='reference'||edge.relation==='optional')continue;
    const next=outgoing.get(edge.from)!;if(next.has(edge.to))continue;
    next.add(edge.to);incoming.set(edge.to,incoming.get(edge.to)!+1);
  }
  const ready=nodes.filter(node=>incoming.get(node.id)===0).map(node=>node.id),sequence:string[]=[];
  for(let index=0;index<ready.length;index++){
    const id=ready[index];sequence.push(id);
    const next=[...outgoing.get(id)!].sort((a,b)=>order.get(a)!-order.get(b)!);
    for(const target of next){const remaining=incoming.get(target)!-1;incoming.set(target,remaining);if(!remaining)ready.push(target);}
  }
  const seen=new Set(sequence);for(const node of nodes)if(!seen.has(node.id))sequence.push(node.id);
  return sequence.map(id=>{const node=nodeMap.get(id)!;return {id,label:label(node),nodeIds:[id],...(node.details?.pageId?{pageId:node.details.pageId}:{})};});
}
