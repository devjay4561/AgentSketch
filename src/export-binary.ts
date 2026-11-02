import type { FlowDocument, FlowNode, Point } from './types.ts';
import { bounds, edgePoints, prepareRoutes } from './geometry.ts';
import {layoutEdgeLabels} from './edge-labels.ts';
import {layoutRichContent} from './rich-render.ts';
import {textBox} from './renderer.ts';
import {planPages,MAX_PDF_PAGES} from './pdf-pagination.ts';
import type {PdfPrintOptions} from './pdf-pagination.ts';

export interface ExportOptions extends PdfPrintOptions { boldFontBytes?:Uint8Array; scope?:'all'|'selection'; selection?:Set<string>; pages?:boolean; includeInternalNotes?:boolean; }
export function exportDocuments(doc:FlowDocument,options:ExportOptions={}) {
  const selected=options.scope==='selection';
  if(selected && !options.selection?.size) throw new Error('내보낼 요소를 먼저 선택하세요.');
  const filter=(ids:Set<string>,title:string):FlowDocument=>{
    const nodes=doc.nodes.filter(n=>ids.has(n.id)),assetIds=new Set(nodes.map(n=>n.assetId)),attachmentIds=new Set(nodes.flatMap(n=>n.details?.attachmentIds??[]));
    const groups=new Set(nodes.flatMap(n=>n.groupId?[n.groupId]:[])),groupIndex=new Map((doc.workspace?.groups??[]).map(g=>[g.id,g]));for(const id of groups){const parent=groupIndex.get(id)?.parentId;if(parent)groups.add(parent);}
    const pageIds=new Set(nodes.map(n=>n.details?.pageId??doc.workspace?.pages?.[0]?.id)),layerIds=new Set(nodes.map(n=>n.details?.layerId));
    const workspace=doc.workspace?{...doc.workspace,pages:doc.workspace.pages?.filter(p=>pageIds.has(p.id)),activePageId:pageIds.has(doc.workspace.activePageId)?doc.workspace.activePageId:doc.workspace.pages?.find(p=>pageIds.has(p.id))?.id,layers:doc.workspace.layers?.filter(l=>layerIds.has(l.id)),groups:doc.workspace.groups?.filter(g=>groups.has(g.id)),comments:doc.workspace.comments?.filter(c=>c.nodeId&&ids.has(c.nodeId)),bookmarks:doc.workspace.bookmarks?.filter(b=>b.nodeId&&ids.has(b.nodeId)),attachments:doc.workspace.attachments?.filter(a=>attachmentIds.has(a.id))}:undefined;
    return {...doc,title,nodes,edges:doc.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)),assets:Object.fromEntries(Object.entries(doc.assets).filter(([id])=>assetIds.has(id))),...(workspace?{workspace}:{})};
  };
  if(selected)return [filter(options.selection!,doc.title+' · 선택 영역')];
  const pages=doc.workspace?.pages;
  if(options.pages && pages?.length){
    const first=pages[0].id;
    return pages.map(p=>filter(new Set(doc.nodes.filter(n=>(n.details?.pageId??first)===p.id).map(n=>n.id)),doc.title+' · '+p.name));
  }
  return [doc];
}
/** Reopenable exchange formats need every condition source in their subgraph.
 * Visual/PDF page exports keep their requested viewport and do not use this expansion. */
