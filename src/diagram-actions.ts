import type { FlowDocument, FlowNode, Point, Port } from './types.ts';
import { createNode, DOCUMENT_LIMITS, uid } from './model.ts';
import { edgePoints, intersects } from './geometry.ts';
import { PALETTE } from './theme.ts';
import { editableNodeIds } from './organization.ts';

const locked = (doc:FlowDocument,node:FlowNode) => !editableNodeIds(doc).has(node.id);
function sparePosition(doc:FlowDocument,node:FlowNode):void {
  const initial=node.y;
  for(let i=0;i<400;i++){
    node.y=initial+i*(node.h+36);
    if(!doc.nodes.some(other=>other.kind!=='frame'&&(other.details?.pageId??'page-main')===(node.details?.pageId??'page-main')&&intersects({x:node.x-12,y:node.y-12,w:node.w+24,h:node.h+24},other)))return;
  }
  throw new Error('새 단계가 들어갈 공간을 찾지 못했습니다. 작업지를 정리한 뒤 다시 추가하세요.');
}
function reserve(doc:FlowDocument,nodes:number,edges:number){
  if(doc.nodes.length+nodes>DOCUMENT_LIMITS.nodes||doc.edges.length+edges>DOCUMENT_LIMITS.edges)throw new Error('문서의 요소 또는 연결 개수 한도를 넘습니다.');
}
function stepFrom(source:FlowNode,x:number,y:number):FlowNode {
  const kind=['image','draw','frame','text'].includes(source.kind)?'rect':source.kind;
  const node=createNode(kind,x,y);
  for(const key of ['fill','stroke','color','fontSize','bold','align','strokeWidth','dashed','opacity'] as const)Object.assign(node,{[key]:source[key]});
  node.w=source.kind==='frame'?220:Math.max(120,source.w);node.h=source.kind==='frame'?100:Math.max(72,source.h);
  node.text='다음 단계';
  node.details={role:'step',...(source.details?.owner?{owner:source.details.owner}:{}),...(source.details?.pageId?{pageId:source.details.pageId}:{}),...(source.details?.layerId?{layerId:source.details.layerId}:{})};
  return node;
}

/** Add a clean step; never inherit evidence, approval, checklist, assets or group IDs. */
export function addNextStep(doc:FlowDocument,nodeId:string):string {
  const source=doc.nodes.find(node=>node.id===nodeId);if(!source)throw new Error('시작 요소를 찾을 수 없습니다.');
  if(locked(doc,source))throw new Error('잠긴 요소의 잠금을 해제한 뒤 다음 단계를 추가하세요.');
  reserve(doc,1,1);
  const node=stepFrom(source,source.x+source.w+120,source.y);sparePosition(doc,node);
  if(Math.abs(node.x)>DOCUMENT_LIMITS.coordinate||Math.abs(node.y)>DOCUMENT_LIMITS.coordinate)throw new Error('작업지 좌표 범위를 벗어납니다.');
  doc.nodes.push(node);doc.edges.push({id:uid(),from:source.id,to:node.id,fromPort:'right',toPort:'left',label:'',color:PALETTE.line,width:2,style:'elbow',dashed:false,arrow:'end',relation:'required'});
  return node.id;
}
function midpoint(points:Point[]):Point {
  if(!points.length)return {x:0,y:0};
  const lengths=points.slice(1).map((point,i)=>Math.hypot(point.x-points[i].x,point.y-points[i].y));
  let remaining=lengths.reduce((sum,length)=>sum+length,0)/2;
  for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]){const ratio=lengths[i]?remaining/lengths[i]:0;return {x:points[i].x+(points[i+1].x-points[i].x)*ratio,y:points[i].y+(points[i+1].y-points[i].y)*ratio};}remaining-=lengths[i];}
  return points.at(-1)!;
}
function facing(node:FlowNode,toward:FlowNode):Port {
  const dx=toward.x+toward.w/2-node.x-node.w/2,dy=toward.y+toward.h/2-node.y-node.h/2;
  return Math.abs(dx)>=Math.abs(dy)?dx>=0?'right':'left':dy>=0?'bottom':'top';
}

/** Keep the first edge identity/label and insert a second edge. Manual routes reset. */
export function splitConnection(doc:FlowDocument,edgeId:string,existingNodeId?:string):string {
  const index=doc.edges.findIndex(edge=>edge.id===edgeId),edge=doc.edges[index];
  if(!edge)throw new Error('연결선을 찾을 수 없습니다.');
  const source=doc.nodes.find(n=>n.id===edge.from),target=doc.nodes.find(n=>n.id===edge.to);if(!source||!target)throw new Error('연결 대상이 없습니다.');
  if(existingNodeId===edge.from||existingNodeId===edge.to)throw new Error('연결 끝점은 중간 단계로 넣을 수 없습니다.');
  reserve(doc,existingNodeId?0:1,1);
  let node=existingNodeId?doc.nodes.find(n=>n.id===existingNodeId):undefined;
  if(existingNodeId&&!node)throw new Error('삽입할 요소를 찾을 수 없습니다.');
  if(node&&locked(doc,node))throw new Error('잠긴 요소는 삽입할 수 없습니다.');
  if(!node){
    const path=edgePoints(edge,doc),at=path.length?midpoint(path):{x:(source.x+source.w/2+target.x+target.w/2)/2,y:(source.y+source.h/2+target.y+target.h/2)/2};
    node=stepFrom(source,at.x-110,at.y-50);node.w=220;node.h=100;node.text='중간 단계';sparePosition(doc,node);
    if(Math.abs(node.x)>DOCUMENT_LIMITS.coordinate||Math.abs(node.y)>DOCUMENT_LIMITS.coordinate)throw new Error('작업지 좌표 범위를 벗어납니다.');
  }
  if(doc.edges.some(other=>other.id!==edge.id&&((other.from===source.id&&other.to===node!.id)||(other.from===node!.id&&other.to===target.id))))throw new Error('삽입 후 같은 방향의 중복 연결이 생깁니다. 기존 연결을 확인하세요.');
  const first={...edge,to:node.id,toPort:facing(node,source),toAnchor:undefined,waypoints:undefined};
  const second={...edge,id:uid(),from:node.id,fromPort:facing(node,target),fromAnchor:undefined,label:'',labelPosition:undefined,waypoints:undefined};
  if(!existingNodeId)doc.nodes.push(node);doc.edges.splice(index,1,first,second);return node.id;
}
