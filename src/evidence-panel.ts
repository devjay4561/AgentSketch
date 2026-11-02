import './evidence.css';
import type { FlowDocument, FlowEdge, FlowNode } from './types.ts';
import type { NodeDetails, WorkbenchHost } from './workspace-types.ts';
import { analyzeWorkflow, traceNodes, evaluateEdgeCondition } from './workflow.ts';
import { editableNodeIds, ensureWorkspace } from './organization.ts';

type SourceResult = {source:string;kind:'file'|'directory'|'url';exists:boolean;size:number;modifiedAt:string;fingerprint:string;hashComplete:boolean;note:string};
type SourceAPI = {CheckSource(source:string):Promise<SourceResult>;OpenSource(source:string):Promise<void>};
const bridge = () => (window as Window & {go?:{main?:{App?:SourceAPI}}}).go?.main?.App;
const escape = (s:unknown) => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const readinessNames:Record<string,string> = {ready:'준비됨',blocked:'조건 미충족',stale:'재확인 필요',cycle:'순환 관계',untracked:'추적 설정 없음'};
const statusNames:Record<string,string> = {missing:'미확보',collected:'확보',reviewing:'검토 중',verified:'확인 완료',stale:'재확인 필요'};
const relationNames:Record<string,string> = {required:'필수 선행 조건',alternative:'대체 조건',optional:'선택 자료',reference:'참고 관계',output:'결과물'};
const nameOf = (node:FlowNode) => node.text.trim().split('\n')[0] || (node.kind==='image'?'이미지 자료':'이름 없는 요소');
const options = (items:Record<string,string>) => Object.entries(items).map(([value,label])=>`<option value="${value}">${label}</option>`).join('');

