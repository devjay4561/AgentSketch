import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {executeCommands,revisionOf,CommandError} from '../src/commands.ts';
import {allCapabilities,validateService} from '../src/automation-protocol.ts';
import {emptyDocument,validateDocument} from '../src/model.ts';
export const home=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MAX=80*1024*1024;
const hash=data=>createHash('sha256').update(data).digest('hex');
const failure=(code,message)=>{throw new CommandError(code,message);};
export async function boundedRead(file){const stat=await fs.stat(file);if(!stat.isFile()||stat.size>MAX)failure('LIMIT','파일은 최대80MiB입니다.');const bytes=await fs.readFile(file);if(bytes.length>MAX)failure('LIMIT','파일 크기가 변경되었습니다.');return bytes;}
export async function resolvePath(file,root=process.cwd()){
 if(typeof file!=='string'||!file||file.includes('\0'))failure('INVALID_ARGUMENT','파일 경로 필요');
 const base=await fs.realpath(path.resolve(root)),target=path.resolve(base,file),relative=path.relative(base,target);
 if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))failure('OUTSIDE_ROOT','설정한 --root 밖의 경로입니다.');
 let resolved;try{resolved=await fs.realpath(target);}catch(e){if(e.code!=='ENOENT')throw e;let parent=path.dirname(target);while(true){try{const actual=await fs.realpath(parent);resolved=path.join(actual,path.relative(parent,target));break;}catch(error){if(error.code!=='ENOENT'||parent===path.dirname(parent))throw error;parent=path.dirname(parent);}}}
 const realRelative=path.relative(base,resolved);if(realRelative==='..'||realRelative.startsWith('..'+path.sep)||path.isAbsolute(realRelative))failure('OUTSIDE_ROOT','심볼릭 링크가 root 밖을 가리킵니다.');return target;
}
export function profileDirectory(){
 const base=process.platform==='win32'?process.env.APPDATA??path.join(os.homedir(),'AppData','Roaming')
  :process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support')
  :process.env.XDG_CONFIG_HOME??path.join(os.homedir(),'.config');
 return path.join(base,'AgentSketch');
}
const profile=profileDirectory;
const normalizedPath=value=>process.platform==='win32'?value.toLowerCase():value;
async function canonicalPath(file){try{return await fs.realpath(path.resolve(file));}catch{return path.resolve(file);}}
async function samePath(left,right){const [a,b]=await Promise.all([canonicalPath(left),canonicalPath(right)]);return normalizedPath(a)===normalizedPath(b);}
async function pathHistoryKey(file){return hash(normalizedPath(await canonicalPath(file))).slice(0,24);}
export async function live(request){
 let info;try{info=JSON.parse(await fs.readFile(path.join(profile(),'automation.json'),'utf8'));}catch{failure('NOT_CONNECTED','connect 명령으로 앱에 연결하세요.');}
 const url=new URL(info.url);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:'||!/^\w{64}$/.test(info.token))failure('INVALID_CONNECTION','로컬 연결 정보가 올바르지 않습니다.');
 const response=await fetch(url.href+'execute',{method:'POST',headers:{'Authorization':'Bearer '+info.token,'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(95000)});
 if(!response.ok)failure('LIVE_ERROR',`${response.status}: ${await response.text()}`);const out=await response.json();if(!out.ok)failure(out.error?.code??'LIVE_ERROR',out.error?.message??'앱 명령 실패');return out.result;
}
export async function connect(executable){
 let file=executable;
 if(!file&&process.platform==='win32')file=path.join(home,path.basename(home)==='AI'?'../AgentSketch.exe':'AgentSketch.exe');
 if(!file&&process.platform==='darwin'){
  const candidates=path.basename(home)==='AI'?[path.resolve(home,'../../MacOS/AgentSketch')]:[path.join(home,'build/bin/AgentSketch.app/Contents/MacOS/AgentSketch'),path.join(home,'build/bin/AgentSketch')];
  for(const candidate of candidates){try{await fs.access(candidate);file=candidate;break;}catch{}}
 }
 if(!file)failure('INVALID_ARGUMENT',process.platform==='darwin'?'AgentSketch.app 실행 파일을 찾을 수 없습니다. --exe로 지정하세요.':'AgentSketch 실행 파일 경로가 필요합니다.');
 if(process.platform==='darwin'&&file.toLowerCase().endsWith('.app'))file=path.join(file,'Contents/MacOS/AgentSketch');
 const expected=process.platform==='win32'?'agentsketch.exe':'AgentSketch';
 if(path.basename(file).toLowerCase()!==expected.toLowerCase())failure('INVALID_ARGUMENT',`${expected} 경로가 필요합니다.`);
 await fs.access(file);
 const child=spawn(file,['--automation'],{detached:true,stdio:'ignore',windowsHide:process.platform==='win32'});
 await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});
 child.unref();
 for(let i=0;i<80;i++){try{return await live({command:'session.read'});}catch{await new Promise(r=>setTimeout(r,150));}}
 failure('NOT_CONNECTED','앱 연결 시간이 초과되었습니다. 최신 AgentSketch.exe인지 확인하세요.');
}
async function guardOpenFile(file){
 let state;try{state=JSON.parse(await fs.readFile(path.join(profile(),'open-documents.json'),'utf8'));}catch{return;}
 if(!Number.isInteger(state.pid)||!Array.isArray(state.paths))return;
 try{process.kill(state.pid,0);}catch(error){if(error.code==='ESRCH')return;}
 for(const openPath of state.paths)if(typeof openPath==='string'&&await samePath(openPath,file))failure('DOCUMENT_OPEN','이 파일은 앱에서 열려 있습니다. --live와 expectedRevision을 사용하세요.');
}
export async function atomicOutput(file,data,{replace=false,expectedHash}={}){
 await fs.mkdir(path.dirname(file),{recursive:true});const lock=file+'.agentsketch-lock',temp=file+'.'+randomUUID()+'.tmp';let handle;
 try{
  try{handle=await fs.open(lock,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid}));}catch(e){if(e.code==='EEXIST')failure('FILE_LOCKED','다른 작업이 파일을 쓰는 중입니다. 이전 CLI 비정상 종료라면 해당 프로세스 종료 확인 후 .agentsketch-lock 파일을 제거하세요.');throw e;}
  let current;try{current=await boundedRead(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(current&&!replace)failure('FILE_EXISTS','출력 파일이 이미 있습니다. overwrite:true를 명시하세요.');
  if(expectedHash!==undefined&&(!current||hash(current)!==expectedHash))failure('REVISION_CONFLICT','읽은 뒤 디스크 파일이 바뀌었습니다.');
  let backup;if(current){const history=path.join(profile(),'cli-history',await pathHistoryKey(file));await fs.mkdir(history,{recursive:true});backup=path.join(history,Date.now()+'-'+randomUUID()+'.agentsketch');await fs.writeFile(backup,current,{flag:'wx'});const list=(await fs.readdir(history)).filter(n=>n.endsWith('.agentsketch')).sort();for(const old of list.slice(0,-12))await fs.unlink(path.join(history,old));}
  await fs.writeFile(temp,data,{flag:'wx'});const sync=await fs.open(temp,'r+');await sync.sync();await sync.close();
  // Recheck immediately before replacement as other applications do not honor our lock.
  if(current){const now=await boundedRead(file);if(hash(now)!==hash(current))failure('REVISION_CONFLICT','저장 도중 원본 파일이 바뀌었습니다.');}
  else {try{await fs.access(file);failure('FILE_EXISTS','저장 도중 출력 파일이 생성되었습니다.');}catch(e){if(e.code!=='ENOENT')throw e;}}
  await fs.rename(temp,file);return {path:file,bytes:Buffer.byteLength(data),backup};
 }finally{await fs.unlink(temp).catch(()=>{});if(handle){await handle.close();await fs.unlink(lock).catch(()=>{});}}
}
export async function render(request){
 const dist=path.join(home,'dist');await fs.access(path.join(dist,'render.html'));
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml'};
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1'),name=decodeURIComponent(url.pathname).replace(/^\//,'');const file=await resolvePath(name||'render.html',dist);const bytes=await boundedRead(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  const {chromium}=await import('playwright-core');
  const channels=process.platform==='win32'?['msedge']:['chrome','msedge'];
  let launchError;
  for(const channel of channels){try{browser=await chromium.launch({channel,headless:true,args:process.platform==='win32'?['--disable-features=AutofillAiWalletPrivatePasses']:[]});break;}catch(error){launchError=error;}}
  if(!browser)failure('BROWSER_UNAVAILABLE',process.platform==='darwin'?'미리보기에는 설치된 Google Chrome 또는 Microsoft Edge가 필요합니다.':`미리보기 브라우저를 실행할 수 없습니다: ${launchError}`);
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/render.html`);await page.waitForFunction(()=>typeof window.AgentSketchRender==='function');return await page.evaluate(r=>window.AgentSketchRender(r),request);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
export async function execute(request,{root=process.cwd()}={}){
 if(!request||typeof request!=='object')failure('INVALID_ARGUMENT','요청 객체 필요');
 for(const key of Object.keys(request))if(!['target','command','commands','args','expectedRevision','dryRun','output','overwrite'].includes(key))failure('INVALID_ARGUMENT',`알 수 없는 요청 속성: ${key}`);
 if(request.command&&request.commands)failure('INVALID_ARGUMENT','command와 commands는 하나만 지정하세요.');
 if(request.target?.live&&request.target?.file)failure('INVALID_ARGUMENT','target.live와 target.file은 하나만 지정하세요.');
 if(request.dryRun!==undefined&&typeof request.dryRun!=='boolean')failure('INVALID_ARGUMENT','dryRun은 boolean입니다.');
 if(request.command==='capabilities')return allCapabilities(request.args?.query??'');
 if(request.target?.live){
  const args={...request.args};for(const key of ['path'])if(args[key])args[key]=await resolvePath(args[key],root);
  if(['source.check','source.open'].includes(request.command)&&typeof args.source==='string'&&!/^https?:\/\//i.test(args.source))args.source=await resolvePath(args.source,root);
  if(request.command==='image.import'&&args.path){args.data=(await boundedRead(args.path)).toString('base64');args.name=path.basename(args.path);delete args.path;}
  if(request.command==='document.import'&&args.path){args.text=(await boundedRead(args.path)).toString('utf8');delete args.path;}
  const out=await live({...request,args});
  if(request.command==='document.export'&&request.output){const file=await resolvePath(request.output,root),rendered=out.result;await guardOpenFile(file);const saved=await atomicOutput(file,rendered.encoding==='base64'?Buffer.from(rendered.data,'base64'):rendered.data,{replace:request.overwrite===true});return {...saved,warnings:rendered.warnings,revision:out.revision};}return out;
 }
 const target=request.target?.file;if(!target)failure('INVALID_ARGUMENT','target.file 또는 target.live 필요');
 let warnings=[];
 const file=await resolvePath(target,root);let bytes,doc;
 try{bytes=await boundedRead(file);doc=validateDocument(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));}catch(e){if(e.code!=='ENOENT'||!['document.new','document.import'].includes(request.command)&&request.commands?.[0]?.command!=='document.new')throw e;doc=emptyDocument();}
 const revision=await revisionOf(doc);
 if(request.expectedRevision&&request.expectedRevision!==revision)failure('REVISION_CONFLICT','문서가 변경되었습니다.');
 if(request.command==='document.export'){
  validateService(request.command,request.args??{});
  if(request.dryRun)failure('UNSUPPORTED','내보내기는 dryRun 대신 document.diagnose로 검사하세요.');
  if(!request.output)failure('INVALID_ARGUMENT','출력 경로 output 필요');const destination=await resolvePath(request.output,root);await guardOpenFile(destination);const result=await render({document:doc,...request.args});const saved=await atomicOutput(destination,result.encoding==='base64'?Buffer.from(result.data,'base64'):result.data,{replace:request.overwrite===true});return {...saved,warnings:result.warnings,revision};
 }
 if(request.command==='document.import'){
  validateService(request.command,request.args??{});
  const text=request.args.path?(await boundedRead(await resolvePath(request.args.path,root))).toString('utf8'):request.args.text;if(typeof text!=='string')failure('INVALID_ARGUMENT','path 또는 text 필요');const parsed=await render({command:'document.import',format:request.args.format,text});warnings=parsed.warnings??[];request={...request,command:'document.replace',args:{document:parsed.document}};
 }
 if(request.command==='image.import'){
  validateService(request.command,request.args??{});const a=request.args;
  const data=a.path?(await boundedRead(await resolvePath(a.path,root))).toString('base64'):a.data;const name=a.path?path.basename(a.path):a.name;if(typeof data!=='string'||typeof name!=='string')failure('INVALID_ARGUMENT','이미지 path 또는 data/name 필요');const imported=await render({command:'image.import',data,name,mime:a.mime,at:a.at});request={...request,commands:[...Object.values(imported.assets).map(a=>({command:'asset.put',args:a})),...imported.nodes.map(n=>{const {id,kind,x,y,...props}=n;return {command:'node.add',args:{id,kind,x,y,props}};})]};
 }
 if(request.command==='text.fit'){validateService(request.command,request.args??{});request={...request,commands:await render({command:'text.fit',document:doc,ids:request.args.ids})};}
 const commands=request.commands??[{command:request.command,args:request.args??{}}];
 const out=await executeCommands(doc,commands,request);const {document:next,...result}=out;
 if(!out.mutates||request.dryRun)return {...result,warnings};
 const destination=await resolvePath(request.output??target,root);if(path.extname(destination).toLowerCase()!=='.agentsketch')failure('INVALID_ARGUMENT','문서는 .agentsketch로 저장하세요.');
 await guardOpenFile(destination);
 const saved=await atomicOutput(destination,JSON.stringify(next,null,2),{replace:destination===file||request.overwrite===true,...(destination===file&&bytes?{expectedHash:hash(bytes)}:{})});return {...result,...saved,warnings};
}
