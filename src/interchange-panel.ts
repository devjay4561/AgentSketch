import type { WorkbenchHost } from './workspace-types.ts';
import type { FlowDocument } from './types.ts';
import type { ExportOptions } from './export-binary.ts';
import { cloneDocument, validateDocument } from './model.ts';
import { importCSV, exportCSV, importDrawio, exportDrawio } from './interchange.ts';
import { renderEvidenceReport } from './report-export.ts';
import { renderSVG } from './renderer.ts';
import { exportDocuments, exportExchangeDocument, pdfPageCount } from './export-binary.ts';
import './interchange.css';

type ArtifactAPI={SaveArtifact(name:string,kind:string,data:string):Promise<string>;ExportFile(name:string,kind:string,data:string):Promise<string>};
const bridge=()=> (window as unknown as {go?:{main?:{App?:ArtifactAPI}}}).go?.main?.App;
function base64(bytes:Uint8Array){let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
async function saveArtifact(name:string,kind:string,data:string,binary=false){
 const api=bridge();if(api){const path=kind==='svg'?await api.ExportFile(name,'svg',data):await api.SaveArtifact(name,kind,data);return !!path;}
 const bytes=binary?Uint8Array.from(atob(data),c=>c.charCodeAt(0)):data;
 const mime:Record<string,string>={html:'text/html',csv:'text/csv',drawio:'application/xml',agentsketch:'application/json',svg:'image/svg+xml','pdf-vector':'application/pdf',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
 const blob=new Blob([bytes],{type:mime[kind]||'application/octet-stream'}),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=name.replace(/[<>:"/\\|?*]/g,'_')+'.'+(kind==='pdf-vector'?'pdf':kind);link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);return true;
}
export function mountInterchangePanel(host:WorkbenchHost,container:HTMLElement){
 container.classList.add('interchange-panel');
 container.innerHTML=`<section class="exchange-section"><h3>내보낼 범위</h3><div class="exchange-fields"><label>대상<select data-exchange="scope"><option value="all">전체 문서</option><option value="selection">선택한 요소</option></select></label><label>용지<select data-exchange="paper"><option value="a4">A4</option><option value="a3">A3</option></select></label><label>방향<select data-exchange="direction"><option value="landscape">가로</option><option value="portrait">세로</option></select></label><label class="exchange-check"><input type="checkbox" data-exchange="pages" checked>보드 페이지별로 나누기</label><label class="exchange-check"><input type="checkbox" data-exchange="notes">보고서에 내부 메모 포함</label></div><p class="exchange-count" aria-live="polite"></p></section><section class="exchange-section"><h3>보고용 파일</h3><button data-exchange-action="pdf-vector"><strong>검색 가능한 PDF</strong><span>도형과 선은 벡터, 한글 글꼴 포함</span></button><button data-exchange-action="pptx"><strong>편집 가능한 PowerPoint</strong><span>글자·도형·선·이미지를 개별 편집</span></button><button data-exchange-action="html"><strong>자료 준비 현황 보고서</strong><span>담당자·출처·확인 기록과 도식 · HTML</span></button><button data-exchange-action="svg"><strong>벡터 이미지 SVG</strong><span>선택 범위 또는 전체 보드 한 장</span></button></section><section class="exchange-section"><h3>다른 도구와 교환</h3><button data-exchange-action="csv"><strong>Excel에서 편집할 CSV</strong><span>요소·연결·업무 정보와 원본 속성</span></button><button data-exchange-action="drawio"><strong>draw.io 문서</strong><span>기본 도형과 연결선 · 변환 범위 안내</span></button><button data-exchange-action="agentsketch"><strong>원본 프로젝트 묶음</strong><span>이미지·자료 정보가 포함된 .agentsketch</span></button></section><section class="exchange-section"><h3>가져오기</h3><p>CSV·draw.io·AgentSketch 파일을 확인한 뒤 새 문서로 엽니다. 압축된 draw.io XML은 지원하지 않습니다.</p><input type="file" accept=".csv,.drawio,.xml,.agentsketch,.flowpaper,.json" data-exchange="file" aria-label="가져올 문서 선택"><div class="exchange-import" hidden><p data-exchange="preview"></p><button data-exchange-action="import">확인한 문서를 열기</button></div></section><p class="exchange-result" role="status"></p>`;
 const find=<T extends HTMLElement>(selector:string)=>container.querySelector<T>(selector)!;
 const result=find<HTMLElement>('.exchange-result');let pending:FlowDocument|undefined,busy=false;
 const fields=find('.exchange-fields');
 find('.exchange-count').insertAdjacentHTML('afterend','<p class="exchange-scope-note" aria-live="polite"></p>');
 fields.insertAdjacentHTML('beforeend',`<label>PDF 배치<select data-exchange="print-mode"><option value="fit">보드 한 장에 맞추기</option><option value="tile">원본 크기로 여러 장</option></select></label><label>여백 (mm)<input type="number" data-exchange="margin" value="10" min="5" max="40" step="1"></label><label>타일 인쇄 배율 (%)<input type="number" data-exchange="scale" value="100" min="25" max="200" step="25" disabled></label><p class="exchange-print-hint">원본 크기 100%는 보드 96px를 1인치로 인쇄합니다. 타일은 왼쪽부터 오른쪽, 위에서 아래로 나뉩니다.</p>`);
 const options=():ExportOptions=>({scope:find<HTMLSelectElement>('[data-exchange=scope]').value as 'all'|'selection',selection:new Set(host.getSelection()),paper:find<HTMLSelectElement>('[data-exchange=paper]').value as 'a4'|'a3',landscape:find<HTMLSelectElement>('[data-exchange=direction]').value==='landscape',pages:find<HTMLInputElement>('[data-exchange=pages]').checked,includeInternalNotes:find<HTMLInputElement>('[data-exchange=notes]').checked,marginMm:Number(find<HTMLInputElement>('[data-exchange=margin]').value||10),printMode:find<HTMLSelectElement>('[data-exchange=print-mode]').value as 'fit'|'tile',printScalePercent:Number(find<HTMLInputElement>('[data-exchange=scale]').value||100)});
 const setBusy=(value:boolean)=>{busy=value;container.setAttribute('aria-busy',String(value));container.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=value);};
 find<HTMLInputElement>('[data-exchange=file]').addEventListener('change',async event=>{
  const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;pending=undefined;find('.exchange-import').hidden=true;
  try{if(file.size>80*1024*1024)throw new Error('가져오기 파일은 80MB 이하여야 합니다.');const raw=await file.text(),type=file.name.split('.').at(-1)?.toLowerCase();const imported=type==='csv'?importCSV(raw):type==='drawio'||type==='xml'?importDrawio(raw):{document:validateDocument(JSON.parse(raw)),warnings:[]};pending=imported.document;find('[data-exchange=preview]').textContent=`${pending.title} · ${pending.nodes.length}개 요소 · ${pending.edges.length}개 연결`;find('.exchange-import').hidden=false;result.textContent=imported.warnings.join('\n')||'문서를 확인했습니다. 열기 버튼으로 적용하세요.';}catch(error){result.textContent=String(error);}
 });
 container.addEventListener('click',async event=>{
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-exchange-action]');if(!button||busy)return;const kind=button.dataset.exchangeAction!;
  if(kind==='import'){if(pending){const opened=await host.replaceDocument(pending);if(opened===false){result.textContent='문서 열기를 취소했습니다.';return;}pending=undefined;find('.exchange-import').hidden=true;host.fit();result.textContent='가져온 문서를 열었습니다.';}return;}
  setBusy(true);result.textContent='파일을 준비하고 있습니다…';
  try{
   const doc=cloneDocument(host.getDocument()),opts=options(),boards=exportDocuments(doc,opts);let content='',binary=false,warnings:string[]=[];
   if(kind==='pptx'){const {createPowerPoint}=await import('./export-binary.ts');const out=await createPowerPoint(doc,opts);content=out.base64;binary=true;warnings=out.warnings;}
   else if(kind==='pdf-vector'){const {createVectorPDF}=await import('./export-binary.ts');const response=await fetch('/fonts/AgentSketchExport-Regular.ttf');if(!response.ok)throw new Error('PDF 글꼴을 불러오지 못했습니다.');const out=await createVectorPDF(doc,new Uint8Array(await response.arrayBuffer()),opts);content=base64(out.bytes);binary=true;warnings=out.warnings;}
   else if(kind==='html')content=renderEvidenceReport(doc,opts);
   else {const editable=['csv','drawio','agentsketch'].includes(kind),exchange=editable?exportExchangeDocument(doc,opts):undefined,flat=exchange?validateDocument(exchange.document):opts.scope==='selection'?boards[0]:doc;if(exchange)warnings.push(...exchange.warnings);
    if(kind==='csv')content=exportCSV(flat);
    if(kind==='drawio'){const out=exportDrawio(flat);content=out.text;warnings.push(...out.warnings);}
    if(kind==='svg')content=renderSVG(flat);
    if(kind==='agentsketch')content=JSON.stringify(flat,null,2);
   }
   const saved=await saveArtifact(doc.title,kind,content,binary);result.textContent=(saved?'파일을 내보냈습니다.':'저장을 취소했습니다.')+(warnings.length?'\n'+warnings.join('\n'):'');
  }catch(error){result.textContent=String(error);host.toast('내보내지 못했습니다. 보고 패널의 안내를 확인하세요.',true);}finally{setBusy(false);}
 });
 fields.addEventListener('change',()=>{for(const key of ['margin','scale']){const input=find<HTMLInputElement>(`[data-exchange=${key}]`);input.value=String(Math.max(Number(input.min),Math.min(Number(input.max),Number(input.value)||Number(key==='margin'?10:100))));}update();});
 function update(){
  find<HTMLInputElement>('[data-exchange=scale]').disabled=find<HTMLSelectElement>('[data-exchange=print-mode]').value!=='tile';
  const summary=`${host.getDocument().nodes.length}개 요소 · ${host.getSelection().size}개 선택`;
  try{find('.exchange-scope-note').textContent=exportExchangeDocument(host.getDocument(),options()).warnings.join('\n');}catch{find('.exchange-scope-note').textContent='';}
  try{find('.exchange-count').textContent=`${summary} · PDF ${pdfPageCount(host.getDocument(),options())}페이지 예상`;}catch(error){find('.exchange-count').textContent=`${summary} · ${error instanceof Error?error.message:String(error)}`;}
 }
 update();return {update};
}