export function exportExchangeDocument(doc:FlowDocument,options:ExportOptions={}):{document:FlowDocument;warnings:string[]} {
 if(options.scope!=='selection')return {document:doc,warnings:[]};
 if(!options.selection?.size)throw new Error('내보낼 요소를 먼저 선택하세요.');
 const ids=new Set(options.selection),nodeIds=new Set(doc.nodes.map(n=>n.id));
 const conditionsByEndpoint=new Map<string,FlowDocument['edges']>();
 for(const edge of doc.edges){if(!edge.condition)continue;for(const endpoint of [edge.from,edge.to]){let list=conditionsByEndpoint.get(endpoint);if(!list){list=[];conditionsByEndpoint.set(endpoint,list);}list.push(edge);}}
 const queue=[...ids];
 for(let i=0;i<queue.length;i++)for(const edge of conditionsByEndpoint.get(queue[i])??[]){
  if(!ids.has(edge.from)||!ids.has(edge.to))continue;
  const source=edge.condition!.nodeId;if(ids.has(source))continue;
  if(!nodeIds.has(source))throw new Error('연결 조건의 참조 요소가 없습니다. 원본 문서를 확인하세요.');
  ids.add(source);queue.push(source);
 }
 const added=ids.size-options.selection.size;
 return {document:exportDocuments(doc,{...options,pages:false,selection:ids})[0],warnings:added?[`원본·CSV·draw.io에는 선택 밖의 조건 참조 요소 ${added}개를 함께 포함합니다. 연결 조건의 원본을 보존하기 위한 범위입니다.`]:[]};
}
export function exportBounds(doc:FlowDocument) {
  const nodes=[...doc.nodes.map(n=>({x:n.x,y:n.y,w:n.w,h:n.h}))],index=new Map(doc.nodes.map(n=>[n.id,n]));prepareRoutes(doc,index);
  const paths=new Map(doc.edges.map(e=>[e.id,edgePoints(e,doc,index)]));
  for(const points of paths.values())for(const p of points)nodes.push({...p,w:1,h:1});
  for(const label of layoutEdgeLabels(doc,paths).values()){nodes.push(label.box);for(const p of label.leader)nodes.push({...p,w:1,h:1});}
  const b=bounds(nodes);return {x:b.x-30,y:b.y-30,w:Math.max(100,b.w+60),h:Math.max(100,b.h+60)};
}
export function nodeExportText(node:FlowNode):string {
 if(node.contentMode==='table'&&node.table)return [node.text,...[node.table.columns,...node.table.rows].map(row=>row.join(' | '))].filter(Boolean).join('\n');
 if(node.contentMode==='checklist')return [node.text,...(node.details?.checklist??[]).map(item=>(item.done?'[완료] ':'[미완료] ')+item.text)].filter(Boolean).join('\n');
 return node.textRuns?.map(run=>run.text).join('')??node.text;
}
function hex(color:string,fallback='FFFFFF'){const raw=color.replace('#','');return /^[0-9a-f]{3}$/i.test(raw)?raw.split('').map(x=>x+x).join(''):/^[0-9a-f]{6,8}$/i.test(raw)?raw.slice(0,6):fallback;}
async function imageData(doc:FlowDocument,node:FlowNode):Promise<string|undefined>{
 const asset=node.assetId?doc.assets[node.assetId]:undefined;if(!asset)return;
 const crop=node.crop;
 if(!crop && !node.rotation && /^data:image\/(png|jpeg);base64,/.test(asset.data))return asset.data;
 if(typeof document==='undefined')throw new Error('WebP/GIF 또는 자른 이미지 내보내기는 앱에서 실행하세요.');
 const image=new Image();image.src=asset.data;await image.decode();const canvas=document.createElement('canvas');
 const region=crop??{x:0,y:0,w:1,h:1};const wantedW=image.naturalWidth*region.w,wantedH=wantedW*node.h/node.w,ratio=Math.min(1,2400/wantedW,2400/wantedH);canvas.width=Math.max(1,Math.round(wantedW*ratio));canvas.height=Math.max(1,Math.round(wantedH*ratio));
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('이미지 변환을 시작할 수 없습니다.');
 ctx.beginPath();ctx.roundRect(0,0,canvas.width,canvas.height,Math.min(8*canvas.width/node.w,canvas.width/2,canvas.height/2));ctx.clip();ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate((node.rotation??0)*Math.PI/180);ctx.translate(-canvas.width/2,-canvas.height/2);
 ctx.drawImage(image,region.x*image.naturalWidth,region.y*image.naturalHeight,region.w*image.naturalWidth,region.h*image.naturalHeight,0,0,canvas.width,canvas.height);
 const out=canvas.toDataURL('image/png');canvas.width=canvas.height=1;image.src='';return out;
}
export async function createPowerPoint(doc:FlowDocument,options:ExportOptions={}):Promise<{base64:string;warnings:string[]}>{
 const {default:PptxGenJS}=await import('pptxgenjs');const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';pptx.author='AgentSketch';pptx.subject='편집 가능한 업무 흐름';pptx.title=doc.title;
 const warnings=new Set<string>(['PowerPoint에서 Pretendard가 설치되지 않은 경우 대체 글꼴로 표시됩니다.','연결선은 편집 가능한 선 조각이며 PowerPoint 도형에 자동으로 붙어 움직이지 않습니다.']);
 for(const board of exportDocuments(doc,options)){
  const slide=pptx.addSlide(),b=exportBounds(board),scale=Math.min(12.6/b.w,6.5/b.h),ox=.36-b.x*scale,oy=.7-b.y*scale;
  slide.addText(board.title,{x:.36,y:.18,w:12.6,h:.3,fontFace:'Pretendard',fontSize:14,bold:true,color:'1C2024',margin:0});
  const pos=(n:{x:number;y:number;w:number;h:number})=>({x:ox+n.x*scale,y:oy+n.y*scale,w:n.w*scale,h:n.h*scale});
  const index=new Map(board.nodes.map(n=>[n.id,n]));prepareRoutes(board,index);const paths=new Map(board.edges.map(e=>[e.id,edgePoints(e,board,index)])),labels=layoutEdgeLabels(board,paths);
  const segment=(a:Point,z:Point,color:string,width:number,arrow?:'end'|'start'|'both',dash=false)=>slide.addShape(pptx.ShapeType.line,{x:ox+Math.min(a.x,z.x)*scale,y:oy+Math.min(a.y,z.y)*scale,w:Math.abs(a.x-z.x)*scale,h:Math.abs(a.y-z.y)*scale,flipH:z.x<a.x,flipV:z.y<a.y,line:{color:hex(color,'667085'),width:Math.max(.25,width*scale*72),...(dash?{dashType:'dash' as const}:{}),...(arrow==='both'?{beginArrowType:'triangle' as const,endArrowType:'triangle' as const}:arrow==='end'?{endArrowType:'triangle' as const}:arrow==='start'?{beginArrowType:'triangle' as const}:{})}});
  const paintNode=async(n:FlowNode)=>{
   const p=pos(n),line={color:hex(n.stroke),width:Math.max(0,n.strokeWidth*scale*72),transparency:n.stroke==='transparent'?100:0};
   if(n.kind==='draw')for(let i=1;i<(n.points?.length??0);i++)segment({x:n.x+n.points![i-1].x,y:n.y+n.points![i-1].y},{x:n.x+n.points![i].x,y:n.y+n.points![i].y},n.stroke,n.strokeWidth,undefined,n.dashed);
   else if(n.kind!=='text'&&n.kind!=='image')slide.addShape(n.kind==='ellipse'?pptx.ShapeType.ellipse:n.kind==='diamond'?pptx.ShapeType.diamond:n.kind==='round'||n.kind==='frame'?pptx.ShapeType.roundRect:pptx.ShapeType.rect,{...p,fill:{color:hex(n.fill),transparency:n.fill==='transparent'?100:Math.round((1-(n.opacity??1))*100)},line});
   if(n.kind==='image'){const data=await imageData(board,n);if(data)slide.addImage({...p,data});}
   if(n.contentMode==='table'&&n.table){const rows=[n.table.columns,...n.table.rows],tp=pos(textBox(n)),titleH=n.text?Math.min(tp.h*.2,n.fontSize*scale*1.6):0;if(n.text)slide.addText(n.text,{x:tp.x,y:tp.y,w:tp.w,h:titleH,fontFace:'Pretendard',fontSize:Math.max(1,n.fontSize*scale*72),bold:true,color:hex(n.color),margin:0,fit:'shrink'});slide.addTable(rows.map((row,i)=>row.map(text=>({text,options:{bold:i===0,fill:{color:i===0?'FFF0E5':'FFFFFF'}}}))),{...tp,y:tp.y+titleH,h:tp.h-titleH,fontFace:'Pretendard',fontSize:Math.max(1,Math.min(n.fontSize*scale*72,(tp.h-titleH)/rows.length*50)),color:hex(n.color),rowH:(tp.h-titleH)/rows.length,colW:tp.w/n.table.columns.length,margin:2,border:{type:'solid',pt:.5,color:hex(n.stroke)},autoPage:false});}
   else if(nodeExportText(n)&&n.kind!=='draw')slide.addText(n.textRuns&&n.contentMode!=='table'&&n.contentMode!=='checklist'?n.textRuns.map(run=>({text:run.text,options:{bold:run.bold??n.bold,color:hex(run.color??n.color,'1C2024'),fontSize:Math.max(1,(run.fontSize??n.fontSize)*scale*72),...(run.href?{hyperlink:{url:run.href}}:{})}})):nodeExportText(n),{...p,margin:Math.min(.08,p.w*.05),fontFace:'Pretendard',fontSize:Math.max(1,n.fontSize*scale*72),color:hex(n.color,'1C2024'),bold:n.bold,align:n.align,valign:n.kind==='text'||n.kind==='note'||n.kind==='frame'?'top':'middle',breakLine:false,fit:'shrink'});
  };
  for(const n of board.nodes.filter(n=>n.kind==='frame'))await paintNode(n);
  for(const e of board.edges){const ps=edgePoints(e,board,index);if(ps.length<2){warnings.add('경로를 찾지 못한 연결선은 내보내지 않았습니다. 보드의 경로 없음 표시를 확인하세요.');continue;}for(let i=1;i<ps.length;i++)segment(ps[i-1],ps[i],e.color,e.width,ps.length===2&&e.arrow==='both'?'both':i===ps.length-1&&e.arrow!=='none'?'end':i===1&&e.arrow==='both'?'start':undefined,e.dashed);const label=labels.get(e.id);if(label){for(let j=1;j<label.leader.length;j++)segment(label.leader[j-1],label.leader[j],e.color,.7,undefined,true);slide.addText(label.lines.join('\n'),{...pos({x:label.center.x-label.textWidth/2,y:label.center.y-label.textHeight/2,w:label.textWidth,h:label.textHeight}),rotate:label.angle,fontFace:'Pretendard',fontSize:12*scale*72,align:'center',valign:'middle',color:hex(e.color),fill:{color:hex(e.labelBackground??'#FFFFFF')},margin:0,fit:'shrink'});}}
  for(const n of board.nodes.filter(n=>n.kind!=='frame'))await paintNode(n);
 }
 return {base64:await pptx.write({outputType:'base64'}) as string,warnings:[...warnings]};
}

