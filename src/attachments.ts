import type { FlowDocument, FlowNode } from './types.ts';
import type { WorkspaceAttachment } from './workspace-types.ts';

export const ATTACHMENT_LIMITS={single:5*1024*1024,total:20*1024*1024,count:100,node:100} as const;
export const ATTACHMENT_TYPES:Readonly<Record<string,string>>={pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',txt:'text/plain',csv:'text/csv',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'};
export interface SourceRelink {nodeId:string;oldSource:string;newSource:string}
function extension(name:string):string{return name.slice(name.lastIndexOf('.')+1).toLowerCase();}
function bytesToBase64(bytes:Uint8Array):string{
  const chunks:string[]=[];for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
  return btoa(chunks.join(''));
}
function fromBase64(data:string):Uint8Array{const binary=atob(data),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}
function starts(bytes:Uint8Array,values:number[]):boolean{return values.every((v,i)=>bytes[i]===v);}
function asciiAt(bytes:Uint8Array,text:string,at=0):boolean{return [...text].every((c,i)=>bytes[at+i]===c.charCodeAt(0));}
function includesAscii(bytes:Uint8Array,text:string):boolean{
  const first=text.charCodeAt(0);for(let i=0;i<=bytes.length-text.length;i++)if(bytes[i]===first&&asciiAt(bytes,text,i))return true;return false;
}
function checkContent(bytes:Uint8Array,ext:string):void {
  let valid=false;
  if(ext==='pdf')valid=asciiAt(bytes,'%PDF-');
  else if(ext==='png')valid=starts(bytes,[137,80,78,71,13,10,26,10]);
  else if(ext==='jpg'||ext==='jpeg')valid=starts(bytes,[255,216,255]);
  else if(ext==='gif')valid=asciiAt(bytes,'GIF87a')||asciiAt(bytes,'GIF89a');
  else if(ext==='webp')valid=asciiAt(bytes,'RIFF')&&asciiAt(bytes,'WEBP',8);
  else if(['xlsx','docx','pptx'].includes(ext)){
    const entry=ext==='xlsx'?'xl/workbook.xml':ext==='docx'?'word/document.xml':'ppt/presentation.xml';
    valid=starts(bytes,[80,75,3,4])&&includesAscii(bytes,'[Content_Types].xml')&&includesAscii(bytes,entry)&&!includesAscii(bytes,'vbaProject.bin');
  }else if(ext==='txt'||ext==='csv'){
    try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);valid=!bytes.includes(0);}catch{valid=false;}
  }
  if(!valid)throw new Error('파일 내용과 확장자가 일치하지 않거나 지원하지 않는 인코딩입니다. 텍스트는 UTF-8로 저장하세요.');
}

