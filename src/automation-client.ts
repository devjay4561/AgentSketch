import type {FlowDocument} from './types.ts';
import {executeCommands,revisionOf,CommandError,isDocumentCommand} from './commands.ts';
import {allCapabilities,validateService} from './automation-protocol.ts';
import {renderAutomation} from './automation-render.ts';
import {readStyleDefaults,saveNodeDefaults,saveEdgeDefaults,resetStyleDefaults,applyNodeDefaults,applyEdgeDefaults} from './style-defaults.ts';
import {loadLibrary,saveLibrary,createLibraryItem,editableNodeIds} from './organization.ts';

export interface AutomationHost {
 getDocument():FlowDocument; getStamp():number; commitEdit():void;
 commit(doc:FlowDocument):void; mutate(action:()=>void):void;
 session(command:string,args:any):Promise<any>;
}
export async function executeLive(host:AutomationHost,request:any){
 if(!request||typeof request!=='object')throw new CommandError('INVALID_ARGUMENT','요청 객체 필요');
 if(request.command&&request.commands)throw new CommandError('INVALID_ARGUMENT','command와 commands는 하나만 지정하세요.');
 for(const key of Object.keys(request))if(!['target','command','commands','args','expectedRevision','dryRun','output','overwrite'].includes(key))throw new CommandError('INVALID_ARGUMENT',`알 수 없는 요청 속성: ${key}`);
 if(request.dryRun!==undefined&&typeof request.dryRun!=='boolean')throw new CommandError('INVALID_ARGUMENT','dryRun은 boolean입니다.');
 if(request.command==='capabilities')return allCapabilities(request.args?.query??'');
 host.commitEdit();const before=host.getDocument(),stamp=host.getStamp();
 const commands=request.commands??[{command:request.command,args:request.args??{}}];
 if(!Array.isArray(commands)||!commands.length||commands.some((v:any)=>!v||typeof v.command!=='string'))throw new CommandError('INVALID_ARGUMENT','명령 목록 오류');
 if(commands.every((c:any)=>isDocumentCommand(c.command))){
   const out=await executeCommands(before,commands,request);
   if(out.mutates&&!request.dryRun){if(!request.expectedRevision)throw new CommandError('REVISION_REQUIRED','먼저 document.read로 revision을 읽으세요.');if(host.getStamp()!==stamp||host.getDocument()!==before)throw new CommandError('REVISION_CONFLICT','명령 계산 중 문서가 변경되었습니다.');host.commit(out.document);}
   // commit may pan the view to the change, so report the revision of what is now on screen.
   const {document:_document,...result}=out;if(out.mutates&&!request.dryRun)result.revision=await revisionOf(host.getDocument());return result;
 }
 if(commands.length!==1)throw new CommandError('INVALID_ARGUMENT','파일·세션 서비스는 batch에 넣을 수 없습니다.');
 const {command,args={}}=commands[0],spec=validateService(command,args),revision=await revisionOf(before);
 if(request.expectedRevision&&request.expectedRevision!==revision)throw new CommandError('REVISION_CONFLICT','문서가 변경되었습니다.');
 if(spec.mutates&&!request.expectedRevision)throw new CommandError('REVISION_REQUIRED','문서 변경에는 expectedRevision이 필요합니다.');
 if(request.dryRun&&spec.effect!=='query')throw new CommandError('UNSUPPORTED','서비스 dryRun은 지원하지 않습니다. 문서 명령 batch를 사용하세요.');
 if(host.getStamp()!==stamp)throw new CommandError('REVISION_CONFLICT','문서가 변경되었습니다.');
 const api=(window as any).go?.main?.App;
 let result:any;
 switch(command){
 case 'text.fit':{const batch=await renderAutomation({command,document:before,ids:args.ids});const out=await executeCommands(before,batch,{expectedRevision:request.expectedRevision});if(host.getStamp()!==stamp)throw new CommandError('REVISION_CONFLICT','문서가 변경되었습니다.');host.commit(out.document);result=out.changes;break;}
 case 'image.import':{
  if(typeof args.data!=='string'||typeof args.name!=='string')throw new CommandError('INVALID_ARGUMENT','이미지 data와 name 필요');
  const imported=await renderAutomation({command,...args});
  const batch=[...Object.values(imported.assets).map((asset:any)=>({command:'asset.put',args:asset})),...imported.nodes.map((n:any)=>{const {id,kind,x,y,...props}=n;return {command:'node.add',args:{id,kind,x,y,props}};})];
  const out=await executeCommands(before,batch,{expectedRevision:request.expectedRevision});if(host.getStamp()!==stamp)throw new CommandError('REVISION_CONFLICT','이미지를 읽는 동안 문서가 변경되었습니다.');host.commit(out.document);result=out.results;break;
 }
 case 'document.import':{const parsed=await renderAutomation({command,...args});if(host.getStamp()!==stamp)throw new CommandError('REVISION_CONFLICT','가져오는 동안 문서가 변경되었습니다.');host.commit(parsed.document);result={warnings:parsed.warnings};break;}
 case 'document.export':result=await renderAutomation({document:before,...args});break;
 case 'document.recent':result=await api.ListRecentDocuments();break;
 case 'document.versions':result=await api.ListDocumentVersions(args.path??'');break;
 case 'document.snapshot':result=await api.SaveSnapshot(JSON.stringify(before));break;
 case 'document.version.read':result=await api.ReadDocumentVersion(args.id);break;
 case 'source.check':result=await api.CheckSource(args.source);break;
 case 'source.open':result=await api.OpenSource(args.source);break;
 case 'ocr.extract':{const node=before.nodes.find(n=>n.id===args.nodeId),asset=node?.assetId&&before.assets[node.assetId];if(!asset)throw new CommandError('NOT_FOUND','이미지 요소가 아닙니다.');result=await api.ExtractImageText(asset.data);break;}
 case 'share.start':result=await api.StartLANShare(JSON.stringify(before),args.port??0,args.allowLAN??false);break;
 case 'share.stop':result=await api.StopShare();break;
 case 'share.poll':result=await api.PollShare(args.address,args.token,args.since);break;
 case 'share.push':result=await api.PushShare(args.address,args.token,args.version,JSON.stringify(before));break;
 case 'assistant.request':if(args.consent!==true)throw new CommandError('CONSENT_REQUIRED','지정 서비스 전송 동의 필요');result=await api.RequestAssistant(args.requestId,args.endpoint,args.key,args.payload);break;
 case 'assistant.cancel':result=await api.CancelAssistant(args.requestId);break;
 case 'style.defaults.read':result=readStyleDefaults();break;
 case 'style.defaults.reset':result=resetStyleDefaults();break;
 case 'style.defaults.save':{const node=before.nodes.find(n=>n.id===args.nodeId),edge=before.edges.find(e=>e.id===args.edgeId);if(!node&&!edge)throw new CommandError('NOT_FOUND','요소 또는 연결선 필요');result=node?saveNodeDefaults(node):saveEdgeDefaults(edge!);break;}
 case 'style.defaults.apply':{const allowed=editableNodeIds(before);for(const id of args.ids??[])if(!allowed.has(id))throw new CommandError('LOCKED','잠금·숨김 요소');const edge=before.edges.find(e=>e.id===args.edgeId);if(edge&&(!allowed.has(edge.from)||!allowed.has(edge.to)))throw new CommandError('LOCKED','잠금·숨김 연결');host.mutate(()=>{for(const n of before.nodes)if(args.ids?.includes(n.id))applyNodeDefaults(n);if(edge)applyEdgeDefaults(edge);});result=true;break;}
 case 'library.list':result=loadLibrary();break;
 case 'library.save':{const items=loadLibrary(),item=createLibraryItem(before,args.ids,args.name);saveLibrary([...items,item]);result={id:item.id};break;}
 case 'library.delete':saveLibrary(loadLibrary().filter(i=>i.id!==args.id));result=true;break;
 default:result=await host.session(command,args);
 }
 return {result:result??null,revision:await revisionOf(host.getDocument())};
}
export function installAutomation(host:AutomationHost){
 const runtime=(window as any).runtime,api=(window as any).go?.main?.App;if(!runtime||!api)return;
 const indicator=()=>document.querySelector<HTMLElement>('[data-action="automation"]'),follow=()=>document.querySelector<HTMLElement>('[data-action="ai-follow"]');
 let idle:ReturnType<typeof setTimeout>|undefined;
 const working=(busy:boolean)=>{const button=indicator();if(!button)return;clearTimeout(idle);if(busy){button.textContent='AI 편집 중… ✕';button.classList.add('ai-working');}else idle=setTimeout(()=>{button.textContent='외부 제어 중 ✕';button.classList.remove('ai-working');},1200);};
 runtime.EventsOn('agentsketch:automation',async(id:string,payload:string)=>{let reply;working(true);try{reply={ok:true,result:await executeLive(host,JSON.parse(payload))};}catch(error){reply={ok:false,error:{code:error instanceof CommandError?error.code:'OPERATION_FAILED',message:String(error)}};}finally{working(false);}try{await api.AutomationReply(id,JSON.stringify(reply));}catch{/* Client timeout or shutdown does not modify the document again. */}});
 runtime.EventsOn('agentsketch:automation-state',(enabled:boolean)=>{for(const button of [indicator(),follow()])if(button)button.hidden=!enabled;});
}
