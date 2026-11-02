import {route, clearSegment, simplify} from './routing.ts';
import type { Box, FlowDocument, FlowEdge, FlowNode, Point, Port } from './types.ts';

export function bounds(nodes: readonly Box[]): Box {
  if (!nodes.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const node of nodes) {
    x = Math.min(x, node.x); y = Math.min(y, node.y);
    right = Math.max(right, node.x + node.w); bottom = Math.max(bottom, node.y + node.h);
  }
  return { x, y, w: right - x, h: bottom - y };
}

export function intersects(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function contains(point: Point, node: FlowNode): boolean {
  const dx = point.x - node.x, dy = point.y - node.y;
  if (node.kind === 'draw' && node.points?.length) {
    const p = { x: dx, y: dy };
    for (let i = 1; i < node.points.length; i++) {
      if (distanceToSegment(p, node.points[i - 1], node.points[i]) <= Math.max(5, node.strokeWidth * 2)) return true;
    }
    return node.points.length === 1 && Math.hypot(dx - node.points[0].x, dy - node.points[0].y) <= 5;
  }
  if (dx < 0 || dy < 0 || dx > node.w || dy > node.h) return false;
  if (node.kind === 'ellipse') return ((dx - node.w / 2) / (node.w / 2)) ** 2 + ((dy - node.h / 2) / (node.h / 2)) ** 2 <= 1;
  if (node.kind === 'diamond') return Math.abs((dx - node.w / 2) / (node.w / 2)) + Math.abs((dy - node.h / 2) / (node.h / 2)) <= 1;
  return true;
}

export function portPoint(node: Box, port: Port): Point {
  switch (port) {
    case 'top': return { x: node.x + node.w / 2, y: node.y };
    case 'right': return { x: node.x + node.w, y: node.y + node.h / 2 };
    case 'bottom': return { x: node.x + node.w / 2, y: node.y + node.h };
    case 'left': return { x: node.x, y: node.y + node.h / 2 };
  }
}

/** Project a normalized custom anchor onto the requested side of a shape. */
export function connectionPoint(node: Box & {kind?:FlowNode['kind']}, port: Port, anchor?: Point): Point {
  if (!anchor) return portPoint(node, port);
  const x=Math.max(0,Math.min(1,anchor.x)),y=Math.max(0,Math.min(1,anchor.y));
  const curved=node.kind==='ellipse'||node.kind==='diamond';
  if(curved){const span=(offset:number)=>node.kind==='ellipse'?Math.sqrt(Math.max(0,1-(offset*2-1)**2)):1-Math.abs(offset*2-1);
    return port==='left'||port==='right'?{x:node.x+node.w/2+(port==='right'?1:-1)*node.w/2*span(y),y:node.y+node.h*y}:{x:node.x+node.w*x,y:node.y+node.h/2+(port==='bottom'?1:-1)*node.h/2*span(x)};
  }
  return port==='left'?{x:node.x,y:node.y+node.h*y}:port==='right'?{x:node.x+node.w,y:node.y+node.h*y}:port==='top'?{x:node.x+node.w*x,y:node.y}:{x:node.x+node.w*x,y:node.y+node.h};
}

const vectors: Record<Port, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

type CachedRoute = {points:Point[];from:string;to:string;padding:number};
type Geometry = Box & {kind:FlowNode['kind']};
const routeCaches = new WeakMap<FlowDocument,{signature:string;nodes:Map<string,Geometry>;paths:Map<string,CachedRoute>}>();
type Lanes = Map<string,{from:number;to:number}>;
const batches = new WeakMap<ReadonlyMap<string,FlowNode>,{signature:string;lanes:Lanes}>();
const geometryKey=(doc:FlowDocument)=>doc.nodes.map(n=>`${n.id}:${n.x},${n.y},${n.w},${n.h},${n.kind}`).join('|');
function routeLanes(doc:FlowDocument):Lanes {
  const lanes:Lanes=new Map(),groups=new Map<string,FlowEdge[]>();
  for(const edge of doc.edges){
    if(edge.style!=='elbow'||edge.waypoints?.length)continue;
    lanes.set(edge.id,{from:0,to:0});
    for(const end of ['from','to'] as const){
      if(edge[end==='from'?'fromAnchor':'toAnchor'])continue;
      const key=`${end}:${edge[end]}:${edge[end==='from'?'fromPort':'toPort']}`;
      const group=groups.get(key)??[];group.push(edge);groups.set(key,group);
    }
  }
  for(const [key,group] of groups){if(group.length<2)continue;const end=key.startsWith('from:')?'from':'to';group.forEach((edge,i)=>{lanes.get(edge.id)![end]=Math.max(-96,Math.min(96,(i-(group.length-1)/2)*12));});}
  return lanes;
}
export function prepareRoutes(doc:FlowDocument,index:ReadonlyMap<string,FlowNode>){batches.set(index,{signature:geometryKey(doc),lanes:routeLanes(doc)});}

export function edgePoints(edge: FlowEdge, doc: FlowDocument, nodeIndex?: ReadonlyMap<string, FlowNode>): Point[] {
  const from = nodeIndex ? nodeIndex.get(edge.from) : doc.nodes.find(n => n.id === edge.from);
  const to = nodeIndex ? nodeIndex.get(edge.to) : doc.nodes.find(n => n.id === edge.to);
  if (!from || !to) return [];
  const a = connectionPoint(from, edge.fromPort, edge.fromAnchor), b = connectionPoint(to, edge.toPort, edge.toAnchor);
  if (edge.style === 'straight') return [a, b];
  const va = vectors[edge.fromPort], vb = vectors[edge.toPort];
  if (edge.style === 'curve') {
    const length = Math.max(45, Math.min(220, Math.hypot(b.x - a.x, b.y - a.y) * .45));
    const c1 = { x: a.x + va.x * length, y: a.y + va.y * length };
    const c2 = { x: b.x + vb.x * length, y: b.y + vb.y * length };
    return Array.from({ length: 25 }, (_, i) => {
      const t = i / 24, q = 1 - t;
      return { x: q ** 3 * a.x + 3 * q ** 2 * t * c1.x + 3 * q * t ** 2 * c2.x + t ** 3 * b.x, y: q ** 3 * a.y + 3 * q ** 2 * t * c1.y + 3 * q * t ** 2 * c2.y + t ** 3 * b.y };
    });
  }
  const prepared=nodeIndex?batches.get(nodeIndex):undefined;
  const signature = prepared?.signature ?? geometryKey(doc);
  const lane=(prepared?.lanes??routeLanes(doc)).get(edge.id)??{from:0,to:0};
  let cached = routeCaches.get(doc);
  if(!cached || cached.signature!==signature) {
    const nodes=new Map(doc.nodes.map(n=>[n.id,{x:n.x,y:n.y,w:n.w,h:n.h,kind:n.kind}]));
    if(cached){
      const changed=new Set<string>(), boxes:Geometry[]=[];
      for(const id of new Set([...nodes.keys(),...cached.nodes.keys()])){
        const a=cached.nodes.get(id),b=nodes.get(id);
        if(a&&b&&a.x===b.x&&a.y===b.y&&a.w===b.w&&a.h===b.h&&a.kind===b.kind)continue;
        changed.add(id);if(a)boxes.push(a);if(b)boxes.push(b);
      }
      // Moving one element only invalidates connections touching its old/new bounds.
      // Large layout changes are cheaper to rebuild than to compare every segment.
      if(changed.size>20)cached.paths.clear();
      else for(const [key,path] of cached.paths){
        if(!path.points.length||changed.has(path.from)||changed.has(path.to)||boxes.some(box=>{
          if(box.kind==='draw')return false;
          const p=path.padding,area={x:box.x-p,y:box.y-p,w:box.w+p*2,h:(box.kind==='frame'?43:box.h)+p*2};
          return path.points.some((b,i)=>i>0&&intersects(area,{x:Math.min(path.points[i-1].x,b.x),y:Math.min(path.points[i-1].y,b.y),w:Math.abs(path.points[i-1].x-b.x),h:Math.abs(path.points[i-1].y-b.y)}));
        }))cached.paths.delete(key);
      }
      cached.signature=signature;cached.nodes=nodes;
    }else {cached={signature,nodes,paths:new Map()};routeCaches.set(doc,cached);}
  }
  const key=JSON.stringify([edge.from,edge.to,edge.fromPort,edge.toPort,edge.fromAnchor,edge.toAnchor,edge.width,edge.waypoints,lane.from,lane.to]);
  const previous=cached.paths.get(key);if(previous)return previous.points;
  const padding=10+edge.width/2;
  const obstacles=doc.nodes.filter(n=>n.kind!=='draw').map(n=>({x:n.x-padding,y:n.y-padding,w:n.w+padding*2,h:(n.kind==='frame'?43:n.h)+padding*2}));
  const stub=(node:Box,p:Point,v:Point)=>({x:v.x<0?node.x-padding-8:v.x>0?node.x+node.w+padding+8:p.x,y:v.y<0?node.y-padding-8:v.y>0?node.y+node.h+padding+8:p.y});
  const aa=stub(from,a,va),bb=stub(to,b,vb);
  const other=doc.nodes.filter(n=>n.id!==from.id&&n.id!==to.id&&n.kind!=='draw').map(n=>({x:n.x-padding,y:n.y-padding,w:n.w+padding*2,h:(n.kind==='frame'?43:n.h)+padding*2}));
  let result:Point[]=[];
  if(clearSegment(a,aa,other)&&clearSegment(bb,b,other)) {
    const stops=[aa,...(edge.waypoints??[]),bb];
    if(!edge.waypoints?.length&&(lane.from||lane.to)){
      if(lane.from)stops.splice(1,0,{x:aa.x+(va.x?0:lane.from),y:aa.y+(va.x?lane.from:0)});
      if(lane.to)stops.splice(stops.length-1,0,{x:bb.x+(vb.x?0:lane.to),y:bb.y+(vb.x?lane.to:0)});
    }
    const calculate=(via:Point[])=>{const points:Point[]=[a];for(let i=1;i<via.length;i++){const leg=route(via[i-1],via[i],obstacles);if(!leg.length)return [];points.push(...leg);}return points;};
    result=calculate(stops);
    // Lane offsets are a visual preference, never a reason to lose a valid route.
    if(!result.length&&!edge.waypoints?.length)result=calculate([aa,bb]);
    if(result.length)result=simplify([...result,b]);
  }
  if(cached.paths.size>Math.max(2048,doc.edges.length*2))cached.paths.clear();cached.paths.set(key,{points:result,from:edge.from,to:edge.to,padding});
  return result;
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Shared drawing/hit targets, ordered along the path for inserting guide points. */
export function routeHandles(edge: FlowEdge, points: Point[]) {
  const progress = (p: Point) => {
    let length = 0, best = Infinity, position = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], segment = Math.hypot(b.x-a.x,b.y-a.y);
      const distance = distanceToSegment(p,a,b);
      if (distance < best) { best=distance; position=length+Math.min(segment,Math.hypot(p.x-a.x,p.y-a.y)); }
      length += segment;
    }
    return position;
  };
  const guides = edge.waypoints ?? [], positions = guides.map(progress);
  const handles = guides.map((point,waypoint) => ({point,waypoint,insert:false}));
  if (guides.length < 32) {
    const candidates = [...points.slice(1,-1), ...points.slice(1).flatMap((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y)<40?[]:[{x:(p.x+points[i].x)/2,y:(p.y+points[i].y)/2}])];
    for (const point of candidates) {
      if (handles.some(h=>Math.hypot(h.point.x-point.x,h.point.y-point.y)<1)) continue;
      const at=progress(point), next=positions.findIndex(p=>p>at);
      handles.push({point,waypoint:next<0?guides.length:next,insert:true});
    }
  }
  return handles;
}
