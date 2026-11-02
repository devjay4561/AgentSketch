import {validateDocument} from './model.ts';
import {renderPNG,renderSVG} from './renderer.ts';
import {exportCSV,exportDrawio,importCSV,importDrawio} from './interchange.ts';
import {renderEvidenceReport} from './report-export.ts';
import {exportDocuments,exportExchangeDocument,createPowerPoint,createVectorPDF} from './export-binary.ts';
import {importImages} from './persistence.ts';
import {fitTextHeight} from './text-fit.ts';
const base64=(bytes:Uint8Array)=>{let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);};
export async function renderAutomation(request:any):Promise<any>{
 await document.fonts.load('500 16px "Pretendard Variable"','월간보고 AgentSketch');
 if(request.command==='image.import'){const data=Uint8Array.from(atob(request.data),c=>c.charCodeAt(0));return importImages([new File([data],request.name,{type:request.mime})],request.at??{x:0,y:0});}
 if(request.command==='document.import'){if(request.format==='drawio')return importDrawio(request.text);if(request.format==='csv')return importCSV(request.text);return {document:validateDocument(JSON.parse(request.text)),warnings:[]};}
 const doc=validateDocument(request.document),options={...request.options,...(request.options?.selection?{selection:new Set<string>(request.options.selection)}:{})};
 if(request.command==='text.fit'){const ctx=document.createElement('canvas').getContext('2d')!;const nodes=doc.nodes.filter(n=>request.ids?.includes(n.id));fitTextHeight(nodes,ctx);return nodes.map(n=>({command:'node.update',args:{ids:[n.id],props:{h:n.h}}}));}
 const format=request.format,flat=exportDocuments(doc,{...options,pages:false})[0];
 if(format==='png')return {data:(await renderPNG(flat,request.scale??1)).split(',')[1],encoding:'base64',mime:'image/png',warnings:[]};
 if(format==='svg')return {data:renderSVG(flat),encoding:'utf8',mime:'image/svg+xml',warnings:[]};
 if(format==='pdf'){const font=new Uint8Array(await (await fetch('/fonts/AgentSketchExport-Regular.ttf')).arrayBuffer());const out=await createVectorPDF(doc,font,options);return {data:base64(out.bytes),encoding:'base64',mime:'application/pdf',warnings:out.warnings};}
 if(format==='pptx'){const out=await createPowerPoint(doc,options);return {data:out.base64,encoding:'base64',mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation',warnings:out.warnings};}
 if(format==='html')return {data:renderEvidenceReport(flat,options),encoding:'utf8',mime:'text/html',warnings:[]};
 const exchange=exportExchangeDocument(doc,options),valid=validateDocument(exchange.document);
 if(format==='agentsketch')return {data:JSON.stringify(valid,null,2),encoding:'utf8',mime:'application/json',warnings:exchange.warnings};
 if(format==='csv')return {data:exportCSV(valid),encoding:'utf8',mime:'text/csv',warnings:exchange.warnings};
 if(format==='drawio'){const out=exportDrawio(valid);return {data:out.text,encoding:'utf8',mime:'application/xml',warnings:[...exchange.warnings,...out.warnings]};}
 throw new Error('지원하지 않는 출력 형식');
}
(window as any).AgentSketchRender=renderAutomation;
