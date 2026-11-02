import type { Box, FlowDocument, Point } from './types.ts';
import { bounds, intersects } from './geometry.ts';
import { route } from './routing.ts';

export interface EdgeLabel {box:Box;anchor:Point;lines:string[];center:Point;leader:Point[];angle:-90|0|90;textWidth:number;textHeight:number}
export function pointAlong(points:Point[],position=.5):Point {
  if(!points.length)return{x:0,y:0};
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));
  let remaining=lengths.reduce((a,b)=>a+b,0)*Math.max(0,Math.min(1,position));
  for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]){const t=lengths[i]?remaining/lengths[i]:0;return{x:points[i].x+(points[i+1].x-points[i].x)*t,y:points[i].y+(points[i+1].y-points[i].y)*t};}remaining-=lengths[i];}
  return points.at(-1)!;
}
export const estimateLabelWidth=(text:string)=>[...text].reduce((sum,c)=>sum+(c.charCodeAt(0)>255?12:6.6),0);
const labelCache=new WeakMap<FlowDocument,{signature:string;labels:Map<string,EdgeLabel>}>();
/** Shared canvas/SVG layout; labels avoid shapes and already placed captions. */
export function layoutEdgeLabels(doc:FlowDocument,paths:Map<string,Point[]>,measure=estimateLabelWidth):Map<string,EdgeLabel>{
  const edges=doc.edges.filter(e=>e.label&&paths.get(e.id)?.length);
  if(!edges.length)return new Map();
  const signature=JSON.stringify([measure('AgentSketch 한글'),doc.nodes.map(n=>[n.x,n.y,n.w,n.h,n.kind]),edges.map(e=>[e.id,e.label,e.labelPosition,e.labelAngle,paths.get(e.id)])]);
  const cached=labelCache.get(doc);if(cached?.signature===signature)return cached.labels;
  const obstacles=doc.nodes.filter(n=>n.kind!=='draw').map(n=>({x:n.x-6,y:n.y-6,w:n.w+12,h:(n.kind==='frame'?43:n.h)+12}));
  const occupied:Box[]=[],labels=new Map<string,EdgeLabel>(),all=bounds(obstacles);
  for(const edge of edges){
    const points=paths.get(edge.id)!,anchor=pointAlong(points,edge.labelPosition??.5),lines:string[]=[];
    for(const paragraph of edge.label.replace(/\r/g,'').split('\n')){
      let line='';for(const c of paragraph){if(line&&measure(line+c)>300){lines.push(line);line='';}line+=c;}lines.push(line);
    }
    const textWidth=Math.max(24,...lines.map(measure))+12,textHeight=lines.length*16+8,angle=edge.labelAngle??0;
    const w=angle?textHeight:textWidth,h=angle?textWidth:textHeight;
    let center={...anchor},box:Box={x:center.x-w/2,y:center.y-h/2,w,h};
    const free=(candidate:Box)=>!obstacles.some(b=>intersects(b,candidate))&&!occupied.some(b=>intersects(b,candidate))&&!doc.edges.some(other=>{
      if(other.id===edge.id)return false;
      const path=paths.get(other.id)??[];
      return path.some((p,i)=>i>0&&intersects(candidate,{x:Math.min(path[i-1].x,p.x)-3,y:Math.min(path[i-1].y,p.y)-3,w:Math.abs(path[i-1].x-p.x)+6,h:Math.abs(path[i-1].y-p.y)+6}));
    });
    // Prefer the chosen point. Then move only the caption, never the user's path.
    if(!free(box)){
      const candidates:Point[]=[];
      for(const distance of [h/2+14,h+28,h*2+40,160,320,640])for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]])candidates.push({x:anchor.x+dx*distance,y:anchor.y+dy*distance});
      let found=false;for(const p of candidates){const b={x:p.x-w/2,y:p.y-h/2,w,h};if(free(b)){center=p;box=b;found=true;break;}}
      if(!found){box={x:all.x+all.w+40,y:all.y,w,h};while(!free(box))box.y+=h+12;center={x:box.x+w/2,y:box.y+h/2};}
    }
    const leader=Math.hypot(center.x-anchor.x,center.y-anchor.y)>12?route(anchor,center,[...obstacles,...occupied]):[];
    occupied.push(box);labels.set(edge.id,{box,anchor,lines,center,leader,angle,textWidth,textHeight});
  }
  labelCache.set(doc,{signature,labels});return labels;
}
