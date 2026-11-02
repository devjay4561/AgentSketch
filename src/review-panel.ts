import './review.css';
import type {FlowDocument} from './types.ts';
import type {WorkbenchHost,WorkspaceComment} from './workspace-types.ts';
import {cloneDocument,uid,validateDocument} from './model.ts';
import {analyzeWorkflow} from './workflow.ts';
import {compareDocuments,applyComparedDocument,presentationStops} from './review-model.ts';
import type {PresentationStop} from './review-model.ts';
import {assistPayload,parseAssistantDraft,requestAssistant} from './assist-client.ts';
import type {AssistMode} from './assist-client.ts';

const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const label=(doc:FlowDocument,id?:string)=>id?(doc.nodes.find(n=>n.id===id)?.text.split('\n')[0]||'삭제된 요소'):'보드 전체';
const text=(value:unknown)=>value instanceof Error?value.message:String(value);

export function mountReviewPanel(host:WorkbenchHost,container:HTMLElement){
  container.classList.add('fp-review');
  container.innerHTML=`
    <section class="fp-review-section"><h3>검토 기록</h3>
      <label>작성자<input data-review="author" maxlength="100" placeholder="이름" autocomplete="off"></label>
      <label>검토 내용<textarea data-review="comment" maxlength="4000" rows="3" placeholder="예: 판매량 자료의 기준일을 확인해 주세요."></textarea></label>
      <label class="fp-review-check"><input type="checkbox" data-review="attach" checked><span data-review="target">선택한 요소에 기록</span></label>
      <button class="fp-review-primary" data-review-action="add-comment">검토 기록 추가</button>
      <div class="fp-review-row fp-review-filter"><strong data-review="count">검토 기록</strong><label class="fp-review-check"><input type="checkbox" data-review="resolved"><span>해결한 항목 표시</span></label></div>
      <div data-review="comments" class="fp-review-list" aria-live="polite"></div>
    </section>
    <section class="fp-review-section"><h3>문서 변경 비교</h3>
      <button data-review-action="compare-file">비교할 .agentsketch 선택</button><input type="file" data-review="file" accept=".agentsketch,.flowpaper,.json" hidden>
      <div data-review="comparison" class="fp-review-comparison" aria-live="polite"><p class="fp-review-empty">비교할 파일을 선택하세요.</p></div>
      <div class="fp-review-row"><button data-review-action="apply-comparison" disabled>비교 파일 내용 적용</button><button data-review-action="clear-comparison" disabled>비교 닫기</button></div>
    </section>
    <section class="fp-review-section"><h3>흐름 검사</h3>
      <button data-review-action="inspect">지금 검사</button><div data-review="issues" class="fp-review-list" aria-live="polite"></div>
    </section>
    <section class="fp-review-section"><h3>단계별로 설명하기</h3><label>발표 순서<select data-review="presentation-mode"><option value="nodes">선행 관계 순서</option><option value="selection">선택한 요소</option><option value="bookmarks">저장한 보기 순서</option></select></label>
      <button data-review-action="present">발표 시작</button><p class="fp-review-description">방향키로 이동하고 Esc로 마칩니다. 발표 중에는 편집이 잠깁니다.</p>
    </section>
    <details class="fp-review-section fp-assist"><summary>AI 검토·초안 생성 <span>선택 기능</span></summary>
      <p class="fp-review-description">직접 지정한 Chat Completions 호환 서비스에 요청합니다. API 키는 저장하지 않습니다. 이미지·출처 경로·담당자·메모는 전송 내용에서 제외합니다.</p>
      <label>API 주소<input data-review="endpoint" type="url" placeholder="https://…/v1/chat/completions" maxlength="1000" autocomplete="off"></label>
      <label>모델 이름<input data-review="model" placeholder="서비스의 모델 이름" maxlength="200" autocomplete="off"></label>
      <label>API 키 <span class="fp-review-optional">필요한 서비스만</span><input data-review="key" type="password" maxlength="4096" autocomplete="new-password" spellcheck="false"></label>
      <label>요청 종류<select data-review="assist-mode"><option value="review">누락·모호한 관계 검토</option><option value="draft">설명으로 새 도식 초안 만들기</option></select></label>
      <label>요청 내용<textarea data-review="question" rows="3" maxlength="10000" placeholder="이 흐름에서 빠진 선행 조건을 검토해 주세요."></textarea></label>
      <button data-review-action="preview-request">전송 내용 미리보기</button>
      <div data-review="request-area" hidden><label>전송할 전체 요청<textarea data-review="payload" rows="6" readonly spellcheck="false"></textarea></label>
      <label class="fp-review-check"><input type="checkbox" data-review="consent"><span>위 내용을 지정한 서비스로 전송합니다.</span></label>
      <div class="fp-review-row"><button class="fp-review-primary" data-review-action="send-request" disabled>요청 전송</button><button data-review-action="cancel-request" disabled>취소</button></div></div>
      <p data-review="assist-status" class="fp-review-description" role="status"></p>
      <label data-review="answer-area" hidden>응답<textarea data-review="answer" rows="7" readonly></textarea></label>
      <button data-review-action="preview-draft" hidden>생성한 초안 비교하기</button>
    </details>`;
  const get=<T extends HTMLElement=HTMLElement>(name:string)=>container.querySelector<T>(`[data-review="${name}"]`)!;
  const action=(name:string)=>container.querySelector<HTMLButtonElement>(`[data-review-action="${name}"]`)!;
  let disposed=false,commentSignature='',comparison:{incoming:FlowDocument;baseline:FlowDocument;name:string}|undefined;
  let presentation:{doc:FlowDocument;stops:PresentationStop[];index:number;viewport:FlowDocument['viewport'];selection:Set<string>;pageId?:string;dialog?:HTMLDialogElement}|undefined;
  let request:AbortController|undefined,requestDocument:FlowDocument|undefined,preparedMode:AssistMode='review',lastResponse='';
  const bar=document.createElement('div');bar.className='fp-presentation-bar';bar.hidden=true;bar.setAttribute('role','navigation');bar.setAttribute('aria-label','발표 제어');
  bar.innerHTML='<button data-present="previous" aria-label="이전 단계">이전</button><div><strong data-present="title"></strong><span data-present="position"></span></div><button data-present="next" aria-label="다음 단계">다음</button><button data-present="stop">발표 마치기</button>';
  document.body.append(bar);

  function locate(id:string){
    const doc=host.getDocument(),node=doc.nodes.find(n=>n.id===id);if(!node){host.toast('현재 보드에 없는 요소입니다.');return;}
    const pageId=node.details?.pageId;
    if(doc.workspace&&(doc.workspace.activePageId!==pageId)){doc.workspace.activePageId=pageId;}
    host.select([id]);host.fit([node]);
  }
  function renderComments(){
    const doc=host.getDocument(),selected=[...host.getSelection()],nodeId=selected.length===1?selected[0]:undefined;
    const attach=get<HTMLInputElement>('attach');attach.disabled=!nodeId;
    get('target').textContent=nodeId?`선택한 요소: ${label(doc,nodeId).slice(0,70)}`:'보드 전체에 기록';
    const all=doc.workspace?.comments??[],showResolved=get<HTMLInputElement>('resolved').checked;
    const signature=JSON.stringify([all,showResolved,doc.nodes.map(n=>[n.id,n.text.slice(0,120)])]);
    if(signature===commentSignature)return;commentSignature=signature;
    const unresolved=all.filter(c=>!c.resolved).length;get('count').textContent=`미해결 ${unresolved} · 전체 ${all.length}`;
    const comments=all.filter(c=>showResolved||!c.resolved).slice().reverse().slice(0,100);
    get('comments').innerHTML=comments.length?comments.map(c=>`<article class="fp-review-comment ${c.resolved?'is-resolved':''}"><div class="fp-review-comment-head"><strong>${escape(c.author)}</strong><time>${escape(new Date(c.createdAt).toLocaleDateString('ko-KR'))}</time></div><button class="fp-review-anchor" data-comment-node="${escape(c.nodeId??'')}" ${c.nodeId?'':'disabled'}>${escape(label(doc,c.nodeId).slice(0,80))}</button><p>${escape(c.text)}</p><div class="fp-review-row"><button data-comment-toggle="${escape(c.id)}">${c.resolved?'다시 열기':'해결 완료'}</button><button data-comment-delete="${escape(c.id)}" class="fp-review-quiet">삭제</button></div></article>`).join(''):'<p class="fp-review-empty">표시할 검토 기록이 없습니다.</p>';
    if(all.filter(c=>showResolved||!c.resolved).length>100)get('comments').insertAdjacentHTML('beforeend','<p class="fp-review-description">최근 100개 기록을 표시합니다.</p>');
  }
  function showComparison(incoming:FlowDocument,name:string){
    const baseline=cloneDocument(host.getDocument());comparison={incoming,baseline,name};
    const result=compareDocuments(baseline,incoming);
    get('comparison').innerHTML=`<p class="fp-review-comparison-title">${escape(name)}</p><p class="fp-review-description">추가 ${result.counts.added} · 삭제 ${result.counts.removed} · 수정 ${result.counts.changed}</p>`+(result.same?'<p class="fp-review-empty">문서 내용이 같습니다.</p>':`<ul>${result.changes.slice(0,100).map(c=>`<li><span class="fp-review-diff ${c.change}">${{added:'추가',removed:'삭제',changed:'수정'}[c.change]}</span><button data-diff-node="${c.kind==='node'?escape(c.id):''}" ${c.kind==='node'&&baseline.nodes.some(n=>n.id===c.id)?'':'disabled'}>${escape(c.label)}</button></li>`).join('')}</ul>`);
    if(result.changes.length>100)get('comparison').insertAdjacentHTML('beforeend',`<p class="fp-review-description">${result.changes.length}개 중 앞의 100개를 표시합니다. 적용 시 전체 변경을 반영합니다.</p>`);
    action('apply-comparison').disabled=result.same;action('clear-comparison').disabled=false;
  }
  function clearComparison(){comparison=undefined;get('comparison').innerHTML='<p class="fp-review-empty">비교할 파일을 선택하세요.</p>';action('apply-comparison').disabled=action('clear-comparison').disabled=true;}
  function presentAt(index:number){
    if(!presentation)return;const p=presentation;p.index=Math.max(0,Math.min(p.stops.length-1,index));const stop=p.stops[p.index];
    if(p.doc.workspace)p.doc.workspace.activePageId=stop.pageId;
    host.select([]);
    if(stop.viewport){p.doc.viewport={...stop.viewport};host.invalidate();}else{const ids=new Set(stop.nodeIds);host.fit(p.doc.nodes.filter(n=>ids.has(n.id)));}
    bar.querySelector('[data-present="title"]')!.textContent=stop.label;
    bar.querySelector('[data-present="position"]')!.textContent=`${p.index+1} / ${p.stops.length}`;
    (bar.querySelector('[data-present="previous"]') as HTMLButtonElement).disabled=p.index===0;
    (bar.querySelector('[data-present="next"]') as HTMLButtonElement).disabled=p.index===p.stops.length-1;
  }
  function stopPresentation(restore=true){
    const p=presentation;if(!p)return;presentation=undefined;document.body.classList.remove('fp-presenting');bar.hidden=true;
    if(restore&&host.getDocument()===p.doc){p.doc.viewport={...p.viewport};if(p.doc.workspace)p.doc.workspace.activePageId=p.pageId;host.select(p.selection);host.invalidate();}
    if(restore&&!disposed&&p.dialog?.isConnected&&!p.dialog.open)p.dialog.showModal();
  }
  function startPresentation(){
    const doc=host.getDocument(),mode=get<HTMLSelectElement>('presentation-mode').value as 'nodes'|'bookmarks'|'selection',stops=presentationStops(doc,host.getSelection(),mode);
    if(!stops.length){host.toast(mode==='bookmarks'?'먼저 보기를 저장하세요.':'발표할 요소를 선택하거나 추가하세요.');return;}
    const dialog=container.closest<HTMLDialogElement>('dialog');
    presentation={doc,stops,index:0,viewport:{...doc.viewport},selection:new Set(host.getSelection()),pageId:doc.workspace?.activePageId,...(dialog?.open?{dialog}:{})};
    if(dialog?.open)dialog.close();
    document.body.classList.add('fp-presenting');bar.hidden=false;presentAt(0);bar.querySelector<HTMLButtonElement>('[data-present="stop"]')!.focus();
    const active=presentation;requestAnimationFrame(()=>{if(presentation===active)presentAt(0);});
  }
  const presentationKeys=(event:KeyboardEvent)=>{
    if(!presentation)return;event.preventDefault();event.stopImmediatePropagation();
    if(event.key==='Escape')stopPresentation();else if(['ArrowRight','ArrowDown','PageDown',' '].includes(event.key))presentAt(presentation.index+1);else if(['ArrowLeft','ArrowUp','PageUp'].includes(event.key))presentAt(presentation.index-1);else if(event.key==='Home')presentAt(0);else if(event.key==='End')presentAt(presentation.stops.length-1);
  };
  document.addEventListener('keydown',presentationKeys,true);
  bar.addEventListener('click',event=>{const name=(event.target as HTMLElement).closest<HTMLElement>('[data-present]')?.dataset.present;if(name==='stop')stopPresentation();else if(presentation&&name==='previous')presentAt(presentation.index-1);else if(presentation&&name==='next')presentAt(presentation.index+1);});

  function invalidateRequest(){
    if(request)return;get('request-area').hidden=true;get<HTMLInputElement>('consent').checked=false;action('send-request').disabled=true;get<HTMLTextAreaElement>('payload').value='';
  }
  async function execute(name:string){
    if(name==='add-comment'){
      const author=get<HTMLInputElement>('author').value.trim(),comment=get<HTMLTextAreaElement>('comment').value.trim();if(!author||!comment){host.toast('작성자와 검토 내용을 입력하세요.',true);return;}
      if((host.getDocument().workspace?.comments?.length??0)>=500){host.toast('검토 기록은 500개까지 보관합니다. 필요 없는 기록을 삭제하세요.',true);return;}
      const selection=[...host.getSelection()],nodeId=get<HTMLInputElement>('attach').checked&&selection.length===1?selection[0]:undefined;
      const entry:WorkspaceComment={id:uid(),author,text:comment,createdAt:new Date().toISOString(),...(nodeId?{nodeId}:{})};
      host.mutate(()=>{const doc=host.getDocument();doc.workspace??={};doc.workspace.comments??=[];doc.workspace.comments.push(entry);},'검토 기록을 추가했습니다.');get<HTMLTextAreaElement>('comment').value='';renderComments();
    }else if(name==='compare-file')get<HTMLInputElement>('file').click();
    else if(name==='clear-comparison')clearComparison();
    else if(name==='apply-comparison'&&comparison){
      const current=host.getDocument();if(!compareDocuments(comparison.baseline,current).same){host.toast('비교한 뒤 문서가 바뀌었습니다. 파일을 다시 비교하세요.',true);action(name).disabled=true;return;}
      const candidate=comparison;host.mutate(()=>{applyComparedDocument(current,candidate.incoming,candidate.baseline);},'비교 파일의 내용을 적용했습니다. Ctrl+Z로 되돌릴 수 있습니다.');host.select([]);clearComparison();
    }else if(name==='inspect'){
      const doc=host.getDocument(),analysis=analyzeWorkflow(doc);const nameById=new Map(doc.nodes.map(n=>[n.id,n.text.split('\n')[0]||'이름 없는 요소']));
      get('issues').innerHTML=`<p class="fp-review-description">준비됨 ${analysis.summary.ready} · 미충족 ${analysis.summary.blocked} · 재확인 ${analysis.summary.stale} · 순환 ${analysis.summary.cycle}</p>`+(analysis.issues.length?analysis.issues.slice(0,100).map(issue=>`<button class="fp-review-issue" data-issue-node="${escape(issue.nodeId)}"><strong>${escape(nameById.get(issue.nodeId)??'요소')}</strong><span>${escape(issue.message)}</span></button>`).join(''):'<p class="fp-review-empty">기록된 조건에서 발견된 문제가 없습니다. 실제 자료 내용의 검증을 대신하지 않습니다.</p>');
    }else if(name==='present')startPresentation();
    else if(name==='preview-request'){
      const model=get<HTMLInputElement>('model').value.trim(),question=get<HTMLTextAreaElement>('question').value.trim();if(!model||!question){host.toast('모델 이름과 요청 내용을 입력하세요.',true);return;}
      preparedMode=get<HTMLSelectElement>('assist-mode').value as AssistMode;const payload=assistPayload(host.getDocument(),host.getSelection(),question,model,preparedMode);
      get<HTMLTextAreaElement>('payload').value=JSON.stringify(payload,null,2);get('request-area').hidden=false;get<HTMLInputElement>('consent').checked=false;action('send-request').disabled=true;get('assist-status').textContent='최대 200개 요소·500개 연결의 글자와 관계를 표시합니다. 전송 전 내용을 확인하세요.';
    }else if(name==='send-request'){
      if(request||!get<HTMLInputElement>('consent').checked)return;
      request=new AbortController();requestDocument=host.getDocument();const controller=request,mode=preparedMode;
      action('send-request').disabled=true;action('cancel-request').disabled=false;action('preview-request').disabled=true;action('preview-draft').hidden=true;get('assist-status').textContent='요청 중… 최대 75초가 걸릴 수 있습니다.';
      const timer=setTimeout(()=>controller.abort(),75_000);
      try{
        const answer=await requestAssistant(get<HTMLInputElement>('endpoint').value,get<HTMLInputElement>('key').value,get<HTMLTextAreaElement>('payload').value,controller.signal);
        if(disposed||controller.signal.aborted)return;lastResponse=answer;get<HTMLTextAreaElement>('answer').value=answer;get('answer-area').hidden=false;action('preview-draft').hidden=mode!=='draft';get('assist-status').textContent='응답을 받았습니다. 제안은 검증된 사실이나 자동 승인으로 취급하지 않습니다.';
      }catch(error){if(!disposed)get('assist-status').textContent=controller.signal.aborted?'요청을 취소했습니다.':`${text(error)} 브라우저에서는 서비스의 CORS 설정도 확인하세요.`;}
      finally{clearTimeout(timer);request=undefined;if(!disposed){action('cancel-request').disabled=true;action('preview-request').disabled=false;get<HTMLInputElement>('consent').checked=false;action('send-request').disabled=true;}}
    }else if(name==='cancel-request')request?.abort();
    else if(name==='preview-draft'){
      if(host.getDocument()!==requestDocument){host.toast('다른 문서로 전환되었습니다. 현재 문서에서 다시 요청하세요.',true);return;}
      showComparison(parseAssistantDraft(lastResponse),'AI 제안 초안');get('comparison').scrollIntoView({block:'nearest'});host.toast('초안과 현재 보드의 차이를 확인한 뒤 적용하세요.');
    }
  }
  const click=(event:Event)=>{
    const target=event.target as HTMLElement,button=target.closest<HTMLElement>('[data-review-action]');if(button){void execute(button.dataset.reviewAction!).catch(error=>host.toast(text(error),true));return;}
    const node=target.closest<HTMLElement>('[data-comment-node],[data-diff-node],[data-issue-node]');if(node){const id=node.dataset.commentNode||node.dataset.diffNode||node.dataset.issueNode;if(id)locate(id);return;}
    const toggle=target.closest<HTMLElement>('[data-comment-toggle]'),remove=target.closest<HTMLElement>('[data-comment-delete]');if(toggle||remove){const id=toggle?.dataset.commentToggle??remove!.dataset.commentDelete;host.mutate(()=>{const doc=host.getDocument(),all=doc.workspace?.comments;if(!all)return;if(remove)doc.workspace!.comments=all.filter(c=>c.id!==id);else{const comment=all.find(c=>c.id===id);if(comment)comment.resolved=!comment.resolved;}});renderComments();}
  };
  container.addEventListener('click',click);
  const change=(event:Event)=>{
    const target=event.target as HTMLInputElement;
    if(target===get('resolved')){commentSignature='';renderComments();}
    else if(target===get('consent'))action('send-request').disabled=!target.checked||!!request;
    else if(['endpoint','model','question','assist-mode'].some(name=>target===get(name)))invalidateRequest();
  };
  container.addEventListener('change',change);
  const fileChange=async()=>{
    const input=get<HTMLInputElement>('file'),file=input.files?.[0];input.value='';if(!file)return;
    const current=host.getDocument();try{if(file.size>80*1024*1024)throw new Error('80MB보다 큰 문서는 비교할 수 없습니다.');const incoming=validateDocument(JSON.parse(await file.text()));if(disposed||host.getDocument()!==current)return;showComparison(incoming,file.name);}catch(error){host.toast(`문서 비교 실패: ${text(error)}`,true);}
  };
  get('file').addEventListener('change',fileChange);
  let currentDocument=host.getDocument();
  function update(){
    if(disposed)return;const doc=host.getDocument();
    if(doc!==currentDocument){currentDocument=doc;clearComparison();stopPresentation(false);request?.abort();invalidateRequest();}
    renderComments();
  }
  update();
  return {update,dispose(){disposed=true;request?.abort();stopPresentation();document.removeEventListener('keydown',presentationKeys,true);container.removeEventListener('click',click);container.removeEventListener('change',change);get('file').removeEventListener('change',fileChange);get<HTMLInputElement>('key').value='';bar.remove();comparison=undefined;lastResponse='';}};
}
