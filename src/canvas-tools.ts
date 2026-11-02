import './canvas-tools.css';
import {fitTextHeight} from './text-fit.ts';
import type { FlowNode, Port, ShapeKind } from './types.ts';
import type { CropRegion, WorkbenchHost } from './workspace-types.ts';
import { importImages } from './persistence.ts';
import { DOCUMENT_LIMITS } from './model.ts';
import { availableRouteSegments, fixRouteSegment, releaseRouteSegment, fixedRouteSegments } from './route-segments.ts';
import { editableNodeIds } from './organization.ts';
import { saveNodeDefaults, saveEdgeDefaults, applyNodeDefaults, applyEdgeDefaults, resetStyleDefaults, readStyleDefaults } from './style-defaults.ts';
import { addNextStep, splitConnection } from './diagram-actions.ts';
import { measureRichContentHeight } from './rich-render.ts';
import { setNodePlainText, formatNodeTextRange, setNodeTable, setNodeChecklist, safeTextHref } from './rich-text.ts';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const shapeNames: Partial<Record<ShapeKind,string>> = {rect:'사각형',round:'둥근 사각형',ellipse:'타원',diamond:'판단',text:'텍스트',note:'메모',frame:'영역 상자'};
const ports: Record<Port,string> = {top:'위',right:'오른쪽',bottom:'아래',left:'왼쪽'};
type Format = Pick<FlowNode,'fill'|'stroke'|'color'|'fontSize'|'bold'|'align'|'strokeWidth'|'dashed'|'opacity'>;

export function boundedCrop(input: CropRegion): CropRegion {
  const finite = (value:number,fallback:number) => Number.isFinite(value)?value:fallback;
  const x=Math.max(0,Math.min(.99,finite(input.x,0))),y=Math.max(0,Math.min(.99,finite(input.y,0)));
  return {x,y,w:Math.max(.01,Math.min(1-x,finite(input.w,1))),h:Math.max(.01,Math.min(1-y,finite(input.h,1)))};
}

export function anchorForPort(port: Port, offset: number) {
  const at=Math.max(0,Math.min(1,Number.isFinite(offset)?offset:.5));
  return port==='left'?{x:0,y:at}:port==='right'?{x:1,y:at}:port==='top'?{x:at,y:0}:{x:at,y:1};
}