export function pdfPageCount(doc:FlowDocument,options:ExportOptions={}):number {
 const total=exportDocuments(doc,options).reduce((sum,board)=>sum+planPages(exportBounds(board),options).length,0);
 if(total>MAX_PDF_PAGES)throw new Error(`PDF는 전체 ${MAX_PDF_PAGES}페이지까지 내보낼 수 있습니다.`);return total;
}
export async function createVectorPDF(doc:FlowDocument,fontBytes:Uint8Array,options:ExportOptions={}):Promise<{bytes:Uint8Array;warnings:string[]}>{
 pdfPageCount(doc,options);
 const boards=exportDocuments(doc,options);
 const lib=await import('pdf-lib'),{default:fontkit}=await import('@pdf-lib/fontkit');const pdf=await lib.PDFDocument.create();pdf.registerFontkit(fontkit);pdf.setTitle(doc.title);pdf.setCreator('AgentSketch');
 // Current fontkit subsets lose Pretendard glyph outlines; embed renamed static faces in full.
 const font=await pdf.embedFont(fontBytes,{subset:false});
 const needsBold=boards.some(board=>board.nodes.some(n=>n.bold||n.contentMode==='table'||n.contentMode==='checklist'&&!!n.text||n.textRuns?.some(run=>run.bold)));
 let boldBytes=options.boldFontBytes;
 if(needsBold&&!boldBytes&&typeof window!=='undefined'){const response=await fetch('/fonts/AgentSketchExport-Semibold.ttf');if(!response.ok)throw new Error('굵은 PDF 글꼴을 불러오지 못했습니다.');boldBytes=new Uint8Array(await response.arrayBuffer());}
 if(needsBold&&!boldBytes)throw new Error('굵은 본문이 있는 PDF에는 boldFontBytes 글꼴이 필요합니다.');
 const boldFont=needsBold?await pdf.embedFont(boldBytes!,{subset:false}):font;
 const imageCache=new Map<string,Awaited<ReturnType<typeof pdf.embedPng>>>(),warnings=new Set<string>();
 const color=(v:string)=>{const h=hex(v,'1C2024');return lib.rgb(parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255);};
 for(const board of boards){
  const index=new Map(board.nodes.map(n=>[n.id,n]));prepareRoutes(board,index);
  const paths=new Map(board.edges.map(e=>[e.id,edgePoints(e,board,index)])),labels=layoutEdgeLabels(board,paths);
  const plans=planPages(exportBounds(board),options);
  for(const plan of plans){
   const page=pdf.addPage(plan.size),{clip,scale,origin}=plan,x=(v:number)=>clip.x+(v-origin.x)*scale,y=(v:number)=>clip.y+clip.h-(v-origin.y)*scale;
   const visible=(box:{x:number;y:number;w:number;h:number})=>box.x+box.w>=origin.x&&box.y+box.h>=origin.y&&box.x<=origin.x+clip.w/scale&&box.y<=origin.y+clip.h/scale;
   const title=board.title+(plans.length>1?` · ${plan.row+1}행 ${plan.column+1}열 / ${plan.rows}×${plan.columns}`:'');
   const titleSize=Math.min(12,clip.w/Math.max(1,font.widthOfTextAtSize(title,1)));
   page.drawText(title,{x:clip.x,y:clip.y+clip.h+8,font,size:titleSize,color:color('#1C2024')});
   page.pushOperators(lib.pushGraphicsState(),lib.rectangle(clip.x,clip.y,clip.w,clip.h),lib.clip(),lib.endPath());
   const segment=(a:Point,z:Point,stroke:string,width:number,dashed=false)=>{if(visible({x:Math.min(a.x,z.x)-width,y:Math.min(a.y,z.y)-width,w:Math.abs(a.x-z.x)+2*width,h:Math.abs(a.y-z.y)+2*width}))page.drawLine({start:{x:x(a.x),y:y(a.y)},end:{x:x(z.x),y:y(z.y)},color:color(stroke),thickness:Math.max(.2,width*scale),...(dashed?{dashArray:[4*scale,3*scale]}:{})});};
   const arrow=(tip:Point,from:Point,stroke:string,width:number)=>{const angle=Math.atan2(tip.y-from.y,tip.x-from.x),length=Math.max(9,width*4);for(const sign of [-1,1])segment(tip,{x:tip.x-length*Math.cos(angle+sign*Math.PI/6),y:tip.y-length*Math.sin(angle+sign*Math.PI/6)},stroke,width);};
   const paintContent=(node:FlowNode)=>{
    const box=textBox(node),renderNode=node.textRuns?.length||node.contentMode==='table'||node.contentMode==='checklist'?node:{...node,textRuns:[{text:node.text}]};
    const layout=layoutRichContent(renderNode,box,(text,size,bold)=>(bold?boldFont:font).widthOfTextAtSize(text,size));if(!layout)return;
    const extent=Math.max(1,...layout.rects.map(r=>r.y+r.h),...layout.texts.map(t=>t.y+t.fontSize*.725));
    const left=Math.min(0,...layout.rects.map(r=>r.x),...layout.texts.map(t=>t.x));
    const right=Math.max(1,...layout.rects.map(r=>r.x+r.w),...layout.texts.map(t=>t.x+(t.bold?boldFont:font).widthOfTextAtSize(t.text,t.fontSize)));
    const shrink=Math.min(1,Math.max(1,box.h)/extent,Math.max(1,box.w)/(right-left)),px=(v:number)=>x(box.x+(v-left)*shrink),py=(v:number)=>y(box.y+v*shrink);
    for(const rect of layout.rects)page.drawRectangle({x:px(rect.x),y:py(rect.y+rect.h),width:rect.w*shrink*scale,height:rect.h*shrink*scale,color:color(rect.fill),borderColor:color(rect.stroke),borderWidth:.8*shrink*scale});
    for(const path of layout.paths)for(let i=1;i<path.points.length;i++)page.drawLine({start:{x:px(path.points[i-1].x),y:py(path.points[i-1].y)},end:{x:px(path.points[i].x),y:py(path.points[i].y)},color:color(path.stroke),thickness:1.6*shrink*scale});
    for(const item of layout.texts){
     const face=item.bold?boldFont:font,size=Math.max(.1,item.fontSize*shrink*scale),tx=px(item.x),ty=py(item.y)-size*.35;
     page.drawText(item.text,{x:tx,y:ty,font:face,size,color:color(item.color),opacity:node.opacity??1});
     if(item.href){const width=face.widthOfTextAtSize(item.text,size);page.drawLine({start:{x:tx,y:ty-size*.16},end:{x:tx+width,y:ty-size*.16},color:color(item.color),thickness:.6*scale});}
    }
   };
   const paintNode=async(n:FlowNode)=>{
    if(!visible({x:n.x-n.strokeWidth,y:n.y-n.strokeWidth,w:n.w+2*n.strokeWidth,h:n.h+2*n.strokeWidth}))return;
    const fill=n.fill==='transparent'?undefined:color(n.fill),border=n.stroke==='transparent'?undefined:color(n.stroke),w=n.w*scale,h=n.h*scale;
    if(n.kind==='draw'){for(let i=1;i<(n.points?.length??0);i++)segment({x:n.x+n.points![i-1].x,y:n.y+n.points![i-1].y},{x:n.x+n.points![i].x,y:n.y+n.points![i].y},n.stroke,n.strokeWidth,n.dashed);return;}
    const common={color:fill,borderColor:border,borderWidth:border?n.strokeWidth*scale:0,opacity:n.opacity??1,...(n.dashed?{borderDashArray:[7*scale,5*scale]}:{})};
    if(n.kind==='ellipse')page.drawEllipse({x:x(n.x+n.w/2),y:y(n.y+n.h/2),xScale:w/2,yScale:h/2,...common});
    else if(n.kind==='diamond')page.drawSvgPath(`M ${w/2} 0 L ${w} ${h/2} L ${w/2} ${h} L 0 ${h/2} Z`,{x:x(n.x),y:y(n.y),...common});
    else if(n.kind==='round'||n.kind==='frame'){const r=Math.min((n.kind==='round'?15:8)*scale,w/2,h/2);page.drawSvgPath(`M ${r} 0 H ${w-r} Q ${w} 0 ${w} ${r} V ${h-r} Q ${w} ${h} ${w-r} ${h} H ${r} Q 0 ${h} 0 ${h-r} V ${r} Q 0 0 ${r} 0 Z`,{x:x(n.x),y:y(n.y),...common});}
    else if(n.kind!=='text')page.drawRectangle({x:x(n.x),y:y(n.y+n.h),width:w,height:h,...common});
    if(n.kind==='image'){
     const key=JSON.stringify([n.assetId,n.crop,n.rotation,n.w/n.h]);let img=imageCache.get(key);
     if(!img){const data=await imageData(board,n);if(data){img=/^data:image\/jpeg/.test(data)?await pdf.embedJpg(data):await pdf.embedPng(data);imageCache.set(key,img);}}
     if(img)page.drawImage(img,{x:x(n.x),y:y(n.y+n.h),width:w,height:h,opacity:n.opacity??1});
     if(n.text)page.drawRectangle({x:x(n.x),y:y(n.y+n.h),width:w,height:40*scale,color:lib.rgb(1,1,1),opacity:.93});
    }
    if(n.kind==='frame')segment({x:n.x,y:n.y+43},{x:n.x+n.w,y:n.y+43},n.stroke,.8);
    paintContent(n);
   };
   for(const n of board.nodes.filter(n=>n.kind==='frame'))await paintNode(n);
   for(const e of board.edges){
    const ps=paths.get(e.id)!;if(ps.length<2){warnings.add('경로를 찾지 못한 연결선이 있습니다. 보드에서 경로를 조절하세요.');continue;}
    for(let i=1;i<ps.length;i++)segment(ps[i-1],ps[i],e.color,e.width,e.dashed);
    if(e.arrow!=='none')arrow(ps.at(-1)!,ps.at(-2)!,e.color,e.width);if(e.arrow==='both')arrow(ps[0],ps[1],e.color,e.width);
    const label=labels.get(e.id);if(label){
     for(let j=1;j<label.leader.length;j++)segment(label.leader[j-1],label.leader[j],e.color,.7,true);
     if(!visible(label.box))continue;
     const angle=-label.angle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
     page.pushOperators(lib.pushGraphicsState(),lib.concatTransformationMatrix(c,s,-s,c,x(label.center.x),y(label.center.y)));
     page.drawRectangle({x:-label.textWidth*scale/2,y:-label.textHeight*scale/2,width:label.textWidth*scale,height:label.textHeight*scale,color:color(e.labelBackground??'#FFFFFF')});
     const size=12*scale;label.lines.forEach((line,i)=>page.drawText(line,{x:-font.widthOfTextAtSize(line,size)/2,y:(label.textHeight/2-12-i*16)*scale-size*.35,font,size,color:color(e.color)}));
     page.pushOperators(lib.popGraphicsState());
    }
   }
   for(const n of board.nodes.filter(n=>n.kind!=='frame'))await paintNode(n);
   page.pushOperators(lib.popGraphicsState());
  }
 }
 return {bytes:await pdf.save(),warnings:[...warnings]};
}
