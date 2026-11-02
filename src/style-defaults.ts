import type { FlowEdge, FlowNode } from './types.ts';

export interface StyleStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
export const STYLE_DEFAULTS_KEY='agentsketch.style-defaults.v1';
type NodeStyle=Partial<Pick<FlowNode,'fill'|'stroke'|'color'|'fontSize'|'bold'|'align'|'strokeWidth'|'dashed'|'opacity'>>;
type EdgeStyle=Partial<Pick<FlowEdge,'color'|'width'|'style'|'dashed'|'arrow'|'labelBackground'|'labelAngle'>>;
interface Defaults {version:1;node?:NodeStyle;edge?:EdgeStyle}
const MAX_BYTES=4096;
const record=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const color=(value:unknown):value is string=>typeof value==='string'&&/^(?:#[\da-fA-F]{3}(?:[\da-fA-F]{3})?|#[\da-fA-F]{8}|transparent)$/.test(value);
const number=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
function nodeStyle(value:unknown):NodeStyle|undefined{
  const raw=record(value);if(!raw)return;
  const result:NodeStyle={};
  for(const key of ['fill','stroke','color'] as const)if(color(raw[key]))result[key]=raw[key];
  for(const key of ['bold','dashed'] as const)if(typeof raw[key]==='boolean')result[key]=raw[key];
  if(number(raw.fontSize,6,200))result.fontSize=raw.fontSize;
  if(number(raw.strokeWidth,0,50))result.strokeWidth=raw.strokeWidth;
  if(number(raw.opacity,0,1))result.opacity=raw.opacity;
  if(raw.align==='left'||raw.align==='center'||raw.align==='right')result.align=raw.align;
  return Object.keys(result).length?result:undefined;
}
function edgeStyle(value:unknown):EdgeStyle|undefined{
  const raw=record(value);if(!raw)return;
  const result:EdgeStyle={};
  if(color(raw.color))result.color=raw.color;
  if(color(raw.labelBackground))result.labelBackground=raw.labelBackground;
  if(number(raw.width,.5,30))result.width=raw.width;
  if(raw.style==='elbow'||raw.style==='straight'||raw.style==='curve')result.style=raw.style;
  if(raw.arrow==='end'||raw.arrow==='both'||raw.arrow==='none')result.arrow=raw.arrow;
  if(typeof raw.dashed==='boolean')result.dashed=raw.dashed;
  if(raw.labelAngle===-90||raw.labelAngle===0||raw.labelAngle===90)result.labelAngle=raw.labelAngle;
  return Object.keys(result).length?result:undefined;
}
function storage(explicit?:StyleStorage):StyleStorage|undefined{
  if(explicit)return explicit;
  try{return typeof localStorage==='undefined'?undefined:localStorage;}catch{return undefined;}
}
export function readStyleDefaults(explicit?:StyleStorage):Defaults{
  try{
    const raw=storage(explicit)?.getItem(STYLE_DEFAULTS_KEY);if(!raw||raw.length>MAX_BYTES)return {version:1};
    const value=record(JSON.parse(raw));if(value?.version!==1)return {version:1};
    return {version:1,node:nodeStyle(value.node),edge:edgeStyle(value.edge)};
  }catch{return {version:1};}
}
function write(defaults:Defaults,explicit?:StyleStorage):boolean{
  try{const target=storage(explicit),raw=JSON.stringify(defaults);if(!target||raw.length>MAX_BYTES)return false;target.setItem(STYLE_DEFAULTS_KEY,raw);return true;}catch{return false;}
}
/** Appearance only; never stores document text, source links, evidence, IDs or images. */
export function saveNodeDefaults(node:FlowNode,explicit?:StyleStorage):boolean{return write({...readStyleDefaults(explicit),node:nodeStyle({...node,opacity:node.opacity??1})},explicit);}
export function saveEdgeDefaults(edge:FlowEdge,explicit?:StyleStorage):boolean{return write({...readStyleDefaults(explicit),edge:edgeStyle({...edge,labelBackground:edge.labelBackground??'#ffffff',labelAngle:edge.labelAngle??0})},explicit);}
export function applyNodeDefaults(node:FlowNode,explicit?:StyleStorage):boolean{const defaults=readStyleDefaults(explicit).node;if(!defaults)return false;Object.assign(node,defaults);return true;}
export function applyEdgeDefaults(edge:FlowEdge,explicit?:StyleStorage):boolean{const defaults=readStyleDefaults(explicit).edge;if(!defaults)return false;Object.assign(edge,defaults);return true;}
export function resetStyleDefaults(explicit?:StyleStorage):boolean{try{const target=storage(explicit);if(!target)return false;target.removeItem(STYLE_DEFAULTS_KEY);return true;}catch{return false;}}