/** Evidence lives in the document. Native source checks never imply content approval. */
export function mountEvidencePanel(host:WorkbenchHost, container:HTMLElement) {
  container.classList.add('evidence-panel');
  container.innerHTML = `
    <div class="evidence-view-switch" aria-label="자료 보기 방식"><button type="button" data-evidence-view="edit" aria-pressed="true">정보 편집</button><button type="button" data-evidence-view="report" aria-pressed="false">보고용 보기</button></div>
    <label class="evidence-report-option" data-evidence-report-option hidden><input type="checkbox" data-evidence-include-notes><span>내부 메모 포함</span></label>
    <div class="evidence-summary" data-testid="evidence-summary" aria-live="polite"></div>
    <div class="evidence-toolbar"><label class="evidence-search"><span>검색</span><input type="search" data-evidence-search placeholder="자료명, 담당자, 출처 검색" aria-label="자료 및 절차 검색"></label><label><span>보기</span><select data-evidence-filter aria-label="자료 상태 필터"><option value="all">모든 요소</option><option value="resource">자료</option><option value="step">절차</option><option value="blocked">조건 미충족</option><option value="stale">재확인 필요</option><option value="unassigned">담당자 미지정</option></select></label></div>
    <div class="evidence-list" data-evidence-list role="list" aria-label="자료와 절차 목록"></div>
    <p class="evidence-list-note" data-evidence-list-note></p>
    <div data-evidence-report hidden></div>
    <div data-evidence-trace hidden></div>
    <details class="evidence-review evidence-watch"><summary>원본 변경 감시</summary><label class="evidence-watch-toggle"><input type="checkbox" data-evidence-watch><span>선택한 자료의 원본 변경 감시</span></label><p class="evidence-note">직접 켠 경우에만 이 앱이 열려 있는 동안 동작합니다. 로컬 파일·폴더 최대 20개를 60초마다 5개씩 확인합니다. 웹 주소는 감시하지 않습니다. 자료 내용의 확인 완료는 자동 처리하지 않습니다.</p><p class="evidence-note" data-evidence-watch-status aria-live="polite">변경 감시 꺼짐</p></details>
    <div class="evidence-selection" data-evidence-selection></div>
    <details class="evidence-review"><summary>담당자별 확인할 항목</summary><div data-evidence-todos></div></details>
    <details class="evidence-review"><summary>보드 점검 결과</summary><div data-evidence-issues></div></details>`;
  const el = <T extends HTMLElement = HTMLElement>(selector:string) => container.querySelector<T>(selector)!;
  let selectedKey = '', sourceBusy = false, sourceFeedback = '', analysisKey = '', reportView = false;
  let trace: {origin:string;direction:'upstream'|'downstream';ids:Set<string>} | undefined;
  let watch: {doc:FlowDocument;items:{id:string;source:string}[];cursor:number;checked:number} | undefined;
  let watchTimer:ReturnType<typeof setTimeout>|undefined,watchStatus='변경 감시 꺼짐',disposed=false;
  let analysis:ReturnType<typeof analyzeWorkflow> | undefined;
  const selectedNode = () => {
    const ids=host.getSelection(); return ids.size===1?host.getDocument().nodes.find(n=>ids.has(n.id)):undefined;
  };
  const selectedEdge = () => host.getDocument().edges.find(e=>e.id===host.getSelectedEdge());
  const trackedDetails = (node:FlowNode):NodeDetails => node.details ?? {};
  const locked = (node:FlowNode) => !editableNodeIds(host.getDocument()).has(node.id);
  function changeDetails(update:(details:NodeDetails,node:FlowNode)=>void,message?:string) {
    const n=selectedNode();if(!n)return;
    if(locked(n)){host.toast('잠긴 요소입니다. 잠금을 풀고 자료 정보를 수정하세요.',true);return;}
    host.mutate(()=>{n.details??={role:'step'};n.details.role??='step';update(n.details,n);},message);refresh();
  }
  function reveal(node:FlowNode) {
    const doc=host.getDocument(),page=node.details?.pageId??'page-main',workspace=doc.workspace;
    const layer=workspace?.layers?.find(l=>l.id===(node.details?.layerId??'layer-main'));
    const ancestors=new Set<string>();let id=node.groupId;
    while(id&&!ancestors.has(id)){ancestors.add(id);id=workspace?.groups?.find(g=>g.id===id)?.parentId;}
    if(page!==(workspace?.activePageId??'page-main')||layer?.hidden||workspace?.groups?.some(g=>ancestors.has(g.id)&&g.collapsed))host.mutate(()=>{
      const w=ensureWorkspace(doc);if(w.pages?.some(p=>p.id===page))w.activePageId=page;
      if(layer)layer.hidden=false;for(const g of w.groups??[])if(ancestors.has(g.id))g.collapsed=false;
    });
  }
  function locate(id:string) {const node=host.getDocument().nodes.find(n=>n.id===id);if(!node)return;reveal(node);host.select([id]);host.fit([node]);refresh();}
  function sourceDescription(node:FlowNode) {
    if(node.details?.source?.trim())return node.details.source;
    const attached=host.getDocument().workspace?.attachments?.filter(a=>node.details?.attachmentIds?.includes(a.id));
    return attached?.length?`첨부 자료 · ${attached.map(a=>a.name).join(', ')}`:'미등록';
  }
  function relationView(edge:FlowEdge) {
    const doc=host.getDocument(),from=doc.nodes.find(n=>n.id===edge.from),to=doc.nodes.find(n=>n.id===edge.to);
    return `<h3>관계의 의미</h3><p class="evidence-connection">${escape(from?nameOf(from):'시작 요소')}<span>→</span>${escape(to?nameOf(to):'도착 요소')}</p>
      <label><span>선행 관계</span><select data-evidence-relation aria-label="선행 관계 유형">${options(relationNames)}</select></label>
      <p class="evidence-note">필수 조건과 대체 조건을 준비 상태에 반영합니다. 선택·참고 관계는 준비를 막지 않습니다. 결과물 관계는 앞 절차의 준비 상태를 따릅니다.</p>
      <section class="evidence-conditional"><h4>조건부 적용</h4><div data-evidence-condition></div><p class="evidence-note" data-evidence-condition-state aria-live="polite"></p></section>`;
  }
  function syncCondition(edge:FlowEdge,force=false) {
    const area=el('[data-evidence-condition]'),condition=edge.condition,doc=host.getDocument();
    if(force||!area.contains(document.activeElement)){
      const reference=doc.nodes.find(n=>n.id===condition?.nodeId),fields=Object.keys(reference?.details?.customFields??{});
      if(condition&&condition.field!=='status'&&!fields.includes(condition.field))fields.push(condition.field);
      area.innerHTML=`<label class="evidence-watch-toggle"><input type="checkbox" data-condition="enabled" ${condition?'checked':''}><span>값이 조건을 만족할 때만 이 관계 적용</span></label>${condition?`<div class="evidence-fields"><label class="evidence-wide"><span>참조 요소 검색</span><input type="search" data-condition-search placeholder="요소 이름으로 검색" aria-label="조건 참조 요소 검색"></label><label class="evidence-wide"><span>참조 요소</span><select data-condition="nodeId" aria-label="조건 참조 요소"></select></label><label><span>비교할 필드</span><select data-condition="field" aria-label="조건 비교 필드"><option value="status">수동 확인 상태</option>${fields.map(field=>`<option value="${escape(field)}">${escape(field)}${reference?.details?.customFields&&Object.hasOwn(reference.details.customFields,field)?'':' · 누락'}</option>`).join('')}</select></label><label><span>비교 방식</span><select data-condition="operator" aria-label="조건 비교 방식"><option value="equals">일치하면</option><option value="notEquals">일치하지 않으면</option></select></label><label class="evidence-wide"><span>비교 값</span>${condition.field==='status'?`<select data-condition="value" aria-label="조건 비교 값">${options(statusNames)}${Object.hasOwn(statusNames,condition.value)?'':`<option value="${escape(condition.value)}">${escape(condition.value||'빈 값')}</option>`}</select>`:'<input data-condition="value" aria-label="조건 비교 값" maxlength="2000" placeholder="필드 값과 정확하게 비교합니다">'}</label></div><button type="button" data-evidence-action="remove-condition">적용 조건 제거</button>`:''}`;
      if(condition){syncConditionNodes(edge);for(const field of ['field','operator','value'] as const)el<HTMLInputElement|HTMLSelectElement>(`[data-condition="${field}"]`).value=condition[field];}
    }
    const state=condition?evaluateEdgeCondition(edge,doc.nodes.find(n=>n.id===condition.nodeId)):'active';
    el('[data-evidence-condition-state]').textContent=!condition?'조건 없이 이 관계를 적용합니다.':state==='active'?'조건이 충족되어 이 선행 관계를 적용합니다.':state==='inactive'?'조건이 충족되지 않아 이 선행 관계를 준비 계산에서 제외합니다.':'참조 요소 또는 필드 값이 없습니다. 필수·대체 조건은 확인 전까지 진행 준비를 막습니다. 빈 문자열과 미등록 값은 다릅니다.';
  }
  function syncConditionNodes(edge:FlowEdge) {
    if(!edge.condition)return;const input=el<HTMLSelectElement>('[data-condition="nodeId"]'),term=el<HTMLInputElement>('[data-condition-search]').value.toLocaleLowerCase();
    const doc=host.getDocument(),matches=doc.nodes.filter(n=>nameOf(n).toLocaleLowerCase().includes(term)).slice(0,200),selected=doc.nodes.find(n=>n.id===edge.condition!.nodeId);
    if(selected&&!matches.some(n=>n.id===selected.id))matches.unshift(selected);
    input.innerHTML=matches.map(n=>`<option value="${escape(n.id)}">${escape(nameOf(n))}</option>`).join('')+(!selected?`<option value="${escape(edge.condition.nodeId)}">참조 요소 없음</option>`:'');input.value=edge.condition.nodeId;
  }
  function editorView(node:FlowNode) {
    return `<div class="evidence-editor-title"><h3>${escape(nameOf(node))}</h3><span data-evidence-readiness class="evidence-status"></span></div>
      <p data-evidence-reasons class="evidence-note" aria-live="polite"></p>
      <div class="evidence-actions"><button type="button" data-evidence-action="upstream">선행 관계 선택</button><button type="button" data-evidence-action="downstream">영향받는 단계 선택</button></div>
      <fieldset ${locked(node)?'disabled':''}><legend>업무 정보</legend>
      <div class="evidence-fields"><label><span>요소 역할</span><select data-field="role" aria-label="요소 역할"><option value="">추적 설정 없음</option><option value="step">절차</option><option value="resource">자료</option></select></label>
      <label><span>담당자</span><input data-field="owner" aria-label="자료 담당자" maxlength="200" placeholder="예: 운영팀 김담당"></label>
      <label><span>수동 확인 상태</span><select data-field="status" aria-label="자료 확인 상태"><option value="">미지정</option>${options(statusNames)}</select></label>
      <label><span>선행 조건 충족 방식</span><select data-field="requirement" aria-label="선행 조건 충족 방식"><option value="all">모든 필수 조건</option><option value="any">조건 중 하나 이상</option></select></label></div>
      <p class="evidence-note">진행 준비는 연결된 조건에서 계산합니다. 수동 확인 상태와 실제 업무 완료 여부는 별개입니다.</p>
      <div class="evidence-fields"><label class="evidence-wide"><span>원본 파일·폴더·웹 주소</span><input data-field="source" aria-label="자료 출처" maxlength="4096" placeholder="C:\\자료\\판매량.xlsx 또는 https://…"></label>
      <label><span>출처 시스템</span><input data-field="sourceSystem" aria-label="출처 시스템" maxlength="200" placeholder="예: CRM"></label>
      <label><span>자료 버전</span><input data-field="version" aria-label="자료 버전" maxlength="200" placeholder="예: 2026-10-30"></label></div>
      <div class="evidence-actions"><button type="button" data-evidence-action="open-source">원본 열기</button><button type="button" data-evidence-action="check-source">원본 변경 확인</button></div>
      <p class="evidence-note" data-evidence-source-feedback aria-live="polite"></p>
      <div class="evidence-fields"><label><span>확인자</span><input data-field="checkedBy" aria-label="확인자" maxlength="200" placeholder="직접 검토한 사람"></label>
      <label><span>확인 시각</span><input data-field="checkedAt" type="datetime-local" aria-label="확인 시각"></label>
      <label><span>확인한 버전</span><input data-field="verifiedVersion" aria-label="확인한 버전" maxlength="200"></label>
      <label><span>재확인 기한</span><input data-field="dueAt" type="date" aria-label="재확인 기한"></label>
      <label><span>재확인 주기 (일)</span><input data-field="reviewIntervalDays" type="number" min="1" max="3650" step="1" aria-label="재확인 주기" placeholder="예: 30"></label></div>
      <button type="button" class="evidence-primary" data-evidence-action="verify">직접 검토한 내용으로 확인 완료 기록</button>
      <p class="evidence-note">원본 존재 확인은 내용 검증이 아닙니다. 자료를 검토한 후 확인 기록을 남기세요.</p>
      <label class="evidence-notes"><span>자료 설명과 확인 메모</span><textarea data-field="notes" aria-label="자료 설명과 확인 메모" maxlength="10000" rows="3" placeholder="자료를 가져오는 방법, 주의할 점, 확인 근거"></textarea></label>
      <section class="evidence-custom-fields"><h4>사용자 정의 필드</h4><p class="evidence-note">업무별 속성을 최대 32개까지 추가합니다. 연결선의 조건부 적용에서 이 값을 사용할 수 있습니다.</p><div data-evidence-custom-fields></div><div class="evidence-fields"><label><span>새 필드 이름</span><input data-evidence-new-field aria-label="새 사용자 필드 이름" maxlength="64" placeholder="예: 보고주기"></label><label><span>새 필드 값</span><input data-evidence-new-value aria-label="새 사용자 필드 값" maxlength="2000" placeholder="예: 정기"></label></div><button type="button" data-evidence-action="add-custom-field">사용자 필드 추가</button></section>
      <div class="evidence-checklist"><h4>확인 항목</h4><div data-evidence-checklist></div><div class="evidence-add-check"><input data-evidence-new-check aria-label="새 확인 항목" maxlength="500" placeholder="확인할 항목 추가"><button type="button" data-evidence-action="add-check">추가</button></div></div>
      </fieldset>${locked(node)?'<p class="evidence-note">잠금을 풀면 자료 정보를 수정할 수 있습니다.</p>':''}`;
  }
  function localDate(value:string|undefined,includeTime:boolean) {
    if(!value)return '';const date=new Date(value);if(Number.isNaN(date.valueOf()))return '';
    const adjusted=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString();return adjusted.slice(0,includeTime?16:10);
  }
  function syncEditor(node:FlowNode) {
    const details=trackedDetails(node),state=analysis!.nodes.get(node.id);
    el('.evidence-editor-title h3').textContent=nameOf(node);
    const badge=el('[data-evidence-readiness]');badge.textContent=readinessNames[state?.status??'untracked'];badge.dataset.state=state?.status;
    el('[data-evidence-reasons]').textContent=state?.reasons.join(' · ')||'진행 준비 상태를 확인하려면 역할과 선행 관계를 설정하세요.';
    container.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('[data-field]').forEach(input=>{
      if(document.activeElement===input)return;
      const key=input.dataset.field as keyof NodeDetails;
      const value=details[key];input.value=key==='checkedAt'?localDate(details.checkedAt,true):key==='dueAt'?localDate(details.dueAt,false):typeof value==='string'||typeof value==='number'?String(value):key==='requirement'?'all':'';
    });
    el('[data-evidence-source-feedback]').textContent=sourceFeedback||'파일·폴더 확인은 데스크톱 앱에서 수행합니다. 웹 주소의 접근 가능 여부는 자동 확인하지 않습니다.';
    const checkButton=el<HTMLButtonElement>('[data-evidence-action="check-source"]');checkButton.disabled=sourceBusy||locked(node);checkButton.textContent=sourceBusy?'원본 확인 중…':'원본 변경 확인';
    const list=el('[data-evidence-checklist]');
    list.innerHTML=(details.checklist??[]).map(item=>`<div class="evidence-check-row"><label><input type="checkbox" data-check-id="${escape(item.id)}" ${item.done?'checked':''}><span>${escape(item.text)}</span></label><button type="button" data-remove-check="${escape(item.id)}" aria-label="${escape(item.text)} 항목 삭제">삭제</button></div>`).join('')||'<p class="evidence-note">개별 확인 항목을 추가할 수 있습니다.</p>';
    const custom=el('[data-evidence-custom-fields]');
    const customSchema=JSON.stringify(Object.keys(details.customFields??{}));
    if(custom.dataset.schema!==customSchema){custom.dataset.schema=customSchema;custom.innerHTML=Object.entries(details.customFields??{}).map(([key,value])=>`<div class="evidence-custom-row"><label><span>${escape(key)}</span><input data-custom-field="${escape(key)}" aria-label="${escape(key)} 사용자 필드 값" value="${escape(value)}" maxlength="2000"></label><button type="button" data-remove-custom="${escape(key)}" aria-label="${escape(key)} 사용자 필드 삭제">삭제</button></div>`).join('')||'<p class="evidence-note">등록된 사용자 필드가 없습니다.</p>';}
    custom.querySelectorAll<HTMLInputElement>('[data-custom-field]').forEach(input=>{if(document.activeElement!==input)input.value=details.customFields?.[input.dataset.customField!]??'';});
  }
  function refresh() {
    if(disposed)return;
    const doc=host.getDocument();
    if(watch){if(watch.doc!==doc)stopWatch('문서가 바뀌어 변경 감시를 중지했습니다.');else{watch.items=watch.items.filter(item=>doc.nodes.some(n=>n.id===item.id&&n.details?.source?.trim()===item.source));if(!watch.items.length)stopWatch('감시할 자료가 없어 변경 감시를 중지했습니다.');}}
    el<HTMLInputElement>('[data-evidence-watch]').checked=Boolean(watch);el('[data-evidence-watch-status]').textContent=watchStatus;
    const key=JSON.stringify([doc.nodes.map(n=>[n.id,n.details]),doc.edges.map(e=>[e.id,e.from,e.to,e.relation,e.condition]),doc.workspace?.attachments?.map(a=>a.id),Math.floor(Date.now()/60000)]);
    if(key!==analysisKey){analysis=analyzeWorkflow(doc);analysisKey=key;}
    if(!analysis)analysis=analyzeWorkflow(doc);
    const s=analysis.summary;
    el('[data-testid="evidence-summary"]').innerHTML=`<span>추적 중 <strong>${s.tracked}</strong></span><span>준비됨 <strong>${s.ready}</strong></span><span>확인 필요 <strong>${s.blocked+s.stale+s.cycle}</strong></span>`;
    const term=el<HTMLInputElement>('[data-evidence-search]').value.trim().toLocaleLowerCase(),filter=el<HTMLSelectElement>('[data-evidence-filter]').value;
    const includeNotes=el<HTMLInputElement>('[data-evidence-include-notes]').checked;
    const matches=doc.nodes.filter(n=>{
      const d=n.details,state=analysis!.nodes.get(n.id);
      if(reportView&&!includeNotes&&n.kind==='note')return false;
      if(filter==='resource'||filter==='step'){if(d?.role!==filter)return false;}
      if(filter==='blocked'&&!['blocked','cycle'].includes(state?.status??''))return false;
      if(filter==='stale'&&state?.status!=='stale')return false;
      if(filter==='unassigned'&&(!d?.role||d.owner?.trim()))return false;
      return !term||[n.text,d?.owner,d?.source,d?.sourceSystem,...(!reportView||includeNotes?[d?.notes]:[])].some(v=>v?.toLocaleLowerCase().includes(term));
    });
    const selection=host.getSelection();
    el('[data-evidence-list]').innerHTML=matches.slice(0,100).map(n=>{
      const d=n.details,state=analysis!.nodes.get(n.id);
      return `<div role="listitem"><button type="button" class="evidence-record ${selection.has(n.id)?'is-selected':''}" data-locate="${escape(n.id)}"><span class="evidence-record-name">${escape(nameOf(n))}<small>${d?.role==='resource'?'자료':d?.role==='step'?'절차':'요소'} · ${escape(d?.owner||'담당자 미지정')}</small></span><span class="evidence-status" data-state="${state?.status??'untracked'}">${readinessNames[state?.status??'untracked']}</span></button></div>`;
    }).join('')||'<p class="evidence-empty">해당하는 자료가 없습니다. 보드에서 요소를 선택해 자료 또는 절차로 설정하세요.</p>';
    el('[data-evidence-list-note]').textContent=matches.length>100?`${matches.length}개 중 100개 표시 · 검색으로 범위를 좁히세요.`:'';
    el('[data-evidence-list]').hidden=reportView;el('[data-evidence-report]').hidden=!reportView;
    container.querySelectorAll<HTMLElement>('.evidence-review').forEach(element=>element.hidden=reportView);
    el('[data-evidence-report-option]').hidden=!reportView;el('[data-evidence-selection]').hidden=reportView;
    container.querySelectorAll<HTMLButtonElement>('[data-evidence-view]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.evidenceView==='report')===reportView)));
    if(reportView)el('[data-evidence-report]').innerHTML=`<p class="evidence-note">${includeNotes?'내부 확인 메모와 메모 요소를 포함합니다.':'메모 요소와 내부 확인 메모를 숨깁니다.'} 원본 문서는 변경하지 않습니다. 전체 보고서는 내보내기에서 저장하세요.</p>`+matches.slice(0,100).map(n=>{
      const d=n.details??{},a=analysis!.nodes.get(n.id);
      return `<article class="evidence-report-row"><div class="evidence-editor-title"><button type="button" data-locate="${escape(n.id)}">${escape(nameOf(n))}</button><span class="evidence-status" data-state="${a?.status??'untracked'}">${readinessNames[a?.status??'untracked']}</span></div><dl><dt>담당자</dt><dd>${escape(d.owner||'미지정')}</dd><dt>원본 출처</dt><dd>${escape(d.sourceSystem||'')} ${escape(sourceDescription(n))}</dd><dt>자료 버전</dt><dd>${escape(d.version||'미등록')} · 확인한 버전 ${escape(d.verifiedVersion||'미등록')}</dd><dt>수동 상태</dt><dd>${statusNames[d.status??'']||'미설정'}</dd><dt>확인 기록</dt><dd>${escape(d.checkedBy||'미등록')} · ${escape(localDate(d.checkedAt,true).replace('T',' ')||'확인 시각 미등록')}</dd><dt>재확인 기한</dt><dd>${escape(localDate(d.dueAt,false)||'미지정')}</dd><dt>준비 조건</dt><dd>${escape(a?.reasons.join(' · ')||'추적 기준 미설정')}</dd>${includeNotes&&d.notes?`<dt>내부 메모</dt><dd>${escape(d.notes)}</dd>`:''}</dl></article>`;
    }).join('');
    const traceContainer=el('[data-evidence-trace]');
    if(trace&&!doc.nodes.some(n=>n.id===trace!.origin))trace=undefined;
    traceContainer.hidden=!trace||reportView;
    if(trace){const found=doc.nodes.filter(n=>trace!.ids.has(n.id));traceContainer.innerHTML=`<div class="evidence-editor-title"><h3>${trace.direction==='upstream'?'선행 관계':'영향 범위'} · ${found.length}개</h3><button type="button" data-evidence-action="clear-trace">닫기</button></div><p class="evidence-note">현재 페이지의 요소를 선택했습니다. 다른 페이지 항목을 누르면 해당 페이지로 이동합니다.</p>`+found.slice(0,100).map(n=>`<button type="button" class="evidence-text-link" data-locate="${escape(n.id)}">${escape(nameOf(n))}<small>${escape(doc.workspace?.pages?.find(p=>p.id===(n.details?.pageId??'page-main'))?.name??'기본 페이지')}</small></button>`).join('');}
    const node=selectedNode(),edge=selectedEdge(),nextKey=node?`node:${node.id}:${locked(node)}`:edge?`edge:${edge.id}`:`none:${selection.size}`;
    if(nextKey!==selectedKey){selectedKey=nextKey;sourceFeedback='';el('[data-evidence-selection]').innerHTML=node?editorView(node):edge?relationView(edge):`<div class="evidence-empty"><h3>${selection.size>1?`${selection.size}개 요소 선택됨`:'자료를 선택하세요'}</h3><p>${selection.size>1?'정보를 편집하려면 목록에서 요소 하나를 선택하세요.':'보드나 위 목록에서 요소를 선택하면 출처와 선행 조건을 관리할 수 있습니다.'}</p></div>`;}
    if(node)syncEditor(node);
    if(edge){const input=el<HTMLSelectElement>('[data-evidence-relation]');if(document.activeElement!==input)input.value=edge.relation??'required';syncCondition(edge);}
    const owners=new Map<string,FlowNode[]>();
    for(const n of doc.nodes){if(!n.details?.role||analysis.nodes.get(n.id)?.ready)continue;const owner=n.details.owner?.trim()||'담당자 미지정';if(!owners.has(owner))owners.set(owner,[]);owners.get(owner)!.push(n);}
    el('[data-evidence-todos]').innerHTML=[...owners].slice(0,40).map(([owner,nodes])=>`<h4>${escape(owner)} <small>${nodes.length}개</small></h4>${nodes.slice(0,20).map(n=>`<button class="evidence-text-link" type="button" data-locate="${escape(n.id)}">${escape(nameOf(n))}<small>${escape(analysis!.nodes.get(n.id)?.reasons[0]||statusNames[n.details?.status??'missing'])}</small></button>`).join('')}`).join('')||'<p class="evidence-note">현재 추적 중인 요소에 미충족 조건이 없습니다.</p>';
    el('[data-evidence-issues]').innerHTML=analysis.issues.slice(0,100).map(issue=>`<button class="evidence-text-link" type="button" data-locate="${escape(issue.nodeId)}">${escape(nameOf(doc.nodes.find(n=>n.id===issue.nodeId)??{text:'보드 점검',kind:'text'} as FlowNode))}<small>${escape(issue.message)}</small></button>`).join('')||'<p class="evidence-note">추적 규칙에서 발견한 문제가 없습니다. 실제 자료 내용의 검증을 대신하지 않습니다.</p>';
  }
  function updateField(event:Event) {
    const input=event.target as HTMLInputElement;
    if(input.matches('[data-evidence-filter]')){refresh();return;}
    if(input.matches('[data-evidence-include-notes]')){refresh();return;}
    if(input.matches('[data-evidence-watch]')){if(input.checked)startWatch();else stopWatch();refresh();return;}
    if(input.matches('[data-custom-field]')){const key=input.dataset.customField!;changeDetails(d=>{if(d.customFields&&Object.hasOwn(d.customFields,key))d.customFields[key]=input.value.slice(0,2000);});return;}
    if(input.dataset.condition){const edge=selectedEdge();if(!edge)return;const key=input.dataset.condition;
      host.mutate(()=>{if(key==='enabled'){if(input.checked)edge.condition={nodeId:edge.from,field:'status',operator:'equals',value:'verified'};else delete edge.condition;}
        else if(edge.condition){if(key==='nodeId'){edge.condition.nodeId=input.value;edge.condition.field='status';edge.condition.value='verified';}else if(key==='field'){edge.condition.field=input.value;edge.condition.value=input.value==='status'?'verified':'';}else if(key==='operator'&&(input.value==='equals'||input.value==='notEquals'))edge.condition.operator=input.value;else if(key==='value')edge.condition.value=input.value.slice(0,2000);}});
      syncCondition(edge,key==='enabled'||key==='nodeId'||key==='field');refresh();return;}
    if(input.matches('[data-evidence-relation]')){const edge=selectedEdge();if(edge)host.mutate(()=>edge.relation=input.value as FlowEdge['relation']);refresh();return;}
    if(input.matches('[data-check-id]')){changeDetails(d=>{const item=d.checklist?.find(c=>c.id===input.dataset.checkId);if(item)item.done=input.checked;});return;}
    const field=input.dataset.field as keyof NodeDetails|undefined;if(!field)return;
    const raw=input.value.trim();if(field==='source')sourceFeedback='';
    changeDetails(d=>{
      if(field==='reviewIntervalDays'){const days=Number(raw);if(!raw)delete d.reviewIntervalDays;else if(Number.isInteger(days)&&days>=1&&days<=3650)d.reviewIntervalDays=days;else{host.toast('재확인 주기는 1~3650일의 정수로 입력하세요.',true);input.value=d.reviewIntervalDays?String(d.reviewIntervalDays):'';}return;}
      if(field==='checkedAt'||field==='dueAt'){if(!raw)delete d[field];else{const date=new Date(field==='dueAt'?`${raw}T23:59:59`:raw);if(!Number.isNaN(date.valueOf()))d[field]=date.toISOString();}return;}
      if(field==='role'&&!raw){delete d.role;return;}
      if(!raw){delete d[field];return;}
      Object.assign(d,{[field]:raw});
      if(field==='version'&&d.status==='verified'&&d.verifiedVersion!==raw)d.status='stale';
      if((field==='source'||field==='sourceSystem')&&d.status==='verified')d.status='stale';
    });
  }
  function stopWatch(message='변경 감시 꺼짐') {clearTimeout(watchTimer);watchTimer=undefined;watch=undefined;watchStatus=message;}
  function startWatch() {
    if(!bridge()?.CheckSource){host.toast('원본 변경 감시는 데스크톱 앱에서 사용할 수 있습니다.',true);return;}
    const doc=host.getDocument(),ids=host.getSelection(),nodes=doc.nodes.filter(n=>ids.has(n.id)&&n.details?.source?.trim());
    const items=nodes.filter(n=>!/^https?:\/\//i.test(n.details!.source!.trim())).map(n=>({id:n.id,source:n.details!.source!.trim()}));
    if(!items.length){host.toast('감시할 로컬 원본이 있는 자료를 선택하세요. 웹 주소의 접근 상태는 확인하지 않습니다.',true);return;}
    if(items.length>20){host.toast('변경 감시는 한 번에 최대 20개 자료를 선택하세요.',true);return;}
    stopWatch();watch={doc,items,cursor:0,checked:0};watchStatus=`${items.length}개 자료 감시 중 · 60초 뒤 첫 확인 · 전체 확인 주기 최대 ${Math.ceil(items.length/5)}분`;
    watchTimer=setTimeout(()=>void watchTick(),60000);
  }
  async function watchTick() {
    watchTimer=undefined;const current=watch,api=bridge();if(!current||disposed)return;
    if(!api?.CheckSource){stopWatch('원본 확인 기능이 연결되어 있지 않아 감시를 중지했습니다.');refresh();return;}
    if(host.getDocument()!==current.doc){stopWatch('문서가 바뀌어 변경 감시를 중지했습니다.');refresh();return;}
    current.items=current.items.filter(item=>current.doc.nodes.some(n=>n.id===item.id&&n.details?.source?.trim()===item.source));
    if(!current.items.length){stopWatch('감시할 자료가 없어 변경 감시를 중지했습니다.');refresh();return;}
    let checked=0,changed=0,failed=0;
    for(let index=0;index<Math.min(5,current.items.length);index++){
      if(watch!==current||disposed)break;
      const item=current.items[current.cursor++%current.items.length],node=current.doc.nodes.find(n=>n.id===item.id);
      if(!node||node.details?.source?.trim()!==item.source)continue;
      try{
        const result=await api.CheckSource(item.source);
        if(watch!==current||disposed||host.getDocument()!==current.doc||!current.doc.nodes.includes(node)||node.details?.source?.trim()!==item.source)break;
        if(result.kind==='url'){failed++;continue;}
        checked++;const d=node.details,prior=d.sourceFingerprint,sourceChanged=Boolean(prior&&result.fingerprint&&prior!==result.fingerprint);
        const needsFingerprint=Boolean(result.fingerprint&&result.fingerprint!==prior),needsStale=(sourceChanged||!result.exists)&&d.status==='verified';
        if(needsFingerprint||needsStale){host.mutate(()=>{if(needsFingerprint)d.sourceFingerprint=result.fingerprint;if(needsStale)d.status='stale';});if(sourceChanged||!result.exists)changed++;}
      }catch{failed++;}
    }
    if(watch!==current||disposed)return;
    current.checked+=checked;watchStatus=`${current.items.length}개 자료 감시 중 · ${new Date().toLocaleTimeString('ko-KR')} ${checked}개 확인${changed?` · 변경/없음 ${changed}개`:''}${failed?` · 확인 실패 ${failed}개`:''} · 실제 내용 검증 아님`;
    watchTimer=setTimeout(()=>void watchTick(),60000);refresh();
  }
  async function runAction(action:string) {
    if(action==='clear-trace'){trace=undefined;refresh();return;}
    if(action==='remove-condition'){const edge=selectedEdge();if(edge){host.mutate(()=>delete edge.condition,'조건부 적용을 제거했습니다.');syncCondition(edge,true);refresh();}return;}
    const node=selectedNode();if(!node)return;
    if(action==='upstream'||action==='downstream'){
      const doc=host.getDocument(),ids=traceNodes(doc,node.id,action);ids.add(node.id);trace={origin:node.id,direction:action,ids};reveal(node);
      const currentPage=doc.workspace?.activePageId??'page-main',hidden=new Set(doc.workspace?.layers?.filter(l=>l.hidden).map(l=>l.id));
      const nodes=doc.nodes.filter(n=>ids.has(n.id)&&(n.details?.pageId??'page-main')===currentPage&&!hidden.has(n.details?.layerId??'layer-main'));
      host.select(nodes.map(n=>n.id));host.fit(nodes);host.toast(`관계 ${ids.size}개 중 현재 페이지 ${nodes.length}개를 선택했습니다.`);refresh();return;
    }
    const details=trackedDetails(node);
    if(action==='add-custom-field'){
      const input=el<HTMLInputElement>('[data-evidence-new-field]'),valueInput=el<HTMLInputElement>('[data-evidence-new-value]'),key=input.value.trim();
      if(!key||key.length>64||/[\u0000-\u001f\u007f]/.test(key)||['__proto__','prototype','constructor','status'].includes(key)){host.toast('필드 이름은 1~64자로 입력하세요. status 등 예약된 이름은 사용할 수 없습니다.',true);return;}
      if(Object.hasOwn(details.customFields??{},key)){host.toast('같은 이름의 필드가 있습니다. 기존 값을 수정하세요.',true);return;}
      if(Object.keys(details.customFields??{}).length>=32){host.toast('사용자 필드는 요소마다 최대 32개입니다.',true);return;}
      changeDetails(d=>{d.customFields??={};d.customFields[key]=valueInput.value.slice(0,2000);},'사용자 필드를 추가했습니다.');input.value='';valueInput.value='';return;
    }
    if(action==='add-check'){const input=el<HTMLInputElement>('[data-evidence-new-check]'),text=input.value.trim();if(!text)return;if((details.checklist?.length??0)>=100){host.toast('확인 항목은 요소마다 100개까지 추가할 수 있습니다.',true);return;}changeDetails(d=>{d.checklist??=[];d.checklist.push({id:crypto.randomUUID(),text,done:false});});input.value='';return;}
    if(action==='verify'){
      if(!details.checkedBy?.trim()){host.toast('실제 확인한 사람을 확인자에 입력하세요.',true);el<HTMLInputElement>('[data-field="checkedBy"]').focus();return;}
      if(details.role==='resource'&&!details.source?.trim()&&!host.getDocument().workspace?.attachments?.some(a=>details.attachmentIds?.includes(a.id))){host.toast('확인 근거가 되는 원본 출처나 첨부 자료를 먼저 등록하세요.',true);el<HTMLInputElement>('[data-field="source"]').focus();return;}
      changeDetails(d=>{d.status='verified';d.checkedAt=new Date().toISOString();d.verifiedVersion=d.version??'';d.verifiedSourceFingerprint=d.sourceFingerprint??'';},'사용자가 확인한 내용과 현재 버전을 기록했습니다.');return;
    }
    const source=details.source?.trim();if(!source){host.toast('원본 파일·폴더·웹 주소를 먼저 입력하세요.',true);return;}
    if(action==='open-source'){
      const api=bridge();if(api?.OpenSource){await api.OpenSource(source);return;}
      let url:URL;try{url=new URL(source);}catch{host.toast('로컬 파일과 폴더는 데스크톱 앱에서 열 수 있습니다.',true);return;}
      if(!['http:','https:'].includes(url.protocol)){host.toast('HTTP 또는 HTTPS 웹 주소만 브라우저에서 열 수 있습니다.',true);return;}
      window.open(url.href,'_blank','noopener,noreferrer');return;
    }
    if(action==='check-source'){
      const api=bridge();if(!api?.CheckSource){host.toast('원본 파일 확인은 데스크톱 앱에서 사용할 수 있습니다.',true);return;}
      const document=host.getDocument(),nodeId=node.id;sourceBusy=true;refresh();
      try{
        const result=await api.CheckSource(source);
        if(host.getDocument()!==document||!document.nodes.includes(node)||locked(node)||node.details?.source?.trim()!==source)return;
        const prior=node.details?.sourceFingerprint;
        const changed=Boolean(prior&&result.fingerprint&&prior!==result.fingerprint);
        if(result.kind!=='url')host.mutate(()=>{
          node.details??={role:'resource'};
          if(result.fingerprint)node.details.sourceFingerprint=result.fingerprint;
          if((changed||!result.exists)&&node.details.status==='verified')node.details.status='stale';
        });
        if(selectedNode()?.id===nodeId)sourceFeedback=result.kind==='url'?result.note:!result.exists?'원본을 찾을 수 없습니다. 경로를 확인하거나 자료를 다시 연결하세요.':`${changed?'원본 변경을 감지했습니다. 내용을 다시 확인하세요.':'원본이 존재합니다. 내용의 확인 완료를 의미하지 않습니다.'} ${result.note??''}`;
      }finally{sourceBusy=false;refresh();}
    }
  }
  const click=(event:Event)=>{
    const target=(event.target as HTMLElement).closest<HTMLElement>('button');if(!target)return;
    if(target.dataset.evidenceView){reportView=target.dataset.evidenceView==='report';refresh();return;}
    if(target.dataset.locate){locate(target.dataset.locate);return;}
    if(target.dataset.removeCheck){changeDetails(d=>{d.checklist=d.checklist?.filter(c=>c.id!==target.dataset.removeCheck);});return;}
    if(target.dataset.removeCustom){changeDetails(d=>{if(d.customFields)delete d.customFields[target.dataset.removeCustom!];});return;}
    if(target.dataset.evidenceAction)void runAction(target.dataset.evidenceAction).catch(error=>host.toast(`자료 작업을 완료하지 못했습니다. ${String(error)}`,true));
  };
  const search=(event:Event)=>{if((event.target as HTMLElement).matches('[data-evidence-search]'))refresh();else if((event.target as HTMLElement).matches('[data-condition-search]')){const edge=selectedEdge();if(edge)syncConditionNodes(edge);}};
  const keydown=(event:KeyboardEvent)=>{if(event.key==='Enter'&&(event.target as HTMLElement).matches('[data-evidence-new-check]')){event.preventDefault();void runAction('add-check');}};
  container.addEventListener('change',updateField);container.addEventListener('click',click);container.addEventListener('input',search);container.addEventListener('keydown',keydown);
  refresh();
  return {update:refresh,documentChanged(){stopWatch('문서가 바뀌어 변경 감시를 중지했습니다.');trace=undefined;selectedKey='';},destroy(){disposed=true;stopWatch();container.removeEventListener('change',updateField);container.removeEventListener('click',click);container.removeEventListener('input',search);container.removeEventListener('keydown',keydown);container.replaceChildren();}};
}
