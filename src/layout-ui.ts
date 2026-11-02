import './layout.css';
import type {FlowDocument,FlowNode} from './types.ts';
import type {NodeDetails,WorkbenchHost,WorkspaceData} from './workspace-types.ts';
import {applyLayout,computeLayout,layoutFingerprint} from './layout-engine.ts';
import type {LayoutMode,LayoutOptions,LayoutPlan} from './layout-engine.ts';
import {bounds} from './geometry.ts';

export function mountLayoutPanel(host:WorkbenchHost,container:HTMLElement){
  const section=document.createElement('section');section.className='layout-workbench';
  section.innerHTML=`<label class="layout-field">배치 방식<select data-layout="mode"><option value="horizontal">왼쪽에서 오른쪽</option><option value="vertical">위에서 아래</option><option value="tree">트리 · 가지 구조</option><option value="radial">방사형</option><option value="swimlane">담당자별 스윔레인</option></select></label>
    <div class="layout-fields"><label class="layout-field">적용 범위<select data-layout="scope"><option value="page">현재 페이지</option><option value="selection">선택한 요소</option></select></label><label class="layout-field">요소 간격<input data-layout="gap" type="number" min="20" max="300" step="8" value="64"><span class="layout-unit">px · 단계 간격은 2배</span></label></div>
    <div class="layout-fields"><label class="layout-field">위치 제약<select data-layout="alignment"><option value="none">배치 방식에 맞추기</option><option value="row">같은 행에 배치</option><option value="column">같은 열에 배치</option></select></label><label class="layout-field">배치 대안<select data-layout="variant"><option value="balanced">연결 순서로 펼치기</option><option value="reverse">반대 순서로 펼치기</option></select></label></div>
    <label class="layout-check"><input data-layout="preserve" type="checkbox">겹치지 않은 요소의 현재 위치 유지</label>
    <label class="layout-check"><input data-layout="routes" type="checkbox">수동으로 조절한 연결 경로 유지</label>
    <p class="layout-note">잠긴 요소와 다른 페이지는 고정합니다. 그룹 내부의 상대 위치를 유지하며, 선택한 그룹은 묶음 전체에 적용합니다.</p>
    <button class="layout-preview-button" data-layout="preview">배치 미리보기</button><button data-layout="stop" hidden>계산 취소</button>
    <div class="layout-result" hidden><canvas class="layout-preview" width="720" height="420" aria-label="자동 배치 미리보기"></canvas><p class="layout-summary" aria-live="polite"></p><ul class="layout-warnings"></ul><div class="layout-actions"><button data-layout="apply">이 배치 적용</button><button data-layout="cancel">취소</button></div></div>
    <p class="layout-status" role="status" aria-live="polite"></p>`;
  container.append(section);
  const $=<T extends HTMLElement=HTMLElement>(name:string)=>section.querySelector<T>(`[data-layout="${name}"]`)!;
  const result=section.querySelector<HTMLElement>('.layout-result')!,status=section.querySelector<HTMLElement>('.layout-status')!;
  let plan:LayoutPlan|undefined, signature='',worker:Worker|undefined, generation=0,disposed=false;
  const clear=()=>{generation++;worker?.terminate();worker=undefined;plan=undefined;result.hidden=true;$<HTMLButtonElement>('preview').disabled=false;$('preview').textContent='배치 미리보기';$('stop').hidden=true;};
  const scope=()=>{const doc=host.getDocument(),ws=(doc as FlowDocument&{workspace?:WorkspaceData}).workspace;
    const hidden=new Set(ws?.layers?.filter(l=>l.hidden).map(l=>l.id)),firstPage=ws?.pages?.[0]?.id;
    const ids=doc.nodes.filter(n=>{const d=(n as FlowNode&{details?:NodeDetails}).details;return !hidden.has(d?.layerId??'')&&(!ws?.activePageId||(d?.pageId??firstPage)===ws.activePageId);}).map(n=>n.id);
    if($<HTMLSelectElement>('scope').value==='selection'){const selected=host.getSelection();return ids.filter(id=>selected.has(id));}
    return ids;
  };
  const draw=(doc:FlowDocument,next:LayoutPlan)=>{
    const canvas=section.querySelector<HTMLCanvasElement>('canvas')!,ctx=canvas.getContext('2d')!;
    const positions=new Map(next.positions.map(p=>[p.id,p])),included=new Set(scope());
    const nodes=doc.nodes.filter(n=>included.has(n.id)||positions.has(n.id)).map(n=>({...n,...positions.get(n.id)}));
    const box=bounds(nodes),scale=Math.min(1.5,(canvas.width-48)/Math.max(box.w,1),(canvas.height-48)/Math.max(box.h,1));
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#f6f7f9';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();ctx.translate((canvas.width-box.w*scale)/2-box.x*scale,(canvas.height-box.h*scale)/2-box.y*scale);ctx.scale(scale,scale);
    const index=new Map(nodes.map(n=>[n.id,n]));ctx.strokeStyle='#a2aab5';ctx.lineWidth=1.5/scale;
    for(const e of doc.edges){const a=index.get(e.from),b=index.get(e.to);if(!a||!b)continue;ctx.beginPath();ctx.moveTo(a.x+a.w/2,a.y+a.h/2);ctx.lineTo(b.x+b.w/2,b.y+b.h/2);ctx.stroke();}
    for(const n of nodes){ctx.fillStyle=n.fill==='transparent'?'#ffffff':n.fill;ctx.strokeStyle=n.locked?'#919aa5':'#c2410c';ctx.lineWidth=1/scale;ctx.fillRect(n.x,n.y,n.w,n.h);ctx.strokeRect(n.x,n.y,n.w,n.h);
      if(scale>.12){ctx.save();ctx.beginPath();ctx.rect(n.x,n.y,n.w,n.h);ctx.clip();ctx.fillStyle='#1c2024';ctx.font=`${Math.max(12,10/scale)}px "Pretendard Variable",sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(n.text.split('\n')[0].slice(0,30)||'이미지',n.x+n.w/2,n.y+n.h/2,Math.max(1,n.w-8));ctx.restore();}}
    ctx.restore();
  };
  const show=(next:LayoutPlan,doc:FlowDocument)=>{plan=next;result.hidden=false;draw(doc,next);
    section.querySelector<HTMLElement>('.layout-summary')!.textContent=`${next.moved}개 요소 이동 · ${next.positions.length}개 요소 검토`;
    const list=section.querySelector<HTMLUListElement>('.layout-warnings')!;list.replaceChildren();
    for(const text of [...next.warnings,...(next.lanes.length?[`담당자 구역: ${next.lanes.map(l=>l.name).join(', ')}`]:[])]){const item=document.createElement('li');item.textContent=text;list.append(item);}
    $<HTMLButtonElement>('apply').disabled=!next.moved;status.textContent='미리보기의 선은 관계만 표시합니다. 적용 후 실제 직각 경로를 계산합니다.';
  };
  $('preview').addEventListener('click',async()=>{
    clear();status.textContent='';const doc=host.getDocument(),selection=scope();if(!selection.length){status.textContent='배치할 요소를 먼저 선택하거나 현재 페이지에 추가하세요.';return;}
    signature=layoutFingerprint(doc);const options:LayoutOptions={mode:$<HTMLSelectElement>('mode').value as LayoutMode,gap:Number($<HTMLInputElement>('gap').value)||64,selection,preservePositions:$<HTMLInputElement>('preserve').checked,keepManualRoutes:$<HTMLInputElement>('routes').checked,alignment:$<HTMLSelectElement>('alignment').value as LayoutOptions['alignment'],reverseOrder:$<HTMLSelectElement>('variant').value==='reverse'};
    const token=generation;$<HTMLButtonElement>('preview').disabled=true;$('preview').textContent='배치 계산 중…';$('stop').hidden=false;status.textContent='계산 중에도 작업지 편집을 계속할 수 있습니다.';
    try{
      const next=doc.nodes.length>300?await new Promise<LayoutPlan>((resolve,reject)=>{
        worker=new Worker(new URL('./layout.worker.ts',import.meta.url),{type:'module'});
        worker.onmessage=e=>{worker?.terminate();worker=undefined;if(e.data.error)reject(new Error(e.data.error));else resolve(e.data.plan);};worker.onerror=()=>reject(new Error('배치 계산을 실행하지 못했습니다. 범위를 줄여 다시 시도하세요.'));
        // Avoid serializing large image assets into the worker. Geometry is sufficient.
        worker.postMessage({doc:{...doc,assets:{},nodes:doc.nodes.map(n=>({...n,points:undefined}))},options});
      }):computeLayout(doc,options);
      if(disposed||token!==generation)return;
      if(signature!==layoutFingerprint(host.getDocument())){clear();status.textContent='계산 중 문서가 바뀌었습니다. 다시 미리보기를 실행하세요.';return;}
      show(next,doc);
    }catch(error){status.textContent=String(error);}finally{if(token===generation){$<HTMLButtonElement>('preview').disabled=false;$('preview').textContent='배치 미리보기';$('stop').hidden=true;worker?.terminate();worker=undefined;}}
  });
  $('apply').addEventListener('click',()=>{if(!plan)return;if(signature!==layoutFingerprint(host.getDocument())){clear();status.textContent='미리보기 이후 문서가 바뀌었습니다. 다시 미리보기를 실행하세요.';return;}
    const current=plan;clear();host.mutate(()=>applyLayout(host.getDocument(),current),'배치를 적용했습니다. Ctrl+Z로 되돌릴 수 있습니다.');host.fit(host.getDocument().nodes.filter(n=>current.positions.some(p=>p.id===n.id)));status.textContent='배치를 적용했습니다.';
  });
  $('cancel').addEventListener('click',()=>{clear();status.textContent='미리보기를 취소했습니다. 문서는 변경하지 않았습니다.';});
  $('stop').addEventListener('click',()=>{clear();status.textContent='계산을 취소했습니다. 문서는 변경하지 않았습니다.';});
  section.addEventListener('change',()=>{clear();status.textContent='설정이 바뀌었습니다. 배치를 다시 미리보기 하세요.';});
  return {update(){if(plan&&signature!==layoutFingerprint(host.getDocument())){clear();status.textContent='문서가 바뀌었습니다. 배치를 다시 미리보기 하세요.';}},dispose(){disposed=true;clear();section.remove();}};
}
