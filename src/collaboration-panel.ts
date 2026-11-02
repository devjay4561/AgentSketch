import './collaboration.css';
import type { WorkbenchHost } from './workspace-types.ts';
import type { FlowDocument } from './types.ts';
import { validateDocument } from './model.ts';

type ShareState={version:number;document?:string};
type ShareInfo={url:string;token:string;version:number;lan:boolean;addresses:string[]};
type ShareAPI={StartLANShare(document:string,port:number,lan:boolean):Promise<ShareInfo>;StopShare():Promise<void>;PollShare(address:string,token:string,since:number):Promise<ShareState>;PushShare(address:string,token:string,version:number,document:string):Promise<ShareState>};
const native=()=> (window as unknown as {go?:{main?:{App?:ShareAPI}}}).go?.main?.App;
// View position and active page belong to each editor, not the shared board.
function payload(doc:FlowDocument){return JSON.stringify({...doc,viewport:{x:80,y:80,zoom:1},workspace:doc.workspace?{...doc.workspace,activePageId:undefined}:undefined});}

export function mountCollaborationPanel(host:WorkbenchHost,container:HTMLElement){
 container.classList.add('collab-panel');
 container.innerHTML=`
 <section class="collab-section"><h3>이 PC에서 공유 시작</h3><p>공유에는 현재 보드의 이미지와 자료 출처도 포함됩니다. 최대 20MB입니다.</p><div class="collab-row"><label>포트<input data-share="port" type="number" min="0" max="65535" value="0"><small>0: 사용 가능한 포트 자동 선택</small></label><label class="collab-check"><input data-share="lan" type="checkbox">다른 PC 접속 허용</label></div><p class="collab-note">다른 PC 접속을 허용하면 사설망 HTTP로 전달됩니다. 신뢰할 수 있는 네트워크에서만 사용하세요. 공유 키를 가진 사람은 읽기·편집할 수 있습니다.</p><button data-share="start" class="primary-button">현재 보드 공유 시작</button></section>
 <section class="collab-section"><h3>공유된 보드에 연결</h3><label>공유 주소<input data-share="address" type="url" placeholder="http://192.168.0.10:18450" autocomplete="off" spellcheck="false"></label><label>공유 키<input data-share="token" type="password" autocomplete="off" spellcheck="false" placeholder="공유한 사람이 전달한 키"></label><div class="collab-row"><button data-share="join" class="secondary-button">연결 및 최신 보드 확인</button><button data-share="copy" class="secondary-button" hidden>초대 정보 복사</button></div><output data-share="addresses" class="collab-addresses"></output></section>
 <section class="collab-section"><h3>동기화</h3><p data-share="status" role="status" aria-live="polite">연결하지 않았습니다. 기본 상태에서는 네트워크나 동기화 작업을 실행하지 않습니다.</p><div class="collab-row"><button data-share="sync" class="primary-button" disabled>변경 동기화</button><button data-share="stop" class="secondary-button" disabled>연결 종료</button></div><label class="collab-check"><input data-share="live" type="checkbox" disabled>연결 중 3초마다 자동 동기화</label><div data-share="conflict" class="collab-conflict" hidden><strong>최신 보드가 대기 중입니다</strong><p>적용하면 현재 보드를 바꿉니다. 먼저 파일로 저장하거나 작업 보관함에서 스냅샷을 남기세요. 적용 후 Ctrl+Z로 되돌릴 수 있습니다.</p><button data-share="apply" class="secondary-button">최신 보드 적용</button></div></section>`;
 const el=<T extends HTMLElement=HTMLElement>(id:string)=>container.querySelector<T>(`[data-share="${id}"]`)!;
 const input=(id:string)=>el<HTMLInputElement>(id);
 let connected=false,owner=false,busy=false,disposed=false,version=0,lastSynced='',pending:FlowDocument|null=null,pendingVersion=0, timer:ReturnType<typeof setTimeout>|undefined;
 let endpoint='',secret='',documentRef:FlowDocument|null=null;
 const status=(message:string,error=false)=>{el('status').textContent=message;el('status').classList.toggle('collab-error',error);};
 const controls=()=>{el<HTMLButtonElement>('sync').disabled=!connected||busy||!!pending;el<HTMLButtonElement>('stop').disabled=!connected||busy;el<HTMLButtonElement>('start').disabled=connected||busy||!native();el<HTMLButtonElement>('join').disabled=connected||busy||!native();input('live').disabled=!connected||!!pending;input('address').disabled=connected;input('token').disabled=connected;el('conflict').hidden=!pending;};
 function stopTimer(){clearTimeout(timer);timer=undefined;}
 function schedule(){stopTimer();if(connected&&input('live').checked&&!pending&&!disposed)timer=setTimeout(()=>void synchronize(),3000);}
 async function action(fn:()=>Promise<void>){if(busy)return;busy=true;controls();try{await fn();}catch(error){input('live').checked=false;stopTimer();status(String(error),true);host.toast(String(error),true);}finally{busy=false;if(!disposed){controls();schedule();}}}
 const loadPending=(state:ShareState)=>{if(!state.document)return;pending=validateDocument(JSON.parse(state.document));pendingVersion=state.version;input('live').checked=false;stopTimer();status(`공유 버전 ${state.version}을 확인했습니다. 아래에서 적용 여부를 선택하세요.`);};
 async function synchronize(){await action(async()=>{
  const api=native();if(!api||!connected)return;
  if(host.getDocument()!==documentRef){await disconnect();status('문서가 변경되어 공유 연결을 종료했습니다. 새 보드는 자동으로 공유하지 않습니다.');return;}
  const local=payload(host.getDocument()),state=await api.PollShare(endpoint,secret,version);
  if(disposed||!connected)return;
  if(host.getDocument()!==documentRef){await disconnect();status('문서가 변경되어 공유 연결을 종료했습니다.');return;}
  if(state.document){
   if(local!==lastSynced||payload(host.getDocument())!==local){loadPending(state);status('내 변경과 다른 사용자의 변경이 겹칩니다. 내 작업을 저장한 뒤 최신 보드를 적용하세요.',true);return;}
   const remote=validateDocument(JSON.parse(state.document));applyRemote(remote);version=state.version;lastSynced=payload(host.getDocument());status(`버전 ${version} · 최신 변경을 받았습니다.`);return;
  }
  if(local!==lastSynced){const result=await api.PushShare(endpoint,secret,version,local);version=result.version;lastSynced=local;status(`버전 ${version} · 내 변경을 공유했습니다.`);}else status(`버전 ${version} · 모든 변경이 반영되었습니다.`);
 });}
 function applyRemote(remote:FlowDocument){
  const current=host.getDocument(),viewport=current.viewport,activePageId=current.workspace?.activePageId;
  host.mutate(()=>{Object.assign(current,remote);current.workspace=remote.workspace;current.viewport=viewport;if(current.workspace&&activePageId&&current.workspace.pages?.some(p=>p.id===activePageId))current.workspace.activePageId=activePageId;host.select([]);},'공유 보드의 변경을 반영했습니다. Ctrl+Z로 되돌릴 수 있습니다.');
 }
 el('start').addEventListener('click',()=>void action(async()=>{
  const api=native();if(!api)throw new Error('공유 기능은 Windows 실행 파일에서 사용할 수 있습니다.');
  documentRef=host.getDocument();
  const content=payload(documentRef),info=await api.StartLANShare(content,Number(input('port').value),input('lan').checked);
  if(disposed||host.getDocument()!==documentRef){await api.StopShare();status('문서가 변경되어 공유를 취소했습니다.');return;}
  owner=true;connected=true;version=info.version;lastSynced=content;endpoint=info.url;secret=info.token;
  input('address').value=info.addresses.find(a=>!a.includes('127.0.0.1'))??info.url;input('token').value=info.token;el('addresses').textContent=info.addresses.join('\n');el('copy').hidden=false;
  status(`버전 ${version} · 공유 중입니다. ${info.lan?'주소와 공유 키를 전달하세요.':'이 PC에서만 접속할 수 있습니다.'}`);
 }));
 el('join').addEventListener('click',()=>void action(async()=>{
  const api=native();if(!api)throw new Error('공유 기능은 Windows 실행 파일에서 사용할 수 있습니다.');
  documentRef=host.getDocument();endpoint=input('address').value.trim();secret=input('token').value.trim();
  const state=await api.PollShare(endpoint,secret,0);if(disposed||host.getDocument()!==documentRef)return;if(!state.document)throw new Error('공유 보드를 받지 못했습니다.');
  // Explicit confirmation before replacing an unrelated current document.
  loadPending(state);connected=true;owner=false;version=0;lastSynced=payload(host.getDocument());
 }));
 el('sync').addEventListener('click',()=>void synchronize());
 el('apply').addEventListener('click',()=>{if(!pending)return;applyRemote(pending);version=pendingVersion;lastSynced=payload(host.getDocument());pending=null;controls();status(`버전 ${version} · 최신 보드를 적용했습니다.`);});
 async function disconnect(){stopTimer();input('live').checked=false;if(owner)await native()?.StopShare();connected=false;owner=false;pending=null;documentRef=null;version=0;secret='';lastSynced='';endpoint='';input('token').value='';el('copy').hidden=true;el('addresses').textContent='';controls();status('연결을 종료했습니다. 현재 보드는 이 PC에 남아 있습니다.');}
 el('stop').addEventListener('click',()=>void action(disconnect));
 input('live').addEventListener('change',schedule);
 el('copy').addEventListener('click',()=>{void navigator.clipboard.writeText(`AgentSketch 공유 주소: ${input('address').value}\n공유 키: ${secret}`).then(()=>host.toast('초대 정보를 복사했습니다. 공유 키를 안전하게 전달하세요.')).catch(()=>host.toast('클립보드에 복사하지 못했습니다. 주소와 공유 키를 직접 복사하세요.',true));});
 if(!native())status('Windows 실행 파일에서 사용할 수 있습니다. 브라우저 미리보기에서는 공유 서버를 실행하지 않습니다.');controls();
 return {update(){if(!disposed){controls();if(connected&&!busy&&host.getDocument()!==documentRef)void action(async()=>{await disconnect();status('문서가 변경되어 공유 연결을 종료했습니다. 새 보드는 자동으로 공유하지 않습니다.');});}},dispose(){disposed=true;stopTimer();if(owner)void native()?.StopShare();connected=false;secret='';lastSynced='';pending=null;container.replaceChildren();}};
}
