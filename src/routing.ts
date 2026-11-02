import type {Box, Point} from './types.ts';

export function clearSegment(a: Point, b: Point, boxes: Box[]): boolean {
  return !boxes.some(r => a.x === b.x
    ? a.x > r.x && a.x < r.x+r.w && Math.max(a.y,b.y)>r.y && Math.min(a.y,b.y)<r.y+r.h
    : a.y > r.y && a.y < r.y+r.h && Math.max(a.x,b.x)>r.x && Math.min(a.x,b.x)<r.x+r.w);
}
export function simplify(points: Point[]): Point[] {
  const out: Point[]=[];
  for(const p of points) {
    if(out.length && out.at(-1)!.x===p.x && out.at(-1)!.y===p.y) continue;
    while(out.length>1) {
      const a=out.at(-2)!, b=out.at(-1)!;
      if(!((a.x===b.x && b.x===p.x && (b.y-a.y)*(p.y-b.y)>=0)||(a.y===b.y && b.y===p.y && (b.x-a.x)*(p.x-b.x)>=0))) break;
      out.pop();
    }
    out.push(p);
  }
  return out;
}
/** A* on obstacle boundary coordinates. No diagonal segments or unsafe fallback. */
export function route(a: Point, b: Point, boxes: Box[]): Point[] {
  const inside=(p:Point)=>boxes.some(r=>p.x>r.x&&p.x<r.x+r.w&&p.y>r.y&&p.y<r.y+r.h);
  if(inside(a)||inside(b))return [];
  for(const bend of [{x:b.x,y:a.y},{x:a.x,y:b.y}]) if(clearSegment(a,bend,boxes)&&clearSegment(bend,b,boxes))return simplify([a,bend,b]);
  const xs=[...new Set([a.x,b.x,...boxes.flatMap(r=>[r.x,r.x+r.w])])].sort((a,b)=>a-b);
  const ys=[...new Set([a.y,b.y,...boxes.flatMap(r=>[r.y,r.y+r.h])])].sort((a,b)=>a-b);
  const width=xs.length, start=ys.indexOf(a.y)*width+xs.indexOf(a.x), end=ys.indexOf(b.y)*width+xs.indexOf(b.x);
  const point=(id:number):Point=>({x:xs[id%width],y:ys[Math.floor(id/width)]});
  const costs=new Map<number,number>([[start*3,0]]), parent=new Map<number,number>();
  const heap:{key:number;cost:number;score:number}[]=[];
  function push(item:typeof heap[number]) {heap.push(item);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].score<=item.score)break;heap[i]=heap[p];i=p;}heap[i]=item;}
  function pop(){const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].score<heap[c].score)c++;if(heap[c].score>=last.score)break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;}
  push({key:start*3,cost:0,score:0});
  let visits=0;
  while(heap.length && visits++<60000) {
    const current=pop();if(costs.get(current.key)!==current.cost)continue;
    const id=Math.floor(current.key/3),dir=current.key%3,p=point(id);
    if(id===end){const result=[p];let key=current.key;while(parent.has(key)){key=parent.get(key)!;result.push(point(Math.floor(key/3)));}return simplify(result.reverse());}
    const x=id%width,y=Math.floor(id/width);
    for(const [nx,ny,nd] of [[x-1,y,1],[x+1,y,1],[x,y-1,2],[x,y+1,2]]) {
      if(nx<0||ny<0||nx>=width||ny>=ys.length)continue;
      const next=ny*width+nx,q=point(next);if(!clearSegment(p,q,boxes))continue;
      const cost=current.cost+Math.abs(q.x-p.x)+Math.abs(q.y-p.y)+(dir&&dir!==nd?18:0),key=next*3+nd;
      if(cost>=(costs.get(key)??Infinity))continue;
      costs.set(key,cost);parent.set(key,current.key);push({key,cost,score:cost+Math.abs(q.x-b.x)+Math.abs(q.y-b.y)});
    }
  }
  return [];
}
