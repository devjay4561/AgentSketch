import type {Box, FlowNode} from './types.ts';

type TextRun = {text:string;bold?:boolean;color?:string;fontSize?:number;href?:string};
type RichNode = FlowNode & {textRuns?:TextRun[];contentMode?:'text'|'checklist'|'table';table?:{columns:string[];rows:string[][]}};
export type TextItem = {text:string;x:number;y:number;fontSize:number;bold:boolean;color:string;href?:string};
export type RectItem = Box & {fill:string;stroke:string};
export type PathItem = {points:{x:number;y:number}[];stroke:string};
export interface ContentLayout {texts:TextItem[];rects:RectItem[];paths:PathItem[]}
export type Measure = (text:string,fontSize:number,bold:boolean)=>number;
const layouts=new WeakMap<FlowNode,{signature:string;layout:ContentLayout|null}>();
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const safeLink=(href?:string)=>{if(!href)return undefined;try{const url=new URL(href);return ['https:','http:','mailto:'].includes(url.protocol)?href:undefined;}catch{return undefined;}};
const font=(size:number,bold:boolean,family:string)=>`${bold?600:400} ${size}px ${family}`;
/** Latin words (with attached digits and punctuation) wrap whole; Hangul and other text wraps per character. */
export const WRAP_TOKENS=/[\p{Script=Latin}\d'’\-_.,:;!?()/&%+#@=]+|\s|./gsu;
const fallbackMeasure:Measure=(text,size)=>[...text].reduce((n,c)=>n+size*(c.charCodeAt(0)>255?1:.55),0);

/** Whole text is retained in this layout; the caller chooses the visible node box. */
function textLayout(runs:TextRun[],width:number,defaults:{fontSize:number;bold:boolean;color:string},measure:Measure):{lines:TextItem[][];heights:number[];widths:number[]} {
  const lines:TextItem[][]=[[]],heights:number[]=[defaults.fontSize*1.45],widths:number[]=[0];
  const nextLine=()=>{lines.push([]);heights.push(defaults.fontSize*1.45);widths.push(0);};
  const limit=Math.max(1,width),used=()=>widths[widths.length-1];

  for(const run of runs){
    const size=run.fontSize??defaults.fontSize,bold=run.bold??defaults.bold,color=run.color??defaults.color,href=safeLink(run.href);
    const put=(text:string,w:number)=>{
      const line=lines.length-1,current=lines[line],last=current.at(-1);
      if(last&&last.fontSize===size&&last.bold===bold&&last.color===color&&last.href===href){last.text+=text;}
      else current.push({text,x:widths[line],y:0,fontSize:size,bold,color,...(href?{href}:{})});
      widths[line]+=w;heights[line]=Math.max(heights[line],size*1.45);
    };
    for(const token of run.text.replace(/\r/g,'').match(WRAP_TOKENS)??[]){
      if(token==='\n'){nextLine();continue;}
      const tw=measure(token,size,bold);
      // A space at the wrap point stays at the end of the line, so exports keep every character.
      if(/^\s$/.test(token)){put(token,tw);continue;}
      if(used()>0&&used()+tw>limit)nextLine();
      if(used()===0&&tw>limit){
        // A word wider than the box still breaks, so no text is ever hidden.
        for(const char of token){const cw=measure(char,size,bold);if(used()>0&&used()+cw>limit)nextLine();put(char,cw);}
        continue;
      }
      put(token,tw);
    }
  }
  return {lines,heights,widths};
}
function appendText(target:ContentLayout,runs:TextRun[],x:number,y:number,width:number,node:FlowNode,measure:Measure,align:FlowNode['align']='left'):number {
  const text=textLayout(runs,width,{fontSize:node.fontSize,bold:node.bold,color:node.color},measure);
  let top=y;
  text.lines.forEach((line,i)=>{const offset=align==='center'?(width-text.widths[i])/2:align==='right'?width-text.widths[i]:0;for(const item of line)target.texts.push({...item,x:x+offset+item.x,y:top+text.heights[i]/2});top+=text.heights[i];});
  return top-y;
}
function makeLayout(node:RichNode,box:Box,measure:Measure):ContentLayout|null {
  const result:ContentLayout={texts:[],rects:[],paths:[]};
  if(node.contentMode==='checklist'){
    let y=0;const size=Math.max(10,Math.min(16,node.fontSize));
    if(node.text)y+=appendText(result,[{text:node.text,bold:true}],0,y,box.w,node,measure)+10;
    for(const item of node.details?.checklist??[]){
      const height=appendText(result,[{text:item.text,color:item.done?'#52655C':node.color}],size+10,y,Math.max(1,box.w-size-10),node,measure);
      result.rects.push({x:0,y:y+(node.fontSize*1.45-size)/2,w:size,h:size,fill:item.done?'#FFF1E6':'#FFFFFF',stroke:item.done?'#B64915':'#8A96A3'});
      if(item.done){const by=y+(node.fontSize*1.45-size)/2;result.paths.push({points:[{x:3,y:by+size*.52},{x:size*.42,y:by+size*.75},{x:size-3,y:by+size*.27}],stroke:'#B64915'});}
      y+=Math.max(node.fontSize*1.45,height)+8;
    }
    return result;
  }
  if(node.contentMode==='table'&&node.table?.columns.length){
    const table=node.table,columns=table.columns.length,cw=box.w/columns;let y=0;
    if(node.text){y+=appendText(result,[{text:node.text,bold:true}],0,y,box.w,node,measure)+10;}
    for(const [rowIndex,row] of [table.columns,...table.rows].entries()){
      const rowNode={...node,fontSize:Math.min(node.fontSize,16),bold:rowIndex===0};
      const layouts=Array.from({length:columns},(_,i)=>textLayout([{text:row[i]??''}],Math.max(1,cw-12),{fontSize:rowNode.fontSize,bold:rowNode.bold,color:node.color},measure));
      const rh=Math.max(rowNode.fontSize*1.45+12,...layouts.map(l=>l.heights.reduce((a,b)=>a+b,0)+12));
      layouts.forEach((layout,column)=>{
        result.rects.push({x:column*cw,y,w:cw,h:rh,fill:rowIndex===0?'#FFF1E6':rowIndex%2===0?'#F7F8FA':'#FFFFFF',stroke:'#CBD2DA'});
        let ty=y+6;layout.lines.forEach((line,i)=>{for(const item of line)result.texts.push({...item,x:column*cw+6+item.x,y:ty+layout.heights[i]/2});ty+=layout.heights[i];});
      });y+=rh;
    }
    return result;
  }
  if(node.textRuns?.length&&node.textRuns.map(run=>run.text).join('')===node.text){
    const text=textLayout(node.textRuns,box.w,{fontSize:node.fontSize,bold:node.bold,color:node.color},measure);
    const total=text.heights.reduce((a,b)=>a+b,0),topAligned=['text','frame','note'].includes(node.kind);
    const top=topAligned?0:Math.max(0,(box.h-total)/2);
    appendText(result,node.textRuns,0,top,box.w,node,measure,node.kind==='frame'?'left':node.align);return result;
  }
  return null;
}
function cachedLayout(node:RichNode,box:Box,measure:Measure):ContentLayout|null {
  const signature=JSON.stringify([box.w,box.h,node.text,node.textRuns,node.table,node.contentMode,node.details?.checklist,node.fontSize,node.bold,node.color,node.align,node.kind,measure('한글 Ab',node.fontSize,node.bold)]);
  const previous=layouts.get(node);if(previous?.signature===signature)return previous.layout;
  const layout=makeLayout(node,box,measure);
  // Keep a single current layout per live node and avoid retaining giant exports.
  if(!layout||layout.texts.length+layout.rects.length<10000)layouts.set(node,{signature,layout});
  return layout;
}

export function measureRichContentHeight(node:FlowNode,width:number,fontFamily:string,context?:CanvasRenderingContext2D|null):number|null {
  if(!node.textRuns?.length&&node.contentMode!=='table'&&node.contentMode!=='checklist')return null;
  const measure:Measure=context?(text,size,bold)=>{context.font=font(size,bold,fontFamily);return context.measureText(text).width;}:fallbackMeasure;
  const layout=makeLayout(node,{x:0,y:0,w:Math.max(1,width),h:0},measure);if(!layout)return null;
  let height=0;for(const r of layout.rects)height=Math.max(height,r.y+r.h);for(const t of layout.texts)height=Math.max(height,t.y+t.fontSize*.725);return height;
}

export function layoutRichContent(node:FlowNode,box:Box,measure:Measure=fallbackMeasure):ContentLayout|null {
  return cachedLayout(node,box,measure);
}

export function renderRichContent(ctx:CanvasRenderingContext2D,node:FlowNode,box:Box,fontFamily:string):boolean {
  const rich=node as RichNode;if(!rich.textRuns?.length&&rich.contentMode!=='table'&&rich.contentMode!=='checklist')return false;
  const measure:Measure=(text,size,bold)=>{ctx.font=font(size,bold,fontFamily);return ctx.measureText(text).width;};
  ctx.save();const layout=cachedLayout(rich,box,measure);if(!layout){ctx.restore();return false;}
  ctx.beginPath();ctx.rect(box.x,box.y,Math.max(0,box.w),Math.max(0,box.h));ctx.clip();ctx.translate(box.x,box.y);ctx.setLineDash([]);
  for(const rect of layout.rects){ctx.fillStyle=rect.fill;ctx.strokeStyle=rect.stroke;ctx.lineWidth=.8;ctx.fillRect(rect.x,rect.y,rect.w,rect.h);ctx.strokeRect(rect.x,rect.y,rect.w,rect.h);}
  for(const path of layout.paths){ctx.beginPath();ctx.moveTo(path.points[0].x,path.points[0].y);for(const p of path.points.slice(1))ctx.lineTo(p.x,p.y);ctx.strokeStyle=path.stroke;ctx.lineWidth=1.6;ctx.stroke();}
  ctx.textAlign='left';ctx.textBaseline='middle';
  for(const item of layout.texts){ctx.font=font(item.fontSize,item.bold,fontFamily);ctx.fillStyle=item.color;ctx.fillText(item.text,item.x,item.y);if(item.href){ctx.strokeStyle=item.color;ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(item.x,item.y+item.fontSize*.55);ctx.lineTo(item.x+ctx.measureText(item.text).width,item.y+item.fontSize*.55);ctx.stroke();}}
  ctx.restore();return true;
}
export function svgRichContent(node:FlowNode,box:Box,fontFamily:string,measureContext?:CanvasRenderingContext2D|null):string|null {
  const rich=node as RichNode;if(!rich.textRuns?.length&&rich.contentMode!=='table'&&rich.contentMode!=='checklist')return null;
  const measure:Measure=measureContext?(text,size,bold)=>{measureContext.font=font(size,bold,fontFamily);return measureContext.measureText(text).width;}:fallbackMeasure;
  const layout=cachedLayout(rich,box,measure);if(!layout)return null;
  const id=`rich-${node.id}`,parts=[`<defs><clipPath id="${escape(id)}"><rect x="${box.x}" y="${box.y}" width="${Math.max(0,box.w)}" height="${Math.max(0,box.h)}"/></clipPath></defs><g clip-path="url(#${escape(id)})"><g transform="translate(${box.x} ${box.y})">`];
  for(const rect of layout.rects)parts.push(`<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="${rect.fill}" stroke="${rect.stroke}" stroke-width=".8"/>`);
  for(const path of layout.paths)parts.push(`<polyline points="${path.points.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="${path.stroke}" stroke-width="1.6"/>`);
  for(const item of layout.texts){const text=`<text x="${item.x}" y="${item.y}" font-family="${escape(fontFamily)}" font-size="${item.fontSize}" font-weight="${item.bold?600:400}" dominant-baseline="central" fill="${escape(item.color)}"${item.href?' text-decoration="underline"':''}>${escape(item.text)}</text>`;parts.push(item.href?`<a href="${escape(item.href)}" target="_blank" rel="noopener noreferrer">${text}</a>`:text);}
  parts.push('</g></g>');return parts.join('');
}
