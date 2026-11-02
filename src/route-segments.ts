import type {FlowDocument,FlowEdge,Point} from './types.ts';
import {edgePoints,distanceToSegment} from './geometry.ts';
import {projectVisibleDocument} from './organization.ts';
export interface RouteSegment {index:number;a:Point;b:Point}
const same=(a:Point,b:Point)=>Math.abs(a.x-b.x)<.001&&Math.abs(a.y-b.y)<.001;
/** Select only a safe portion outside endpoint shapes; never pin a port inside an obstacle. */
export function availableRouteSegments(doc:FlowDocument,edge:FlowEdge):RouteSegment[]{
 if(edge.style!=='elbow')return [];
 doc=projectVisibleDocument(doc);if(!doc.edges.includes(edge))return [];
 const path=edgePoints(edge,doc),padding=10+edge.width/2,segments:RouteSegment[]=[];
 const from=doc.nodes.find(n=>n.id===edge.from),to=doc.nodes.find(n=>n.id===edge.to);
 if(!from||!to)return [];
 const inside=(p:Point)=>doc.nodes.some(n=>n.kind!=='draw'&&p.x>n.x-padding&&p.x<n.x+n.w+padding&&p.y>n.y-padding&&p.y<n.y+(n.kind==='frame'?43:n.h)+padding);
 for(let i=0;i<path.length-1;i++){
  const start=path[i],end=path[i+1],length=Math.hypot(end.x-start.x,end.y-start.y);if(length<24)continue;
  const dx=(end.x-start.x)/length,dy=(end.y-start.y)/length;
  let trimStart=0,trimEnd=0;
  if(i===0)trimStart=dx>0?from.x+from.w+padding+1-start.x:dx<0?start.x-(from.x-padding-1):dy>0?from.y+from.h+padding+1-start.y:start.y-(from.y-padding-1);
  if(i===path.length-2)trimEnd=dx>0?end.x-(to.x-padding-1):dx<0?to.x+to.w+padding+1-end.x:dy>0?end.y-(to.y-padding-1):to.y+to.h+padding+1-end.y;
  trimStart=Math.max(0,trimStart);trimEnd=Math.max(0,trimEnd);if(length-trimStart-trimEnd<12)continue;
  const a={x:start.x+dx*trimStart,y:start.y+dy*trimStart},b={x:end.x-dx*trimEnd,y:end.y-dy*trimEnd};
  if(!inside(a)&&!inside(b))segments.push({index:i,a,b});
 }
 return segments;
}
export function fixedRouteSegments(edge:FlowEdge):RouteSegment[]{
 const points=edge.waypoints??[],result:RouteSegment[]=[];
 for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];if(!same(a,b)&&(a.x===b.x||a.y===b.y))result.push({index:i,a,b});}
 return result;
}
export function fixRouteSegment(doc:FlowDocument,edge:FlowEdge,index:number):void {
 const segment=availableRouteSegments(doc,edge).find(s=>s.index===index);if(!segment)throw new Error('고정할 구간을 다시 선택하세요.');
 doc=projectVisibleDocument(doc);
 const path=edgePoints(edge,doc),old=edge.waypoints,points=(old??[]).map(p=>({...p}));
 const additions=[segment.a,segment.b].filter(p=>!points.some(q=>same(p,q)));
 if(points.length+additions.length>32)throw new Error('경유점은 32개까지 사용할 수 있습니다. 다른 경유점을 지운 뒤 다시 고정하세요.');
 function progress(p:Point){let passed=0;for(let i=1;i<path.length;i++){if(distanceToSegment(p,path[i-1],path[i])<.01)return passed+Math.hypot(p.x-path[i-1].x,p.y-path[i-1].y);passed+=Math.hypot(path[i].x-path[i-1].x,path[i].y-path[i-1].y);}return passed;}
 points.push(...additions.map(p=>({...p})));points.sort((a,b)=>progress(a)-progress(b));edge.waypoints=points;
 if(!edgePoints(edge,doc).length){edge.waypoints=old;throw new Error('구간 양끝을 유지할 안전한 경로가 없습니다. 요소를 옮긴 뒤 다시 시도하세요.');}
}
export function releaseRouteSegment(edge:FlowEdge,waypointIndex:number):void {
 if(!fixedRouteSegments(edge).some(s=>s.index===waypointIndex))throw new Error('해제할 구간을 다시 선택하세요.');
 edge.waypoints=edge.waypoints!.filter((_,i)=>i!==waypointIndex&&i!==waypointIndex+1);
 if(!edge.waypoints.length)delete edge.waypoints;
}
