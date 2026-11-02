import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import JSZip from 'jszip';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {createNode,emptyDocument,validateDocument} from './model.ts';
import {createPowerPoint,createVectorPDF,exportDocuments,exportExchangeDocument,pdfPageCount,exportBounds} from './export-binary.ts';
import {exportCSV,importCSV} from './interchange.ts';
import {planPages} from './pdf-pagination.ts';
import {renderEvidenceReport} from './report-export.ts';
import {renderViewerHTML} from './viewer-export.ts';
function fixture(){const doc=emptyDocument();doc.title='월간보고 <script> 검사';const a=createNode('rect',0,50),b=createNode('diamond',400,50);a.text='매출 확인\n다음 단계';a.details={role:'resource',owner:'김담당',status:'verified',source:'C:\\자료\\매출.xlsx',checkedBy:'검토자',checkedAt:'2026-10-30T00:00:00Z',version:'v1',verifiedVersion:'v1',checklist:[{id:'c',text:'수량 확인',done:true}]};b.text='월간보고';doc.nodes=[a,b];doc.edges=[{id:'edge',from:a.id,to:b.id,fromPort:'right',toPort:'left',label:'확인 후 진행',color:'#666666',width:2,style:'elbow',arrow:'both',dashed:false}];return doc;}

const regularFont=readFile('public/fonts/AgentSketchExport-Regular.ttf');
const semiboldFont=readFile('public/fonts/AgentSketchExport-Semibold.ttf');
function contentStream(pdf:PDFDocument,index=0):string {
 const value=pdf.getPage(index).node.Contents();
 const streams=value instanceof PDFArray?Array.from({length:value.size()},(_,i)=>value.lookup(i,PDFRawStream)):value?[pdf.context.lookup(value,PDFRawStream)]:[];
 return streams.map(stream=>new TextDecoder().decode(decodePDFRawStream(stream).decode())).join('\n');
}
/** Read the actual embedded CMap and drawing instructions, independently of the exporter layout. */
function textRecords(pdf:PDFDocument,index=0){
 const fonts=pdf.getPage(index).node.Resources()!.lookup(PDFName.of('Font'),PDFDict),maps=new Map<string,Map<string,string>>();
 return [...contentStream(pdf,index).matchAll(/BT\n([\s\S]*?)\nET/g)].map(([,block])=>{
  const font=/\/([^\s]+) ([\d.]+) Tf/.exec(block);assert.ok(font,'text must select an embedded font');
  const resource=fonts.lookup(PDFName.of(font[1]),PDFDict),face=resource.get(PDFName.of('BaseFont'))!.toString();
  let map=maps.get(face);if(!map){
   const cmap=new TextDecoder().decode(decodePDFRawStream(resource.lookup(PDFName.of('ToUnicode'),PDFRawStream)).decode());
   map=new Map([...cmap.matchAll(/^<([\da-f]{4})>\s+<([\da-f]+)>$/gim)].map(([,from,to])=>[from.toUpperCase(),String.fromCharCode(...to.match(/.{4}/g)!.map(code=>parseInt(code,16)))]));maps.set(face,map);
  }
  const text=[...block.matchAll(/<([\da-f]+)> Tj/gi)].flatMap(([,value])=>value.match(/.{4}/g)!.map(code=>map!.get(code.toUpperCase())??'\uFFFD')).join('');
  const fill=/([\d.]+) ([\d.]+) ([\d.]+) rg/.exec(block),matrix=/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm/.exec(block);
  return {text,face,size:Number(font[2]),fill:fill?.slice(1).map(Number),position:matrix?.slice(5).map(Number)};
 });
}
function almost(actual:number,expected:number){assert.ok(Math.abs(actual-expected)<1e-7,`${actual} differs from ${expected}`);}
test('PPTX exports real editable shapes and Unicode text instead of a screenshot',async()=>{const doc=fixture(),out=await createPowerPoint(doc);const zip=await JSZip.loadAsync(out.base64,{base64:true});const xml=await zip.file('ppt/slides/slide1.xml')!.async('text');assert.ok(xml.includes('매출 확인'));assert.ok(xml.includes('월간보고'));assert.ok(xml.includes('<p:sp>'));assert.ok(!xml.includes('<p:pic>'));assert.ok(xml.includes('prst="diamond"'));assert.ok(out.warnings.length);});
test('vector PDF embeds Korean font and contains text/vector operators',async()=>{const out=await createVectorPDF(fixture(),new Uint8Array(await readFile('public/fonts/AgentSketchExport-Regular.ttf')));const pdf=await PDFDocument.load(out.bytes);assert.equal(pdf.getPageCount(),1);assert.equal(pdf.getPage(0).getWidth(),842);assert.ok(out.bytes.length>800000,'full static font must remain embedded to prevent broken Korean subset glyphs');const fonts=pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Font'),PDFDict);assert.ok(fonts.keys().length);const embedded=fonts.lookup(fonts.keys()[0],PDFDict);assert.ok(embedded.has(PDFName.of('ToUnicode')));});
test('report escapes text and retains source/verification/checklist evidence',()=>{const html=renderEvidenceReport(fixture(),{},new Date('2026-10-30'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('검토자'));assert.ok(html.includes('수량 확인'));assert.ok(html.includes('준비 완료'));assert.ok(html.includes('<svg'));});
test('selection and page export never leave dangling edges',()=>{const doc=fixture();doc.workspace={pages:[{id:'p1',name:'첫 페이지'},{id:'p2',name:'둘째 페이지'}]};doc.nodes[1].details={pageId:'p2'};const split=exportDocuments(doc,{pages:true});assert.equal(split.length,2);assert.ok(split.every(p=>p.nodes.length===1&&p.edges.length===0));assert.throws(()=>exportDocuments(doc,{scope:'selection',selection:new Set()}));const selected=exportDocuments(doc,{scope:'selection',selection:new Set([doc.nodes[0].id])})[0];assert.equal(selected.nodes.length,1);assert.equal(selected.edges.length,0);});

test('selection exchange recursively includes cross-page condition sources and reopens through JSON and CSV',()=>{
 const doc=emptyDocument();doc.title='선택 범위 조건 보존';
 const ids=['selected-a','selected-b','condition-c','condition-d','condition-e','unrelated','unused-condition'];
 doc.nodes=ids.map((id,index)=>{const node=createNode('rect',index*260,0);node.id=id;node.text=id;return node;});
 for(const node of doc.nodes.slice(2,5))node.details={role:'resource',pageId:'source-page',layerId:'source-layer',customFields:{market:'수출'}};
 doc.nodes[5].details={pageId:'private-page'};doc.nodes[6].details={pageId:'private-page'};
 doc.workspace={pages:[{id:'main-page',name:'절차'},{id:'source-page',name:'원천 자료'},{id:'private-page',name:'무관한 자료'}],activePageId:'main-page',layers:[{id:'source-layer',name:'조건 자료'}]};
 const edge=(id:string,from:string,to:string,source:string)=>({id,from,to,label:id,fromPort:'right' as const,toPort:'left' as const,style:'elbow' as const,width:2,color:'#67768A',dashed:false,arrow:'end' as const,condition:{nodeId:source,field:'market',operator:'equals' as const,value:'수출'}});
 // Deliberately list the deepest dependency first: one pass over edges is insufficient.
 doc.edges=[edge('deep','condition-c','condition-d','condition-e'),edge('next','selected-b','condition-c','condition-d'),edge('selected','selected-a','selected-b','condition-c'),edge('outside','unrelated','selected-b','unused-condition')];
 const before=JSON.stringify(doc),selection=new Set(['selected-a','selected-b']),options={scope:'selection' as const,selection};
 const result=exportExchangeDocument(doc,options),expected=['selected-a','selected-b','condition-c','condition-d','condition-e'];
 assert.deepEqual(result.document.nodes.map(node=>node.id),expected);
 assert.deepEqual(result.document.edges.map(e=>e.id),['deep','next','selected']);
 assert.deepEqual(result.document.workspace?.pages?.map(page=>page.id),['main-page','source-page']);
 assert.ok(result.warnings.length,'expanded selection must be disclosed to the user');
 for(const restored of [validateDocument(JSON.parse(JSON.stringify(result.document))),importCSV(exportCSV(result.document)).document]){
  assert.deepEqual(restored.nodes.map(node=>node.id),expected);
  assert.deepEqual(restored.edges.map(e=>e.condition),doc.edges.slice(0,3).map(e=>e.condition));
  assert.equal(restored.nodes.find(node=>node.id==='condition-e')?.details?.customFields?.market,'수출');
  assert.ok(restored.edges.every(e=>!e.condition||restored.nodes.some(node=>node.id===e.condition!.nodeId)));
 }
 assert.equal(JSON.stringify(doc),before,'export and both reopen paths must leave original conditions and scope untouched');
 assert.deepEqual([...selection],['selected-a','selected-b']);
 const visual=exportDocuments(doc,options)[0];assert.deepEqual(visual.nodes.map(node=>node.id),['selected-a','selected-b']);assert.equal(visual.edges.length,1,'visual export must retain the requested scope');
});

test('selection exchange rejects missing condition sources without stripping the condition',()=>{
 const doc=fixture();doc.edges[0].condition={nodeId:'missing-condition',field:'market',operator:'equals',value:'수출'};
 const before=JSON.stringify(doc),selection=new Set(doc.nodes.map(node=>node.id));
 assert.throws(()=>exportExchangeDocument(doc,{scope:'selection',selection}),/참조 요소/);
 assert.throws(()=>exportExchangeDocument(doc,{scope:'selection',selection:new Set()}),/선택/);
 assert.equal(JSON.stringify(doc),before);
});

test('report defaults hide internal notes and explicit opt-in includes them',()=>{const doc=fixture();doc.nodes[0].details!.notes='내부 참고 문구';const note=createNode('note',20,300);note.text='숨길 메모 요소';doc.nodes.push(note);const hidden=renderEvidenceReport(doc);assert.ok(!hidden.includes('내부 참고 문구'));assert.ok(!hidden.includes('숨길 메모 요소'));const shown=renderEvidenceReport(doc,{includeInternalNotes:true});assert.ok(shown.includes('내부 참고 문구'));assert.ok(shown.includes('숨길 메모 요소'));});

test('selection export excludes unrelated images attachments and private review metadata',()=>{const doc=fixture();doc.assets.unused={id:'unused',name:'비공개 이미지',width:1,height:1,data:'unused'};doc.workspace={attachments:[{id:'private',name:'비공개 첨부',mime:'text/plain',size:1,data:'data:text/plain;base64,QQ=='}],comments:[{id:'comment',nodeId:doc.nodes[1].id,author:'검토자',text:'비공개 검토',createdAt:'2026-10-30T00:00:00Z'}],layers:[{id:'unused-layer',name:'비공개 레이어'}]};const part=exportDocuments(doc,{scope:'selection',selection:new Set([doc.nodes[0].id])})[0];assert.deepEqual(part.assets,{});assert.deepEqual(part.workspace!.attachments,[]);assert.deepEqual(part.workspace!.comments,[]);assert.deepEqual(part.workspace!.layers,[]);});

test('PDF retains each rich text run with its embedded font, color and relative size',async()=>{
 const doc=emptyDocument(),node=createNode('text',0,0);node.w=650;node.h=250;node.text='Normal 굵게 Large';
 node.textRuns=[{text:'Normal ',fontSize:12,color:'#123456'},{text:'굵게 ',fontSize:20,bold:true,color:'#CC3300'},{text:'Large',fontSize:28,color:'#0044CC'}];doc.nodes=[node];
 const out=await createVectorPDF(doc,await regularFont,{boldFontBytes:await semiboldFont,printMode:'tile',printScalePercent:100});
 const pdf=await PDFDocument.load(out.bytes),records=textRecords(pdf).slice(1);
 assert.deepEqual(records.map(run=>run.text),['Normal ','굵게 ','Large']);
 assert.match(records[0].face,/Regular/);assert.match(records[1].face,/Semibold/);assert.match(records[2].face,/Regular/);
 assert.deepEqual(records.map(run=>run.size),[9,15,21]);
 assert.deepEqual(records.map(run=>run.fill),[[0x12/255,0x34/255,0x56/255],[.8,.2,0],[0,0x44/255,.8]]);
 assert.ok(out.bytes.length>1_600_000,'both complete font programs must be embedded');
 assert.deepEqual(out.warnings,[]);
});

test('oversized rich text and table bodies are retained in the PDF rather than truncated',async()=>{
 const doc=emptyDocument(),rich=createNode('rect',0,0),table=createNode('rect',300,0),checklist=createNode('rect',600,0);
 rich.w=180;rich.h=75;rich.text=Array.from({length:35},(_,i)=>`확인${i+1}`).join(' ');rich.textRuns=[{text:rich.text,bold:true}];
 table.w=240;table.h=95;table.text='자료 목록';table.contentMode='table';table.table={columns:['자료','담당'],rows:Array.from({length:12},(_,i)=>[`매출 ${i+1}`,`담당 ${i+1}`])};
 checklist.w=220;checklist.h=80;checklist.contentMode='checklist';checklist.details={checklist:Array.from({length:15},(_,i)=>({id:String(i),text:`검토 항목 ${i+1}`,done:i%2===0}))};doc.nodes=[rich,table,checklist];
 const out=await createVectorPDF(doc,await regularFont,{boldFontBytes:await semiboldFont});const pdf=await PDFDocument.load(out.bytes);
 const text=textRecords(pdf).slice(1).map(run=>run.text).join('');
 assert.ok(text.includes(rich.text),'all wrapped rich text must survive export');assert.ok(text.includes('자료 목록자료담당'));
 for(let i=1;i<=12;i++)assert.ok(text.includes(`매출 ${i}담당 ${i}`),`table row ${i} is missing`);
 for(let i=1;i<=15;i++)assert.ok(text.includes(`검토 항목 ${i}`),`checklist item ${i} is missing`);
 assert.ok(!text.includes('\uFFFD'),'Korean glyphs must remain mapped to Unicode');
});

test('a large glyph in a narrow node stays inside its text box without dropping the glyph',async()=>{
 const doc=emptyDocument(),node=createNode('rect',100,50);node.w=60;node.h=500;node.fontSize=128;node.text='원';node.textRuns=[{text:'원'}];doc.nodes=[node];
 const options={printMode:'tile' as const,printScalePercent:100},plan=planPages(exportBounds(doc),options)[0];
 const out=await createVectorPDF(doc,await regularFont,options),pdf=await PDFDocument.load(out.bytes),body=textRecords(pdf).slice(1);
 assert.equal(body.length,1);assert.equal(body[0].text,'원');assert.ok(body[0].position);
 const {default:fontkit}=await import('@pdf-lib/fontkit'),font=fontkit.create(await regularFont);
 const actualWidth=font.glyphForCodePoint('원'.codePointAt(0)!).advanceWidth/font.unitsPerEm*body[0].size;
 const left=plan.clip.x+(node.x+14-plan.origin.x)*plan.scale,right=plan.clip.x+(node.x+node.w-14-plan.origin.x)*plan.scale;
 assert.ok(body[0].position[0]>=left-1e-7,'negative centered-run offset must be corrected');
 assert.ok(body[0].position[0]+actualWidth<=right+1e-7,'the full glyph width must fit the narrow node');
 assert.ok(body[0].size<node.fontSize*plan.scale,'horizontal overflow must trigger shrink even with ample node height');
});

test('tiled PDF matches its preview count and clips every sheet to the requested print margins',async()=>{
 const doc=emptyDocument(),canvas=createNode('rect',-250,-100);canvas.w=1800;canvas.h=1100;canvas.text='';canvas.fill='#FFF0E5';
 const first=createNode('text',-200,-50),last=createNode('text',1300,850);first.text='왼쪽 위';last.text='오른쪽 아래';doc.nodes=[canvas,first,last];
 const options={paper:'a4' as const,landscape:true,marginMm:20,printMode:'tile' as const,printScalePercent:100};
 const plans=planPages(exportBounds(doc),options),preview=pdfPageCount(doc,options),out=await createVectorPDF(doc,await regularFont,options),pdf=await PDFDocument.load(out.bytes);
 assert.equal(preview,4);assert.equal(pdf.getPageCount(),preview);assert.equal(plans.length,preview);
 for(let i=0;i<preview;i++){
  assert.deepEqual(pdf.getPage(i).getSize(),{width:842,height:595});
  const stream=contentStream(pdf,i),clip=/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re\nW\nn/.exec(stream);assert.ok(clip,'each page needs a rectangular clip before drawing diagram contents');
  const actual=clip.slice(1).map(Number),expected=[plans[i].clip.x,plans[i].clip.y,plans[i].clip.w,plans[i].clip.h];actual.forEach((value,j)=>almost(value,expected[j]));
  almost(actual[0],20*72/25.4);almost(actual[1],20*72/25.4);
  const records=textRecords(pdf,i);assert.ok(records[0].text.includes(`${plans[i].row+1}행 ${plans[i].column+1}열`));
 }
 assert.ok(textRecords(pdf,0).some(run=>run.text==='왼쪽 위'));assert.ok(!textRecords(pdf,0).some(run=>run.text==='오른쪽 아래'));
 assert.ok(textRecords(pdf,3).some(run=>run.text==='오른쪽 아래'));assert.ok(!textRecords(pdf,3).some(run=>run.text==='왼쪽 위'));
});

test('PDF and editable PPTX preserve the edge label background and right-angle orientation',async()=>{
 const doc=fixture();doc.edges[0].labelBackground='#FFF0E5';doc.edges[0].labelAngle=90;
 const out=await createVectorPDF(doc,await regularFont),pdf=await PDFDocument.load(out.bytes),stream=contentStream(pdf);
 assert.ok(textRecords(pdf).some(run=>run.text==='확인 후 진행'));
 const matrices=[...stream.matchAll(/^([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm$/gm)].map(match=>match.slice(1).map(Number));
 assert.ok(matrices.some(([a,b,c,d])=>Math.abs(a)<1e-10&&b===-1&&c===1&&Math.abs(d)<1e-10),'PDF label must apply a clockwise quarter-turn transform');
 const fills=[...stream.matchAll(/^([\d.]+) ([\d.]+) ([\d.]+) rg$/gm)].map(match=>match.slice(1).map(Number));
 assert.ok(fills.some(([r,g,b])=>r===1&&g===0xF0/255&&b===0xE5/255));
 const pptx=await createPowerPoint(doc),zip=await JSZip.loadAsync(pptx.base64,{base64:true}),xml=await zip.file('ppt/slides/slide1.xml')!.async('text');
 const shape=xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g)!.find(value=>value.includes('확인 후 진행'));assert.ok(shape);
 assert.match(shape,/rot="5400000"/);assert.match(shape,/<a:srgbClr val="FFF0E5"\/>/);
});
test('viewer html keeps one script and escapes document text',()=>{const html=renderViewerHTML(fixture()).toLowerCase();assert.equal(html.split('<script').length-1,1);assert.ok(!html.includes('javascript:'));assert.ok(html.includes('&lt;script&gt;')||html.includes('&#60;script'));assert.ok(html.includes('<svg'));});