/** Validates portable bytes, never executes or opens an attachment. */
export function validateAttachment(value:unknown):WorkspaceAttachment{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('첨부 파일 정보가 올바르지 않습니다.');
  const raw=value as Record<string,unknown>;
  if(typeof raw.id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(raw.id)||['__proto__','prototype','constructor'].includes(raw.id))throw new Error('첨부 파일 식별자가 올바르지 않습니다.');
  if(typeof raw.name!=='string'||!raw.name.length||raw.name.length>240||/[\\/:\x00-\x1f]/.test(raw.name))throw new Error('첨부 파일 이름이 올바르지 않습니다.');
  const ext=extension(raw.name),mime=ATTACHMENT_TYPES[ext];if(!mime||raw.mime!==mime)throw new Error('허용되지 않는 첨부 파일 형식입니다.');
  if(typeof raw.size!=='number'||!Number.isInteger(raw.size)||raw.size<0||raw.size>ATTACHMENT_LIMITS.single)throw new Error('첨부 파일 하나는 5MiB까지 사용할 수 있습니다.');
  if(typeof raw.data!=='string'||raw.data.length%4!==0||raw.data.length>Math.ceil(ATTACHMENT_LIMITS.single/3)*4||! /^[A-Za-z0-9+/]*={0,2}$/.test(raw.data))throw new Error('첨부 파일 데이터가 올바르지 않습니다.');
  const decodedSize=raw.data.length/4*3-(raw.data.endsWith('==')?2:raw.data.endsWith('=')?1:0);
  if(decodedSize!==raw.size)throw new Error('첨부 파일의 크기가 일치하지 않습니다.');
  checkContent(fromBase64(raw.data),ext);
  return {id:raw.id,name:raw.name,mime,size:raw.size,data:raw.data};
}
export function validateAttachments(value:unknown):WorkspaceAttachment[]{
  if(!Array.isArray(value)||value.length>ATTACHMENT_LIMITS.count)throw new Error('첨부 파일은 100개까지 사용할 수 있습니다.');
  let total=0;const ids=new Set<string>();return value.map(raw=>{
    const file=validateAttachment(raw);total+=file.size;if(total>ATTACHMENT_LIMITS.total)throw new Error('첨부 파일 전체는 20MiB까지 사용할 수 있습니다.');
    if(ids.has(file.id))throw new Error('중복된 첨부 파일 식별자가 있습니다.');ids.add(file.id);return file;
  });
}
export async function prepareAttachment(file:File):Promise<WorkspaceAttachment>{
  if(file.size>ATTACHMENT_LIMITS.single)throw new Error('첨부 파일 하나는 5MiB까지 사용할 수 있습니다.');
  const mime=ATTACHMENT_TYPES[extension(file.name)];if(!mime)throw new Error('PDF, XLSX, DOCX, PPTX, UTF-8 TXT/CSV와 일반 이미지 파일을 첨부할 수 있습니다.');
  const bytes=new Uint8Array(await file.arrayBuffer());checkContent(bytes,extension(file.name));
  return validateAttachment({id:globalThis.crypto.randomUUID(),name:file.name,mime,size:bytes.length,data:bytesToBase64(bytes)});
}
function locked(doc:FlowDocument,node:FlowNode):boolean{return node.locked||Boolean(doc.workspace?.layers?.find(l=>l.id===(node.details?.layerId??'layer-main'))?.locked);}
export function addAttachment(doc:FlowDocument,nodeId:string,input:WorkspaceAttachment):string{
  const node=doc.nodes.find(n=>n.id===nodeId);if(!node)throw new Error('첨부할 요소가 없습니다.');if(locked(doc,node))throw new Error('잠긴 요소에는 첨부할 수 없습니다.');
  const file=validateAttachment(input),files=doc.workspace?.attachments??[];
  const duplicate=files.find(a=>a.mime===file.mime&&a.size===file.size&&a.data===file.data),actual=duplicate??file;
  const refs=node.details?.attachmentIds??[];if(refs.includes(actual.id))return actual.id;
  if(refs.length>=ATTACHMENT_LIMITS.node)throw new Error('요소에 첨부할 수 있는 파일 개수를 넘었습니다.');
  if(!duplicate&&(files.length>=ATTACHMENT_LIMITS.count||files.reduce((n,a)=>n+a.size,0)+file.size>ATTACHMENT_LIMITS.total))throw new Error('첨부 파일은 전체 100개, 20MiB까지 사용할 수 있습니다.');
  if(!duplicate&&files.some(a=>a.id===file.id))throw new Error('첨부 파일 식별자가 충돌합니다.');
  doc.workspace??={};if(!duplicate)doc.workspace.attachments=[...files,file];
  node.details={...node.details,attachmentIds:[...refs,actual.id],...(node.details?.status==='verified'?{status:'stale'}:{})};return actual.id;
}
export function removeAttachment(doc:FlowDocument,id:string):void{
  if(doc.nodes.some(n=>n.details?.attachmentIds?.includes(id)&&locked(doc,n)))throw new Error('잠긴 요소가 참조하는 첨부 파일은 제거할 수 없습니다.');
  if(doc.workspace?.attachments)doc.workspace.attachments=doc.workspace.attachments.filter(a=>a.id!==id);
  for(const node of doc.nodes)if(node.details?.attachmentIds?.includes(id))node.details={...node.details,attachmentIds:node.details.attachmentIds.filter(a=>a!==id),...(node.details.status==='verified'?{status:'stale'}:{})};
}
export function attachmentBlob(file:WorkspaceAttachment):Blob{return new Blob([fromBase64(file.data).buffer as ArrayBuffer],{type:file.mime});}

function pathPrefix(source:string,prefix:string):number{
  const windows=/^[a-z]:[\\/]|^\\\\/i.test(source)||source.includes('\\');
  const normalize=(s:string)=>windows?s.replace(/\//g,'\\').toLowerCase():s;
  const a=normalize(source),b=normalize(prefix).replace(/[\\/]$/,'');
  if(a===b||a.startsWith(b+'\\')||a.startsWith(b+'/'))return b.length;return -1;
}
/** Preview only. Existing file contents and the filesystem are never touched. */
export function previewSourceRelink(doc:FlowDocument,fromPrefix:string,toPrefix:string):SourceRelink[]{
  if(!fromPrefix.trim()||!toPrefix.trim()||fromPrefix.length>4000||toPrefix.length>4000||/[\x00-\x1f]/.test(fromPrefix+toPrefix))throw new Error('변경 전후 경로를 입력하세요.');
  const from=fromPrefix.trim(),to=toPrefix.trim().replace(/[\\/]$/,'');
  const changes:SourceRelink[]=[];
  for(const node of doc.nodes){
    const source=node.details?.source;if(!source||locked(doc,node))continue;
    const cut=pathPrefix(source,from);if(cut<0)continue;
    const newSource=to+source.slice(cut);if(newSource.length>8000)throw new Error('변경할 원본 경로가 너무 깁니다.');
    if(newSource!==source)changes.push({nodeId:node.id,oldSource:source,newSource});
  }return changes;
}
export function applySourceRelink(doc:FlowDocument,changes:readonly SourceRelink[]):number{
  if(changes.length>10000)throw new Error('변경 경로 개수가 너무 많습니다.');
  const nodes=new Map(doc.nodes.map(n=>[n.id,n])),planned:{node:FlowNode;source:string}[]=[],seen=new Set<string>();
  for(const change of changes){
    const node=nodes.get(change.nodeId);if(!node||locked(doc,node)||node.details?.source!==change.oldSource||seen.has(node.id))continue;
    if(typeof change.newSource!=='string'||change.newSource.length>8000||/[\x00-\x1f]/.test(change.newSource))throw new Error('변경할 경로가 올바르지 않습니다.');
    planned.push({node,source:change.newSource});seen.add(node.id);
  }
  for(const {node,source} of planned){node.details={...node.details,source,...(node.details!.status==='verified'?{status:'stale'}:{})};delete node.details.sourceFingerprint;}
  return planned.length;
}
