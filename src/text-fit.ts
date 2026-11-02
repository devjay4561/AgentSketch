import type {FlowNode} from './types.ts';
import {measureRichContentHeight} from './rich-render.ts';
/** Same font measurement for the editor and AI renderer; never runs on a timer. */
export function fitTextHeight(nodes:FlowNode[],ctx:CanvasRenderingContext2D){
 for(const n of nodes){if(['draw','image','frame'].includes(n.kind))continue;ctx.font=`${n.bold?600:400} ${n.fontSize}px "Pretendard Variable",sans-serif`;
  const available=Math.max(12,n.w*(n.kind==='diamond'?.56:1)-28),rich=measureRichContentHeight(n,available,'"Pretendard Variable",sans-serif',ctx);if(rich!==null){n.h=Math.min(100000,Math.max(24,(rich+20)/(n.kind==='diamond'?.56:1)));continue;}
  let count=0;for(const line of n.text.split('\n')){let width=0;count++;for(const char of line){const advance=ctx.measureText(char).width;if(width&&width+advance>available){count++;width=0;}width+=advance;}}
  n.h=Math.min(100000,Math.max(24,(count*n.fontSize*1.45+20)/(n.kind==='diamond'?.56:1)));
 }
}
