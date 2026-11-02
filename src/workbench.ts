import type {WorkbenchHost} from './workspace-types.ts';
import './workbench.css';
import {icon} from './icons.ts';
type Panel = {update():void;documentChanged?():void;dispose?():void;destroy?():void};
// [id, label, icon, group]
const groups = ['자료 관리','보드 정리','공유와 검토'] as const;
const sections = [
  ['evidence','자료와 준비 상태','evidence',0],
  ['attachments','첨부와 경로','attach',0],
  ['documents','문서 보관함','archive',0],
  ['ocr','이미지 글자 읽기','scan',0],
  ['layout','자동 배치','auto-layout',1],
  ['organization','페이지와 그룹','pages',1],
  ['canvas','편집 도구','properties',1],
  ['interchange','보고와 호환','export',2],
  ['review','검토와 발표','review',2],
  ['collaboration','공동 작업','users',2],
] as const;
export function mountWorkbench(host:WorkbenchHost) {
  const dialog=document.createElement('dialog');dialog.className='workbench';dialog.setAttribute('aria-labelledby','workbench-title');
  dialog.innerHTML=`<div class="wb-body"><nav class="wb-nav" aria-label="업무 도구 분류"><h1 id="workbench-title">업무 도구</h1></nav><main class="wb-main"><header class="wb-main-head"><h2 class="wb-title"></h2><button type="button" class="wb-close" aria-label="업무 도구 닫기">닫기 <kbd>Esc</kbd></button></header><div class="wb-panels"></div></main></div>`;
  document.body.append(dialog);
  const nav=dialog.querySelector('.wb-nav')!,panels=dialog.querySelector('.wb-panels')!;
  const entries=new Map<string,{container:HTMLElement;panel?:Panel;loading?:Promise<void>}>();let current='evidence',lastDocument=host.getDocument();
  async function show(id:string){
    const definition=sections.find(s=>s[0]===id);if(!definition)return;
    current=id;dialog.querySelector('.wb-title')!.textContent=definition[1];
    nav.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.setAttribute('aria-current',String(b.dataset.panel===id)));
    for(const [key,entry] of entries)entry.container.hidden=key!==id;
    let entry=entries.get(id);
    if(!entry){const container=document.createElement('div');container.dataset.workspacePanel=id;panels.append(container);entry={container};entries.set(id,entry);}
    entry.container.hidden=false;
    if(!entry.panel&&!entry.loading){
      const target=entry;target.container.textContent='도구를 여는 중…';
      target.loading=(async()=>{
        const mount = id==='evidence'?(await import('./evidence-panel.ts')).mountEvidencePanel
          :id==='layout'?(await import('./layout-ui.ts')).mountLayoutPanel
          :id==='organization'?(await import('./organization-panel.ts')).mountOrganizationPanel
          :id==='canvas'?(await import('./canvas-tools.ts')).mountCanvasTools
          :id==='attachments'?(await import('./attachments-panel.ts')).mountAttachmentsPanel
          :id==='documents'?(await import('./document-library.ts')).mountDocumentLibrary
          :id==='interchange'?(await import('./interchange-panel.ts')).mountInterchangePanel
          :id==='review'?(await import('./review-panel.ts')).mountReviewPanel
          :id==='ocr'?(await import('./ocr-panel.ts')).mountOcrPanel
          :(await import('./collaboration-panel.ts')).mountCollaborationPanel;
        target.container.textContent='';target.panel=mount(host,target.container);target.panel?.update();
      })().catch(error=>{target.container.textContent=`도구를 열지 못했습니다. ${String(error)}`;host.toast(String(error),true);}).finally(()=>{target.loading=undefined;});
    }else entry.panel?.update();
    await entry.loading;
  }
  groups.forEach((title,index)=>{const heading=document.createElement('p');heading.className='wb-nav-group';heading.textContent=title;nav.append(heading);
    for(const [id,label,glyph] of sections.filter(s=>s[3]===index)){const button=document.createElement('button');button.type='button';button.dataset.panel=id;button.innerHTML=`${icon(glyph,18)}<span></span>`;button.querySelector('span')!.textContent=label;button.onclick=()=>void show(id);nav.append(button);}});
  dialog.querySelector('.wb-close')!.addEventListener('click',()=>dialog.close());
  return {async open(id='evidence'){if(!dialog.open)dialog.showModal();await show(id);},close(){dialog.close();},update(){const next=host.getDocument();if(next!==lastDocument){lastDocument=next;for(const entry of entries.values())entry.panel?.documentChanged?.();}if(dialog.open)entries.get(current)?.panel?.update();},get isOpen(){return dialog.open;}};
}
