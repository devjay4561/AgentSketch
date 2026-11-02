import './attachments-panel.css';
import type { FlowDocument } from './types.ts';
import type { WorkbenchHost, WorkspaceAttachment } from './workspace-types.ts';
import { editableNodeIds } from './organization.ts';
import { addAttachment, applySourceRelink, attachmentBlob, prepareAttachment, previewSourceRelink, removeAttachment } from './attachments.ts';

type AttachmentAPI = { SaveArtifact?(name:string,kind:string,data:string):Promise<string> };
const native = () => (window as Window & {go?:{main?:{App?:AttachmentAPI}}}).go?.main?.App;
const sizeLabel = (bytes:number) => bytes < 1024*1024 ? `${Math.ceil(bytes/1024)} KiB` : `${(bytes/1024/1024).toFixed(1)} MiB`;
const readableError = (error:unknown) => error instanceof Error ? error.message : String(error);

/** User-requested file reads only. No directory watching or background attachment decoding. */
export function mountAttachmentsPanel(host:WorkbenchHost, container:HTMLElement) {
  container.classList.add('attachments-panel');
  container.innerHTML = `
    <section class="attachments-section"><h3>선택한 요소에 첨부</h3><p data-attachment-selection class="attachments-note"></p>
      <div class="attachments-actions"><button type="button" class="attachments-primary" data-attachment-add>자료 파일 첨부</button><span class="attachments-note">파일당 5 MiB · 보드 전체 20 MiB</span></div>
      <input type="file" data-attachment-input hidden accept=".pdf,.xlsx,.docx,.pptx,.txt,.csv,.png,.jpg,.jpeg,.webp,.gif">
      <p class="attachments-note">PDF, Excel, Word, PowerPoint, 텍스트, CSV와 이미지를 보관합니다. 원본 파일은 변경하지 않습니다. 첨부는 문서 저장 시 함께 보관됩니다.</p>
      <p class="attachments-feedback" data-attachment-feedback aria-live="polite"></p>
    </section>
    <section class="attachments-section"><div class="attachments-section-head"><h3>보관한 파일</h3><label class="attachments-filter"><span>표시 범위</span><select data-attachment-filter aria-label="첨부 파일 표시 범위"><option value="selected">선택한 요소</option><option value="all">문서 전체</option></select></label></div>
      <p class="attachments-note" data-attachment-usage></p><div class="attachments-list" data-attachment-list role="list" aria-label="보관한 파일 목록"></div>
    </section>
    <section class="attachments-section"><h3>원본 경로 다시 연결</h3><p class="attachments-note">자료 폴더를 옮겼다면 출처 경로의 앞부분을 바꿀 수 있습니다. 바뀔 항목을 확인한 뒤 적용하세요. 첨부 파일과 실제 원본 파일은 이동하지 않습니다.</p>
      <div class="attachments-path-fields"><label><span>이전 경로 앞부분</span><input data-relink-from aria-label="이전 경로 앞부분" maxlength="4096" placeholder="C:\\이전자료\\"></label><label><span>새 경로 앞부분</span><input data-relink-to aria-label="새 경로 앞부분" maxlength="4096" placeholder="D:\\업무자료\\"></label></div>
      <div class="attachments-actions"><button type="button" data-relink-preview>변경 내용 미리보기</button><button type="button" class="attachments-primary" data-relink-apply disabled>확인한 경로 변경 적용</button></div>
      <p data-relink-feedback class="attachments-feedback" aria-live="polite"></p><div data-relink-results class="attachments-relink-results"></div>
    </section>`;
  const el = <T extends HTMLElement = HTMLElement>(selector:string) => container.querySelector<T>(selector)!;
  const picker=el<HTMLInputElement>('[data-attachment-input]'),add=el<HTMLButtonElement>('[data-attachment-add]');
  const filter=el<HTMLSelectElement>('[data-attachment-filter]'),list=el('[data-attachment-list]');
  const from=el<HTMLInputElement>('[data-relink-from]'),to=el<HTMLInputElement>('[data-relink-to]'),apply=el<HTMLButtonElement>('[data-relink-apply]');
  let busy=false,disposed=false,previewDocument:FlowDocument|undefined,relinkPage=0;
  let changes:ReturnType<typeof previewSourceRelink>=[];
  const selectedNode=()=>{const ids=host.getSelection();return ids.size===1?host.getDocument().nodes.find(n=>ids.has(n.id)):undefined;};
  const node=<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text='')=>{const n=document.createElement(tag);n.className=className;n.textContent=text;return n;};
  function report(error:unknown){if(disposed)return;const text=readableError(error);el('[data-attachment-feedback]').textContent=text;host.toast(text,true);}
  function clearPreview(){changes=[];previewDocument=undefined;relinkPage=0;apply.disabled=true;apply.textContent='확인한 경로 변경 적용';el('[data-relink-results]').replaceChildren();el('[data-relink-feedback]').textContent='';}
  function renderRelinkPage(){
    const results=el('[data-relink-results]');results.replaceChildren();
    const start=relinkPage*100,end=Math.min(start+100,changes.length);
    for(const change of changes.slice(start,end)){
      const row=node('div','attachment-path-change'),source=previewDocument?.nodes.find(n=>n.id===change.nodeId);
      row.append(node('strong','',source?.text.split('\n')[0]||'이름 없는 요소'),node('span','',`이전: ${change.oldSource}`),node('span','',`변경: ${change.newSource}`));results.append(row);
    }
    if(changes.length>100){
      const pages=node('div','attachments-actions');pages.append(node('span','attachments-note',`${start+1}–${end} / ${changes.length}개`));
      for(const [label,delta] of [['이전',-1],['다음',1]] as const){const b=node('button','',label);b.type='button';b.disabled=delta<0?relinkPage===0:end>=changes.length;b.onclick=()=>{relinkPage+=delta;renderRelinkPage();};pages.append(b);}results.append(pages);
    }
  }
  function redrawList(){
    const doc=host.getDocument(),selected=selectedNode(),all=doc.workspace?.attachments??[],ids=new Set(selected?.details?.attachmentIds??[]);
    const visible=filter.value==='all'?all:all.filter(item=>ids.has(item.id));
    el('[data-attachment-usage]').textContent=`문서 전체 ${all.length}개 · ${sizeLabel(all.reduce((sum,item)=>sum+item.size,0))} / 20 MiB`;
    list.replaceChildren();
    if(!visible.length){list.append(node('p','attachments-empty',filter.value==='all'?'아직 보관한 파일이 없습니다.':'선택한 요소에 첨부된 파일이 없습니다.'));return;}
    for(const attachment of visible){
      const row=node('div','attachment-row');row.setAttribute('role','listitem');
      const info=node('div','attachment-info'),name=node('strong','',attachment.name);
      const uses=doc.nodes.filter(n=>n.details?.attachmentIds?.includes(attachment.id)).length;
      info.append(name,node('span','',`${sizeLabel(attachment.size)} · ${uses}개 요소에서 참조`));row.append(info);
      const actions=node('div','attachments-actions');
      const download=node('button','','파일 저장');download.type='button';download.disabled=busy;download.setAttribute('aria-label',`${attachment.name} 파일 저장`);download.addEventListener('click',()=>void saveFile(attachment));
      const remove=node('button','attachments-danger','첨부 삭제');remove.type='button';remove.disabled=busy;remove.setAttribute('aria-label',`${attachment.name} 첨부 삭제`);remove.addEventListener('click',()=>{
        try{if(host.getDocument()!==doc)throw new Error('문서가 바뀌었습니다. 파일 목록을 다시 확인하세요.');host.mutate(()=>removeAttachment(doc,attachment.id),'문서에서 첨부를 삭제했습니다. Ctrl+Z로 되돌릴 수 있습니다.');update();}catch(error){report(error);}
      });actions.append(download,remove);row.append(actions);list.append(row);
    }
  }
  async function saveFile(attachment:WorkspaceAttachment){
    if(busy)return;busy=true;update();
    try{
      const api=native();let saved=true;
      if(api?.SaveArtifact){const kind=attachment.name.split('.').at(-1)!.toLowerCase();saved=Boolean(await api.SaveArtifact(attachment.name,`attachment:${kind}`,attachment.data));}
      else{
        const url=URL.createObjectURL(attachmentBlob(attachment)),a=document.createElement('a');a.href=url;a.download=attachment.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
      }
      if(saved)host.toast('첨부 파일을 저장했습니다. 필요한 프로그램에서 파일을 열어 확인하세요.');
    }catch(error){report(error);}finally{busy=false;if(!disposed)update();}
  }
  add.addEventListener('click',()=>picker.click());
  picker.addEventListener('change',()=>void(async()=>{
    const file=picker.files?.[0];picker.value='';if(!file||busy)return;
    const doc=host.getDocument(),selected=selectedNode();if(!selected||!editableNodeIds(doc).has(selected.id)){host.toast('편집할 수 있는 요소 하나를 선택하세요.',true);return;}
    busy=true;el('[data-attachment-feedback]').textContent='파일을 확인하고 문서에 담는 중입니다…';update();
    try{
      const attachment=await prepareAttachment(file);
      if(disposed)return;
      if(host.getDocument()!==doc||!doc.nodes.some(n=>n.id===selected.id))throw new Error('문서가 바뀌었습니다. 대상 요소를 선택하고 다시 첨부하세요.');
      if(!editableNodeIds(doc).has(selected.id))throw new Error('대상 요소가 잠겼습니다. 잠금을 풀고 다시 첨부하세요.');
      host.mutate(()=>addAttachment(doc,selected.id,attachment),'자료 파일을 첨부했습니다.');el('[data-attachment-feedback]').textContent=`${attachment.name} · 첨부 완료`;
    }catch(error){report(error);}finally{busy=false;if(!disposed)update();}
  })());
  filter.addEventListener('change',redrawList);
  from.addEventListener('input',clearPreview);to.addEventListener('input',clearPreview);
  el('[data-relink-preview]').addEventListener('click',()=>{
    clearPreview();try{
      previewDocument=host.getDocument();changes=previewSourceRelink(previewDocument,from.value,to.value);
      el('[data-relink-feedback]').textContent=changes.length?`${changes.length}개 요소의 출처를 변경합니다. 확인 완료 자료는 재확인 상태로 바뀝니다.`:'변경할 출처 경로가 없습니다.';
      renderRelinkPage();apply.textContent=changes.length?`전체 ${changes.length}개 경로 변경 적용`:'확인한 경로 변경 적용';apply.disabled=!changes.length||busy;
    }catch(error){clearPreview();el('[data-relink-feedback]').textContent=readableError(error);host.toast(readableError(error),true);}
  });
  apply.addEventListener('click',()=>{
    if(!changes.length||busy)return;
    try{
      const doc=host.getDocument();if(doc!==previewDocument||changes.some(c=>doc.nodes.find(n=>n.id===c.nodeId)?.details?.source!==c.oldSource))throw new Error('자료 정보가 바뀌었습니다. 변경 내용을 다시 미리 확인하세요.');
      let count=0;host.mutate(()=>{count=applySourceRelink(doc,changes);},'원본 경로를 다시 연결했습니다.');clearPreview();el('[data-relink-feedback]').textContent=`${count}개 출처 경로를 변경했습니다.`;update();
    }catch(error){clearPreview();el('[data-relink-feedback]').textContent=readableError(error);host.toast(readableError(error),true);}
  });
  function update(){
    if(disposed)return;
    const doc=host.getDocument(),selected=selectedNode(),editable=selected&&editableNodeIds(doc).has(selected.id);
    el('[data-attachment-selection]').textContent=selected?`첨부 대상: ${selected.text.split('\n')[0]||'이름 없는 요소'}${editable?'':' · 잠긴 요소'}`:'작업지에서 요소 하나를 선택한 뒤 파일을 첨부하세요.';
    add.disabled=busy||!editable;apply.disabled=busy||!changes.length;
    if(previewDocument&&previewDocument!==doc)clearPreview();
    redrawList();
  }
  update();return {update,destroy(){disposed=true;container.replaceChildren();}};
}