/** Reusable panel. No timers, document copies or decoded images are retained. */
export function mountCanvasTools(host: WorkbenchHost, container: HTMLElement) {
  container.classList.add('canvas-tools');
  let copiedFormat: Format|undefined, signature='', busy=false, disposed=false;
  const selectedNodes=()=>host.getDocument().nodes.filter(n=>host.getSelection().has(n.id));
  let editableIds=new Set<string>();
  const refreshEditable=()=>{editableIds=editableNodeIds(host.getDocument());};
  const locked=(node:FlowNode)=>!editableIds.has(node.id);
  const editable=()=>selectedNodes().filter(n=>!locked(n));
  const button=(action:string,label:string,disabled=false)=>`<button type="button" data-canvas-action="${action}"${disabled?' disabled':''}>${label}</button>`;
  const defaultsSection=(canSave:boolean,canApply:boolean)=>`<details class="ct-defaults"><summary>기본 서식</summary><div class="ct-actions">${button('save-default','기본 서식으로 저장',!canSave)}${button('apply-default','기본 서식 적용',!canApply)}${button('reset-default','기본 서식 초기화')}</div><p class="ct-help">새 요소와 연결선에 사용할 서식을 이 기기에 보관합니다. 내용·자료 정보는 저장하지 않습니다.</p></details>`;
  function update() {
    if(disposed)return;refreshEditable();
    const doc=host.getDocument(), nodes=selectedNodes(), node=nodes.length===1?nodes[0]:undefined, edge=doc.edges.find(e=>e.id===host.getSelectedEdge());
    const nextSignature=nodes.map(n=>n.id).join('|')+'#'+(edge?.id??'');
    if(nextSignature===signature&&container.contains(document.activeElement)&&document.activeElement?.matches('input,select,textarea'))return;
    const wasRichOpen=nextSignature===signature?container.querySelector<HTMLDetailsElement>('.ct-rich')?.open:undefined;
    const wasDefaultsOpen=nextSignature===signature?container.querySelector<HTMLDetailsElement>('.ct-defaults')?.open:undefined;
    const wasSegmentsOpen=nextSignature===signature?container.querySelector<HTMLDetailsElement>('.ct-segments')?.open:undefined;
    signature=nextSignature;
    const hasEditable=nodes.some(n=>!locked(n));
    let content='<h2>세밀하게 편집</h2><p class="ct-lead">작업지에서 요소나 연결선을 선택하세요.</p>';
    if(nodes.length){
      content=`<h2>${nodes.length===1?'선택 요소 편집':`${nodes.length}개 요소 편집`}</h2>`;
      content+=`<section><h3>서식과 글자</h3><div class="ct-actions">${button('copy-format','서식 복사',!node)}${button('paste-format','서식 붙이기',!copiedFormat||!hasEditable)}</div><div class="ct-actions">${button('fit-text','글자에 높이 맞춤',!hasEditable)}${button('bullet','글머리표 넣기',!hasEditable)}</div><p class="ct-help">잠긴 요소는 변경하지 않습니다. 서식은 이 실행 중에만 보관됩니다.</p></section>`;
      content+=defaultsSection(Boolean(node),hasEditable&&Boolean(readStyleDefaults().node));
      if(node){
        content+=`<div class="ct-actions">${button('next-step','다음 단계와 연결선 추가',locked(node))}</div>`;
        if(node.kind!=='draw'){
          const mode=node.contentMode??'text';
          const tableText=node.table?[node.table.columns,...node.table.rows].map(row=>row.join('\t')).join('\n'):node.text;
          const checklistText=node.details?.checklist?.map(item=>`[${item.done?'x':' '}] ${item.text}`).join('\n')??node.text;
          content+=`<details class="ct-rich"${(wasRichOpen??Boolean(mode!=='text'||node.textRuns?.length))?' open':''}><summary>부분 서식·표·체크리스트</summary><label>내용 형식<select data-canvas-field="content-mode" aria-label="내용 형식"${locked(node)?' disabled':''}><option value="text"${mode==='text'?' selected':''}>텍스트</option><option value="checklist"${mode==='checklist'?' selected':''}>체크리스트</option><option value="table"${mode==='table'?' selected':''}>표</option></select></label>`;
          if(mode==='text')content+=`<label>내용<textarea data-rich="text" aria-label="부분 서식 내용" rows="5" maxlength="50000"${locked(node)?' disabled':''}>${escape(node.text)}</textarea></label><div class="ct-actions">${button('save-text','내용 적용',locked(node))}${button('clear-text-format','부분 서식 지우기',locked(node))}</div><p class="ct-help">먼저 내용을 적용하세요. 아래 범위 또는 위 글자 선택 영역에 서식을 적용합니다.</p><div class="ct-grid"><label>시작 위치<input data-rich="start" aria-label="서식 시작 위치" type="number" min="0" max="${node.text.length}" value="0"${locked(node)?' disabled':''}></label><label>끝 위치<input data-rich="end" aria-label="서식 끝 위치" type="number" min="0" max="${node.text.length}" value="${node.text.length}"${locked(node)?' disabled':''}></label><label>굵기<select data-rich="bold" aria-label="부분 글자 굵기"${locked(node)?' disabled':''}><option value="keep">유지</option><option value="true">굵게</option><option value="false">보통</option></select></label><label>색상<input data-rich="color" aria-label="부분 글자 색상" type="color" value="${node.color==='transparent'?'#1c2024':escape(node.color)}"${locked(node)?' disabled':''}></label><label>크기 (px)<input data-rich="fontSize" aria-label="부분 글자 크기" type="number" min="6" max="200" value="${node.fontSize}"${locked(node)?' disabled':''}></label></div><label>링크 주소<input data-rich="href" aria-label="부분 글자 링크" type="url" placeholder="https:// 또는 mailto:" maxlength="2000"${locked(node)?' disabled':''}></label>${button('apply-text-format','선택 범위에 서식 적용',locked(node))}${button('clear-text-link','선택 링크 해제',locked(node))}`;
          else if(mode==='checklist')content+=`<label>한 줄에 한 항목<textarea data-rich="checklist" aria-label="체크리스트 내용" rows="8" maxlength="50000"${locked(node)?' disabled':''}>${escape(checklistText)}</textarea></label><p class="ct-help">완료 항목은 [x], 미완료 항목은 [ ]로 시작합니다.</p>${button('save-checklist','체크리스트 적용',locked(node))}`;
          else content+=`<label>첫 줄은 열 제목, 다음 줄은 내용<textarea data-rich="table" aria-label="표 내용" rows="8" maxlength="50000"${locked(node)?' disabled':''}>${escape(tableText)}</textarea></label><p class="ct-help">Excel에서 복사해 붙이세요. 열은 탭, 행은 줄바꿈으로 구분합니다.</p>${button('save-table','표 적용',locked(node))}`;
          const links=[...new Set((node.textRuns??[]).map(run=>run.href).filter((url):url is string=>Boolean(url)))];
          if(links.length)content+=`<div class="ct-actions">${links.map((url,i)=>`<button type="button" data-canvas-action="open-text-link" data-url="${escape(url)}" title="${escape(url)}">글자 링크 ${i+1} 열기</button>`).join('')}</div>`;
          content+='</details>';
        }
        if(node.kind!=='image'&&node.kind!=='draw') content+=`<section><h3>도형 바꾸기</h3><label>도형 종류<select data-canvas-field="kind" aria-label="도형 종류 변경"${locked(node)?' disabled':''}>${Object.entries(shapeNames).map(([kind,name])=>`<option value="${kind}"${node.kind===kind?' selected':''}>${name}</option>`).join('')}</select></label><p class="ct-help">내용, 연결, 자료 정보는 그대로 유지합니다.</p></section>`;
        if(node.kind==='image'){
          const crop=node.crop??{x:0,y:0,w:1,h:1};
          content+=`<section><h3>이미지</h3><div class="ct-actions">${button('replace-image',busy?'불러오는 중…':'이미지 교체',locked(node)||busy)}${button('reset-image','원래 보기',locked(node))}</div><p class="ct-help">교체해도 위치·설명·연결은 유지됩니다. 원본 화면을 바꾸므로 기존 자르기는 초기화합니다.</p><div class="ct-grid">${(['x','y','w','h'] as const).map((key,i)=>`<label>${['시작 X','시작 Y','너비','높이'][i]} (%)<input type="number" data-canvas-field="crop-${key}" aria-label="이미지 자르기 ${key}" min="${i>1?1:0}" max="100" step="1" value="${Math.round(crop[key]*100)}"${locked(node)?' disabled':''}></label>`).join('')}</div><label>이미지 내용 회전<select data-canvas-field="rotation" aria-label="이미지 회전"${locked(node)?' disabled':''}>${[0,90,180,270].map(angle=>`<option value="${angle}"${(node.rotation??0)===angle?' selected':''}>${angle}°</option>`).join('')}</select></label><p class="ct-help">상자와 연결점은 고정되고 이미지 내용만 회전합니다. 상자 밖으로 나가는 부분은 잘립니다.</p></section>`;
        }
      }
    }else if(edge){
      const optionNodes=doc.nodes.length<=1000?doc.nodes:[...doc.nodes.filter(n=>n.id===edge.from||n.id===edge.to),...doc.nodes.filter(n=>n.id!==edge.from&&n.id!==edge.to).slice(0,998)];
      content=`<h2>연결선 편집</h2><div class="ct-actions">${button('split-edge','중간 단계 삽입')}</div><section><h3>연결 대상</h3>`;
      for(const side of ['from','to'] as const){
        const port=edge[`${side}Port`],anchor=edge[`${side}Anchor`],offset=anchor?(port==='top'||port==='bottom'?anchor.x:anchor.y):.5;
        content+=`<label>${side==='from'?'시작 요소':'도착 요소'}<select data-canvas-field="${side}" aria-label="${side==='from'?'시작 요소 변경':'도착 요소 변경'}">${optionNodes.map(n=>`<option value="${escape(n.id)}"${edge[side]===n.id?' selected':''}>${escape((n.text||'이름 없는 요소').slice(0,60))}</option>`).join('')}</select></label><div class="ct-grid"><label>연결 면<select data-canvas-field="${side}-port" aria-label="${side==='from'?'시작':'도착'} 연결 면">${Object.entries(ports).map(([p,name])=>`<option value="${p}"${port===p?' selected':''}>${name}</option>`).join('')}</select></label><label>면 위 위치 (%)<input type="number" min="0" max="100" step="5" data-canvas-field="${side}-offset" value="${Math.round(offset*100)}" aria-label="${side==='from'?'시작':'도착'} 연결점 위치"></label></div>`;
      }
      content+=`${doc.nodes.length>1000?'<p class="ct-help">대상 목록은 현재 끝점과 앞쪽 998개 요소를 표시합니다.</p>':''}</section><section><h3>설명 위치</h3><div class="ct-grid"><label>설명 배경<input data-canvas-field="label-background" aria-label="연결선 설명 배경" type="color" value="${edge.labelBackground?.length===7?escape(edge.labelBackground):'#ffffff'}"></label><label>설명 방향<select data-canvas-field="label-angle" aria-label="연결선 설명 방향">${[-90,0,90].map(angle=>`<option value="${angle}"${(edge.labelAngle??0)===angle?' selected':''}>${angle}°</option>`).join('')}</select></label></div><label>시작점에서 ${Math.round((edge.labelPosition??.5)*100)}%<input data-canvas-field="label-position" aria-label="연결선 설명 위치" type="range" min="0" max="100" step="5" value="${Math.round((edge.labelPosition??.5)*100)}"></label></section><section><h3>고정 경유점 <span>${edge.waypoints?.length??0}</span></h3><p class="ct-help">작업지의 주황 손잡이로 위치를 조절합니다. 특정 지점을 지우면 나머지 지점은 유지됩니다.</p><ol class="ct-waypoints">${(edge.waypoints??[]).map((p,i)=>`<li><span>${i+1}. X ${Math.round(p.x)} · Y ${Math.round(p.y)}</span><button type="button" data-canvas-action="delete-waypoint" data-index="${i}" aria-label="경유점 ${i+1} 삭제">삭제</button></li>`).join('')}</ol>${button('reset-route','모든 경유점 지우기',!edge.waypoints?.length)}</section>${defaultsSection(true,Boolean(readStyleDefaults().edge))}`;
      if(edge.style==='elbow'){
        const available=availableRouteSegments(doc,edge),fixed=fixedRouteSegments(edge);
        content+=`<details class="ct-segments"><summary>구간 양끝 고정</summary><p class="ct-help">양끝을 경유점으로 유지하며 장애물이 생기면 사이를 안전하게 우회합니다.</p><label>고정할 구간<select data-segment-choice aria-label="고정할 선 구간"${available.length?'':' disabled'}>${available.map(segment=>`<option value="${segment.index}">${segment.a.y===segment.b.y?'가로':'세로'} · ${Math.round(segment.a.x)},${Math.round(segment.a.y)} → ${Math.round(segment.b.x)},${Math.round(segment.b.y)}</option>`).join('')}</select></label>${button('fix-segment','선택 구간 양끝 고정',!available.length)}${available.length?'':'<p class="ct-help">고정 가능한 직각 구간이 없습니다. 겹친 요소나 경유점을 먼저 정리하세요.</p>'}<ol class="ct-waypoints">${fixed.map((segment,i)=>`<li><span>구간 ${i+1}</span><button type="button" data-canvas-action="release-segment" data-index="${segment.index}" aria-label="구간 ${i+1} 양끝 해제">양끝 해제</button></li>`).join('')}</ol></details>`;
      }
    }
    container.innerHTML=content;
    const segments=container.querySelector<HTMLDetailsElement>('.ct-segments');if(segments&&wasSegmentsOpen!==undefined)segments.open=wasSegmentsOpen;
    const defaults=container.querySelector<HTMLDetailsElement>('.ct-defaults');if(defaults&&wasDefaultsOpen!==undefined)defaults.open=wasDefaultsOpen;
  }
  async function replaceImage() {
    refreshEditable();
    const doc=host.getDocument(),node=selectedNodes()[0];if(!node||locked(node)||node.kind!=='image'||busy)return;
    const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,image/gif';
    input.addEventListener('change',async()=>{
      const file=input.files?.[0];if(!file)return;busy=true;update();
      try{
        const result=await importImages([file],{x:node.x,y:node.y});
        if(host.getDocument()!==doc||!doc.nodes.includes(node)||!editableNodeIds(doc).has(node.id)){host.toast('문서가 바뀌어 이미지 교체를 취소했습니다.');return;}
        const replacement=result.nodes[0],assetId=replacement?.assetId;if(!assetId)return;
        const old=node.assetId,canRemove=old&&!doc.nodes.some(n=>n!==node&&n.assetId===old);
        const finalAssets={...doc.assets,...result.assets};if(canRemove)delete finalAssets[old];
        if(Object.keys(finalAssets).length>DOCUMENT_LIMITS.assets||Object.values(finalAssets).reduce((sum,a)=>sum+a.data.length,0)>DOCUMENT_LIMITS.totalAssetData)throw new Error('이미지 보관 한도를 넘습니다. 사용하지 않는 이미지를 정리하세요.');
        host.mutate(()=>{doc.assets=finalAssets;node.assetId=assetId;delete node.crop;},'이미지를 교체했습니다.');
      }catch(error){host.toast(String(error),true);}finally{busy=false;update();}
    },{once:true});input.click();
  }
  function click(event:Event){
    refreshEditable();
    const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-canvas-action]');if(!button||button.disabled)return;
    const action=button.dataset.canvasAction,doc=host.getDocument(),nodes=editable(),edge=doc.edges.find(e=>e.id===host.getSelectedEdge());
    const node=nodes.length===1?nodes[0]:undefined;
    const rich=(name:string)=>(container.querySelector(`[data-rich="${name}"]`) as HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement|null)?.value??'';
    if(node&&['save-text','clear-text-format','apply-text-format','clear-text-link','save-checklist','save-table'].includes(action??'')){
      try{
        if(action==='save-text'){const text=rich('text');host.mutate(()=>setNodePlainText(node,text),'내용을 적용했습니다.');}
        if(action==='clear-text-format')host.mutate(()=>setNodePlainText(node,node.text),'부분 서식을 지웠습니다.');
        if(action==='apply-text-format'){
          if(rich('text')!==node.text){host.toast('바꾼 내용을 먼저 적용한 뒤 서식을 지정하세요.',true);return;}
          const start=Number(rich('start')),end=Number(rich('end')),fontSize=Number(rich('fontSize')),color=rich('color'),href=rich('href').trim(),bold=rich('bold');
          if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>node.text.length||end<=start)throw new Error('서식을 적용할 글자 범위를 선택하세요.');
          if(!Number.isFinite(fontSize)||fontSize<6||fontSize>200)throw new Error('글자 크기는 6~200px입니다.');
          if(href&&!/^(https?:\/\/|mailto:)/i.test(href))throw new Error('링크는 http, https, mailto 주소만 사용할 수 있습니다.');
          host.mutate(()=>formatNodeTextRange(node,start,end,{color,fontSize,...(bold==='keep'?{}:{bold:bold==='true'}),...(href?{href}:{})}),'선택한 글자에 서식을 적용했습니다.');
        }
        if(action==='clear-text-link'){const start=Number(rich('start')),end=Number(rich('end'));if(end<=start)throw new Error('링크를 해제할 글자 범위를 선택하세요.');host.mutate(()=>formatNodeTextRange(node,start,end,{href:''}),'선택한 글자의 링크를 해제했습니다.');}
        if(action==='save-checklist'){
          const previous=node.details?.checklist??[],items=rich('checklist').split('\n').filter(line=>line.trim()).map((line,i)=>({id:previous[i]?.id??crypto.randomUUID(),text:line.replace(/^\s*\[[ xX]\]\s*/,''),done:/^\s*\[[xX]\]/.test(line)}));
          host.mutate(()=>setNodeChecklist(node,items),'체크리스트를 적용했습니다.');
        }
        if(action==='save-table'){
          const lines=rich('table').replace(/\r/g,'').split('\n'),columns=(lines.shift()??'').split('\t'),rows=lines.filter(line=>line.length).map(line=>line.split('\t'));
          host.mutate(()=>setNodeTable(node,{columns,rows}),'표를 적용했습니다.');
        }
      }catch(error){host.toast(String(error),true);return;}update();return;
    }
    if(action==='open-text-link'){const url=button.dataset.url;if(url&&safeTextHref(url)){const app=(window as unknown as {go?:{main?:{App?:{OpenSource:(source:string)=>Promise<void>}}}}).go?.main?.App;if(app?.OpenSource)void app.OpenSource(url).catch(error=>host.toast(String(error),true));else window.open(url,'_blank','noopener,noreferrer');}return;}
    if(action==='next-step'&&node){try{let id='';host.mutate(()=>{id=addNextStep(doc,node.id);},'다음 단계와 연결선을 추가했습니다.');host.select([id]);host.fit(doc.nodes.filter(n=>n.id===node.id||n.id===id));}catch(error){host.toast(String(error),true);}update();return;}
    if(action==='split-edge'&&edge){try{let id='';host.mutate(()=>{id=splitConnection(doc,edge.id);},'중간 단계를 넣었습니다. 기존 경유점은 자동 경로로 바뀝니다.');host.select([id]);host.fit(doc.nodes.filter(n=>n.id===edge.from||n.id===edge.to||n.id===id));}catch(error){host.toast(String(error),true);}update();return;}
    if(action==='save-default'){const selected=selectedNodes();const saved=edge?saveEdgeDefaults(edge):selected.length===1?saveNodeDefaults(selected[0]):false;host.toast(saved?'기본 서식을 저장했습니다.':'기본 서식을 저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.',!saved);update();return;}
    if(action==='apply-default'){const defaults=readStyleDefaults();if(edge&&defaults.edge)host.mutate(()=>applyEdgeDefaults(edge),'연결선 기본 서식을 적용했습니다.');else if(nodes.length&&defaults.node)host.mutate(()=>nodes.forEach(n=>applyNodeDefaults(n)),'요소 기본 서식을 적용했습니다.');else host.toast('먼저 기본 서식을 저장하세요.');update();return;}
    if(action==='reset-default'){const cleared=resetStyleDefaults();host.toast(cleared?'저장된 기본 서식을 초기화했습니다.':'기본 서식 저장 공간에 접근할 수 없습니다.',!cleared);update();return;}
    if(action==='fix-segment'&&edge){const index=Number(container.querySelector<HTMLSelectElement>('[data-segment-choice]')?.value);try{host.mutate(()=>fixRouteSegment(doc,edge,index),'구간 양끝을 경유점으로 고정했습니다.');}catch(error){host.toast(String(error),true);}update();return;}
    if(action==='release-segment'&&edge){const index=Number(button.dataset.index);try{host.mutate(()=>releaseRouteSegment(edge,index),'해당 구간의 양끝 경유점을 해제했습니다.');}catch(error){host.toast(String(error),true);}update();return;}
    if(action==='copy-format'){
      const n=selectedNodes()[0];if(!n)return;
      copiedFormat={fill:n.fill,stroke:n.stroke,color:n.color,fontSize:n.fontSize,bold:n.bold,align:n.align,strokeWidth:n.strokeWidth,dashed:n.dashed,opacity:n.opacity};host.toast('서식을 복사했습니다.');update();return;
    }
    if(action==='replace-image'){void replaceImage();return;}
    if(action==='paste-format'&&copiedFormat)host.mutate(()=>nodes.forEach(n=>Object.assign(n,copiedFormat)),'서식을 적용했습니다.');
    if(action==='fit-text')host.mutate(()=>{
      const ctx=document.createElement('canvas').getContext('2d');if(!ctx)return;
      fitTextHeight(nodes,ctx);
    },'글자에 맞게 높이를 조절했습니다.');
    if(action==='bullet')host.mutate(()=>nodes.filter(n=>n.kind!=='draw').forEach(n=>setNodePlainText(n,n.text.split('\n').map(line=>line.trim()&&!line.startsWith('• ')?`• ${line}`:line).join('\n'))));
    if(action==='reset-image')host.mutate(()=>nodes.filter(n=>n.kind==='image').forEach(n=>{delete n.crop;delete n.rotation;}));
    if(action==='delete-waypoint'&&edge)host.mutate(()=>{const index=Number(button.dataset.index);if(Number.isInteger(index)&&index>=0)edge.waypoints?.splice(index,1);});
    if(action==='reset-route'&&edge)host.mutate(()=>delete edge.waypoints);
    update();
  }
  function change(event:Event){
    refreshEditable();
    const input=event.target as HTMLInputElement|HTMLSelectElement,key=input.dataset.canvasField;if(!key)return;
    const doc=host.getDocument(),node=selectedNodes()[0],edge=doc.edges.find(e=>e.id===host.getSelectedEdge()),value=Number(input.value);
    if(edge){
      if(key==='from'||key==='to'){
        if(!doc.nodes.some(n=>n.id===input.value)||edge[key==='from'?'to':'from']===input.value){host.toast('서로 다른 두 요소를 연결하세요.');input.blur();update();return;}
        host.mutate(()=>{edge[key]=input.value;delete edge.waypoints;});
      }else if(key==='label-background'&&/^#[0-9a-fA-F]{6}$/.test(input.value))host.mutate(()=>edge.labelBackground=input.value);
      else if(key==='label-angle'&&[-90,0,90].includes(value))host.mutate(()=>edge.labelAngle=value as -90|0|90);
      else if(key==='label-position'&&Number.isFinite(value))host.mutate(()=>edge.labelPosition=Math.max(0,Math.min(1,value/100)));
      else for(const side of ['from','to'] as const){
        if(key===`${side}-port`&&input.value in ports)host.mutate(()=>{edge[`${side}Port`]=input.value as Port;delete edge[`${side}Anchor`];});
        if(key===`${side}-offset`&&Number.isFinite(value))host.mutate(()=>edge[`${side}Anchor`]=anchorForPort(edge[`${side}Port`],value/100));
      }
    }else if(node&&!locked(node)){
      if(key==='content-mode'){
        try{host.mutate(()=>{if(input.value==='text'){setNodePlainText(node,node.text);node.contentMode='text';}else if(input.value==='checklist')setNodeChecklist(node,node.details?.checklist??node.text.split('\n').filter(Boolean).map(text=>({id:crypto.randomUUID(),text,done:false})));else if(input.value==='table')setNodeTable(node,node.table??{columns:['항목','내용'],rows:node.text?[[node.text,'']]:[]});});}catch(error){host.toast(String(error),true);}
      }
      else if(key==='kind'&&input.value in shapeNames)host.mutate(()=>node.kind=input.value as ShapeKind);
      else if(key==='rotation'&&[0,90,180,270].includes(value))host.mutate(()=>node.rotation=value);
      else if(key.startsWith('crop-')&&Number.isFinite(value)){
        const part=key.slice(5) as keyof CropRegion;if(!['x','y','w','h'].includes(part))return;
        host.mutate(()=>node.crop=boundedCrop({...node.crop??{x:0,y:0,w:1,h:1},[part]:value/100}));
      }
    }
    input.blur();update();
  }
  function rangeSelection(event:Event){
    const text=event.target as HTMLTextAreaElement;if(text.dataset.rich!=='text')return;
    const start=container.querySelector<HTMLInputElement>('[data-rich="start"]'),end=container.querySelector<HTMLInputElement>('[data-rich="end"]');
    if(start&&end&&text.selectionStart!==text.selectionEnd){start.value=String(text.selectionStart);end.value=String(text.selectionEnd);}
  }
  container.addEventListener('click',click);container.addEventListener('change',change);container.addEventListener('mouseup',rangeSelection);container.addEventListener('keyup',rangeSelection);update();
  return {update,dispose(){disposed=true;container.removeEventListener('click',click);container.removeEventListener('change',change);container.removeEventListener('mouseup',rangeSelection);container.removeEventListener('keyup',rangeSelection);container.replaceChildren();}};
}
