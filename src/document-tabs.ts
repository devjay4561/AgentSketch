import './document-tabs.css';
import type { FlowDocument } from './types.ts';
import type { WorkbenchHost } from './workspace-types.ts';
import { cloneDocument, emptyDocument, uid, validateDocument } from './model.ts';

type TabsHost = Omit<WorkbenchHost,'replaceDocument'> & {
  getFilePath?():string; getDirty?():boolean;
  setDirty?(dirty:boolean):void; commitEditing?():void;
  restoreTab?(doc:FlowDocument,path:string,dirty:boolean):Promise<boolean>;
  replaceDocument(doc:FlowDocument,path?:string):void|Promise<boolean>;
};
type Tab = {id:string;title:string;path:string;dirty:boolean;bytes:number;identity:string;document?:FlowDocument};
type TabState = {activeId:string;tabs:Omit<Tab,'document'>[]};
const MAX_TABS=5,MAX_BYTES=60*1024*1024,DB_NAME='agentsketch-tabs';
const encoder=new TextEncoder();

function identity(doc:FlowDocument):string {
  return JSON.stringify([doc.title,doc.nodes.map(n=>n.id),doc.edges.map(e=>e.id)]);
}
/** Image payloads are ASCII data URLs, counted without building another giant JSON string. */
function byteSize(doc:FlowDocument):number {
  const assets=Object.fromEntries(Object.entries(doc.assets).map(([id,a])=>[id,{...a,data:''}]));
  return encoder.encode(JSON.stringify({...doc,assets})).byteLength+Object.values(doc.assets).reduce((sum,a)=>sum+a.data.length,0);
}
function openDatabase():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{request.result.createObjectStore('documents');request.result.createObjectStore('state');};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('다른 창에서 탭 저장소를 사용 중입니다. 다른 AgentSketch 창을 닫으세요.'));
  });
}
function read<T>(db:IDBDatabase,store:string,key:string):Promise<T|undefined> {
  return new Promise((resolve,reject)=>{const request=db.transaction(store).objectStore(store).get(key);request.onsuccess=()=>resolve(request.result as T|undefined);request.onerror=()=>reject(request.error);});
}

/** Inactive documents stay on disk and are decoded only when selected. No polling. */
export function mountDocumentTabs(host:TabsHost,container:HTMLElement) {
  container.classList.add('document-tabs');container.setAttribute('aria-label','열린 문서');
  let activeId=uid(),disposed=false,busy=false,ready=false,blocked=false,dirtyFallback=false;
  let revision=0,persistedRevision=-1,timer:ReturnType<typeof setTimeout>|undefined;
  let serial:Promise<void>=Promise.resolve(),database:IDBDatabase|undefined;
  const deleted=new Set<string>();
  let tabs:Tab[]=[{id:activeId,title:host.getDocument().title,path:host.getFilePath?.()??'',dirty:host.getDirty?.()??false,bytes:0,identity:identity(host.getDocument()),document:host.getDocument()}];
  const list=document.createElement('div');list.className='document-tab-list';list.setAttribute('role','tablist');list.setAttribute('aria-label','문서 탭');
  const add=document.createElement('button');add.type='button';add.className='document-tab-new';add.textContent='새 문서';add.setAttribute('aria-label','새 문서 탭');
  const status=document.createElement('span');status.className='document-tabs-status';status.setAttribute('aria-live','polite');status.textContent='탭을 불러오는 중…';
  container.append(list,add,status);

  function capture(){
    const current=tabs.find(t=>t.id===activeId);if(!current)return;
    current.document=host.getDocument();current.title=current.document.title;current.path=host.getFilePath?.()??current.path;
    const reported=host.getDirty?.();if(dirtyFallback&&reported)dirtyFallback=false;
    current.dirty=dirtyFallback?true:reported??current.dirty;
  }
  function report(error:unknown){status.textContent='탭 복구 저장 실패';status.title=String(error);host.toast(`탭을 보관하지 못했습니다. 파일로 저장하세요. ${error instanceof Error?error.message:String(error)}`,true);}
  function render(){
    if(disposed)return;list.replaceChildren();
    for(const tab of tabs){
      const item=document.createElement('div');item.className='document-tab';item.classList.toggle('active',tab.id===activeId);
      const select=document.createElement('button');select.type='button';select.className='document-tab-select';select.setAttribute('role','tab');select.setAttribute('aria-selected',String(tab.id===activeId));select.tabIndex=tab.id===activeId?0:-1;
      select.title=tab.path||`${tab.title} · 파일로 저장하지 않은 문서`;select.textContent=tab.title||'이름 없는 보드';select.setAttribute('aria-label',`${tab.title}${tab.dirty?' · 파일에 저장하지 않은 변경 있음':''}`);select.disabled=busy;
      if(tab.dirty){const mark=document.createElement('span');mark.className='document-tab-dirty';mark.setAttribute('aria-hidden','true');select.append(mark);}
      select.onclick=()=>void switchTo(tab.id);
      select.onkeydown=e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();const at=tabs.findIndex(t=>t.id===tab.id),next=tabs[(at+(e.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length];void switchTo(next.id);};
      const close=document.createElement('button');close.type='button';close.className='document-tab-close';close.disabled=busy;close.setAttribute('aria-label',`${tab.title} 탭 닫기`);close.title='탭 닫기';
      close.innerHTML='<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';close.onclick=()=>void closeTab(tab.id);
      item.append(select,close);list.append(item);
    }
    add.disabled=busy||!ready||tabs.length>=MAX_TABS||blocked;
  }
  function schedule(){
    clearTimeout(timer);if(disposed||!ready||busy||blocked)return;
    timer=setTimeout(()=>{void flush().catch(report);},450);
  }
  function update(){if(disposed)return;revision++;if(busy)return;capture();render();schedule();}
  async function writeSnapshot(){
    if(disposed||!ready)return;if(blocked)throw new Error('이전 탭을 읽지 못해 저장을 중지했습니다. 기존 탭 저장소는 보존됩니다.');
    capture();const current=tabs.find(t=>t.id===activeId)!;
    current.bytes=byteSize(current.document!);current.identity=identity(current.document!);
    if(tabs.length>MAX_TABS)throw new Error('이전 탭이 가득 차 있습니다. 사용하지 않는 탭을 닫으면 현재 문서의 탭 복구 저장을 계속합니다.');
    if(tabs.reduce((sum,t)=>sum+t.bytes,0)>MAX_BYTES)throw new Error('열린 문서의 복구 용량이 60MiB를 넘습니다. 다른 탭을 파일로 저장하고 닫으세요.');
    const snapshot=cloneDocument(current.document!),savedRevision=revision,tabId=current.id,removed=[...deleted];
    const state:TabState={activeId,tabs:tabs.map(({document:_document,...tab})=>({...tab}))};
    const db=database??=await openDatabase();
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['documents','state'],'readwrite');tx.objectStore('documents').put(snapshot,tabId);
      for(const id of removed)tx.objectStore('documents').delete(id);
      tx.objectStore('state').put(state,'open');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('탭 저장이 취소되었습니다.'));
    });
    removed.forEach(id=>deleted.delete(id));persistedRevision=savedRevision;
    await (window as any).go?.main?.App?.RecordOpenDocuments?.(tabs.map(t=>t.path).filter(Boolean));
    if(savedRevision===revision){status.textContent='탭 복구 저장됨';status.title='탭 복구와 원본 파일 저장은 별개입니다. Ctrl+S로 파일을 저장하세요.';}
  }
  function flush():Promise<void>{
    clearTimeout(timer);
    const operation=serial.catch(()=>{}).then(()=>writeSnapshot());serial=operation;return operation;
  }
  async function loadTab(tab:Tab):Promise<FlowDocument>{
    if(tab.document)return cloneDocument(tab.document);
    const value=await read<unknown>(database??=await openDatabase(),'documents',tab.id);
    if(!value)throw new Error('이 탭의 복구 문서를 찾을 수 없습니다. 저장한 파일을 열어 주세요.');
    return validateDocument(value);
  }
  async function switchTo(id:string):Promise<boolean>{
    if(busy||!ready||id===activeId)return id===activeId;
    const target=tabs.find(t=>t.id===id);if(!target)return false;
    busy=true;render();
    try{
      host.commitEditing?.();
      await flush();const next=await loadTab(target),previous=tabs.find(t=>t.id===activeId)!;
      const accepted=host.restoreTab?await host.restoreTab(next,target.path,target.dirty):await host.replaceDocument(next,target.path);if(accepted===false)return false;
      previous.document=undefined;activeId=id;target.document=host.getDocument();host.setDirty?.(target.dirty);dirtyFallback=!host.setDirty&&target.dirty;revision++;capture();await flush();
      return true;
    }catch(error){report(error);return false;}finally{busy=false;render();}
  }
  async function newTab(){
    if(busy||!ready||tabs.length>=MAX_TABS||blocked)return;
    busy=true;render();
    try{
      host.commitEditing?.();
      await flush();const previous=tabs.find(t=>t.id===activeId)!,next=emptyDocument();
      const accepted=host.restoreTab?await host.restoreTab(next,'',false):await host.replaceDocument(next,'');if(accepted===false)return;
      previous.document=undefined;activeId=uid();dirtyFallback=false;host.setDirty?.(false);tabs.push({id:activeId,title:next.title,path:'',dirty:false,bytes:byteSize(next),identity:identity(next),document:host.getDocument()});revision++;await flush();
    }catch(error){report(error);}finally{busy=false;render();}
  }
  async function closeTab(id:string){
    if(busy||!ready||blocked)return;const target=tabs.find(t=>t.id===id);if(!target)return;
    // Inactive tabs have already been durably checkpointed. Closing removes their
    // recovery copy, so unsaved content gets an explicit, truthful confirmation.
    if(id!==activeId&&target.dirty&&!window.confirm(`“${target.title}”에는 파일로 저장하지 않은 변경이 있습니다. 탭 복구 사본을 닫고 삭제할까요?`))return;
    busy=true;render();
    try{
      host.commitEditing?.();
      capture();
      if(id===activeId){
        if(target.dirty&&!host.getDirty?.()&&!window.confirm(`“${target.title}”의 미저장 변경을 닫고 탭 복구 사본을 삭제할까요?`))return;
        const replacement=tabs.find(t=>t.id!==id),next=replacement?await loadTab(replacement):emptyDocument();
        const accepted=await host.replaceDocument(next,replacement?.path??'');if(accepted===false)return;
        deleted.add(id);tabs=tabs.filter(t=>t.id!==id);
        if(replacement){activeId=replacement.id;replacement.document=host.getDocument();host.setDirty?.(replacement.dirty);dirtyFallback=!host.setDirty&&replacement.dirty;}
        else {activeId=uid();dirtyFallback=false;host.setDirty?.(false);tabs=[{id:activeId,title:next.title,path:'',dirty:false,bytes:byteSize(next),identity:identity(next),document:host.getDocument()}];}
      }else{deleted.add(id);tabs=tabs.filter(t=>t.id!==id);}
      revision++;await flush();
    }catch(error){report(error);}finally{busy=false;render();}
  }
  add.onclick=()=>void newTab();
  const initialization=(async()=>{
    try{
      database=await openDatabase();const saved=await read<TabState>(database,'state','open');
      if(saved){
        if(!Array.isArray(saved.tabs)||saved.tabs.length>MAX_TABS||typeof saved.activeId!=='string')throw new Error('탭 목록 형식이 올바르지 않습니다.');
        const restored=saved.tabs.map(tab=>{
          if(!tab||typeof tab.id!=='string'||typeof tab.title!=='string'||typeof tab.path!=='string'||typeof tab.identity!=='string'||!Number.isFinite(tab.bytes)||tab.bytes<0||tab.bytes>MAX_BYTES)throw new Error('보관된 탭 정보가 올바르지 않습니다.');
          return {...tab,document:undefined};
        });
        if(new Set(restored.map(t=>t.id)).size!==restored.length||restored.reduce((sum,t)=>sum+t.bytes,0)>MAX_BYTES)throw new Error('보관된 탭 목록이 허용 범위를 벗어납니다.');
        capture();const current=tabs[0],last=restored.find(t=>t.id===saved.activeId);
        const same=last&&((current.path&&last.path.toLocaleLowerCase()===current.path.toLocaleLowerCase())||last.identity===identity(host.getDocument()));
        if(same){activeId=last.id;tabs=restored.map(t=>t.id===last.id?{...current,id:last.id}:t);}
        else tabs=[current,...restored];
        if(tabs.length>MAX_TABS)status.textContent='이전 탭 하나를 닫아 복구 저장 계속';
      }
      ready=true;render();schedule();
    }catch(error){blocked=true;ready=true;render();report(error);}
  })();
  const visibility=()=>{if(document.hidden&&ready&&revision!==persistedRevision)void flush().catch(report);};
  document.addEventListener('visibilitychange',visibility);render();
  return {
    update,
    async list(){await initialization;capture();return {activeId,tabs:tabs.map(({document:_document,...t})=>({...t}))};},
    async activate(id:string){await initialization;return switchTo(id);},
    async create(){await initialization;await newTab();},
    async closeSaved(id:string){await initialization;capture();const tab=tabs.find(t=>t.id===id);if(!tab)throw new Error('탭이 없습니다.');if(tab.dirty)throw new Error('미저장 탭은 먼저 파일로 저장하세요.');await closeTab(id);},
    async openLinked(path:string,load:()=>Promise<FlowDocument>){
      await initialization;
      if(busy||blocked)throw new Error('탭 작업이 진행 중이거나 저장소를 사용할 수 없습니다.');
      host.commitEditing?.();capture();
      const key=(p:string)=>p.replace(/\//g,'\\').toLocaleLowerCase();
      const existing=tabs.find(t=>key(t.path)===key(path));
      if(existing)return switchTo(existing.id);
      if(tabs.length>=MAX_TABS)throw new Error('문서는 최대 5개 탭까지 열 수 있습니다. 사용하지 않는 탭을 닫으세요.');
      busy=true;render();
      try{
        await flush();const next=validateDocument(await load()),bytes=byteSize(next);
        if(tabs.reduce((sum,t)=>sum+t.bytes,0)+bytes>MAX_BYTES)throw new Error('문서 탭 복구 용량 60MiB를 넘습니다. 다른 탭을 저장하고 닫으세요.');
        const previous=tabs.find(t=>t.id===activeId)!;
        const accepted=host.restoreTab?await host.restoreTab(next,path,false):await host.replaceDocument(next,path);
        if(accepted===false)return false;
        previous.document=undefined;activeId=uid();dirtyFallback=false;host.setDirty?.(false);
        tabs.push({id:activeId,title:next.title,path,dirty:false,bytes,identity:identity(next),document:host.getDocument()});revision++;await flush();return true;
      }finally{busy=false;render();}
    },
    async flush(){host.commitEditing?.();await initialization;await flush();},
    destroy(){disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);void serial.finally(()=>database?.close()).catch(()=>{});container.replaceChildren();},
  };
}
