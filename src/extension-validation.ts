import type { FlowEdge, FlowNode, Point } from './types.ts';
import type { NodeDetails, WorkspaceData } from './workspace-types.ts';
import {normalizeNodeTable,normalizeTextRuns} from './rich-text.ts';
import {validateAttachments} from './attachments.ts';

type RecordValue = Record<string, unknown>;
function record(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return value as RecordValue;
}
function text(value: unknown, label: string, max=1000): string {
  if(typeof value!=='string'||value.length>max)throw new Error(`${label} 문자열이 올바르지 않거나 너무 깁니다.`);
  return value;
}
function id(value: unknown): string {
  const result=text(value,'식별자',128);
  if(!/^[a-zA-Z0-9_-]+$/.test(result)||['__proto__','prototype','constructor'].includes(result))throw new Error('허용되지 않는 식별자입니다.');
  return result;
}
function number(value:unknown,min:number,max:number):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error('확장 속성의 숫자가 허용 범위를 벗어났습니다.');
  return value;
}
function flag(value:unknown):boolean {if(typeof value!=='boolean')throw new Error('확장 속성의 선택 값이 올바르지 않습니다.');return value;}
function choice<const T extends string>(value:unknown,options:readonly T[]):T {if(typeof value!=='string'||!options.includes(value as T))throw new Error('확장 속성의 종류가 올바르지 않습니다.');return value as T;}
function date(value:unknown):string {
  const result=text(value,'날짜',40);
  if(result==='')return result;
  if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(result)||!Number.isFinite(Date.parse(result)))throw new Error('날짜가 올바르지 않습니다.');
  const day=result.slice(0,10), parsed=new Date(`${day}T00:00:00Z`);
  if(parsed.toISOString().slice(0,10)!==day)throw new Error('존재하지 않는 날짜입니다.');
  return result;
}
function list<T>(value:unknown,max:number,parse:(value:unknown)=>T):T[]{if(!Array.isArray(value)||value.length>max)throw new Error('확장 속성 목록이 없거나 허용 개수를 넘었습니다.');return value.map(parse);}
function unique<T extends {id:string}>(items:T[]):T[]{if(new Set(items.map(x=>x.id)).size!==items.length)throw new Error('확장 속성에 중복된 식별자가 있습니다.');return items;}
function anchor(value:unknown):Point {const p=record(value,'연결점');return {x:number(p.x,0,1),y:number(p.y,0,1)};}
function fieldKey(value:unknown):string {
  const key=text(value,'사용자 필드 이름',64);
  if(!key.trim()||key!==key.trim()||/[\x00-\x1f\x7f]/.test(key)||['__proto__','prototype','constructor'].includes(key))throw new Error('사용자 필드 이름이 올바르지 않습니다.');
  return key;
}

export function validateNodeExtensions(raw:RecordValue):Pick<FlowNode,'details'|'crop'|'rotation'|'customPorts'|'textRuns'|'contentMode'|'table'> {
  const result:Pick<FlowNode,'details'|'crop'|'rotation'|'customPorts'|'textRuns'|'contentMode'|'table'>={};
  if(raw.details!==undefined){
    const d=record(raw.details,'자료 정보'),details:NodeDetails={};
    if(d.documentPath!==undefined){const path=text(d.documentPath,'연결 문서 경로',8000);if(!/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(path)||! /\.agentsketch$/i.test(path)||/[\x00-\x1f]/.test(path))throw new Error('연결 문서는 절대 경로의 .agentsketch 파일이어야 합니다.');details.documentPath=path;}
    for(const key of ['owner','sourceSystem','version','verifiedVersion','checkedBy','sourceFingerprint','verifiedSourceFingerprint'] as const)if(d[key]!==undefined)details[key]=text(d[key],key,1000);
    for(const key of ['source','notes'] as const)if(d[key]!==undefined)details[key]=text(d[key],key,key==='notes'?50000:8000);
    for(const key of ['checkedAt','dueAt'] as const)if(d[key]!==undefined)details[key]=date(d[key]);
    for(const key of ['pageId','layerId'] as const)if(d[key]!==undefined)details[key]=id(d[key]);
    if(d.role!==undefined)details.role=choice(d.role,['step','resource']);
    if(d.status!==undefined)details.status=choice(d.status,['missing','collected','reviewing','verified','stale']);
    if(d.requirement!==undefined)details.requirement=choice(d.requirement,['all','any']);
    if(d.checklist!==undefined)details.checklist=unique(list(d.checklist,500,v=>{const item=record(v,'체크 항목');return {id:id(item.id),text:text(item.text,'체크 항목',2000),done:flag(item.done)};}));
    if(details.checklist&&details.checklist.reduce((sum,c)=>sum+c.text.length,0)>50000)throw new Error('확인 목록 전체 글자는 50,000자까지 사용할 수 있습니다.');
    if(d.reviewIntervalDays!==undefined){details.reviewIntervalDays=number(d.reviewIntervalDays,1,3650);if(!Number.isInteger(details.reviewIntervalDays))throw new Error('재확인 주기는 정수 일수여야 합니다.');}
    if(d.attachmentIds!==undefined){details.attachmentIds=list(d.attachmentIds,100,id);if(new Set(details.attachmentIds).size!==details.attachmentIds.length)throw new Error('중복된 첨부 파일 참조입니다.');}
    if(d.customFields!==undefined){
      const fields=Object.entries(record(d.customFields,'사용자 필드'));if(fields.length>32)throw new Error('사용자 필드는 32개까지 사용할 수 있습니다.');
      details.customFields={};for(const [key,value] of fields){fieldKey(key);if(key==='status')throw new Error('status는 상태 비교용으로 예약된 필드 이름입니다.');details.customFields[key]=text(value,'사용자 필드 값',2000);}
    }
    result.details=details;
  }
  if(raw.crop!==undefined){
    const c=record(raw.crop,'이미지 자르기'), crop={x:number(c.x,0,1),y:number(c.y,0,1),w:number(c.w,.001,1),h:number(c.h,.001,1)};
    if(crop.x+crop.w>1.000001||crop.y+crop.h>1.000001)throw new Error('이미지 자르기 영역이 원본을 벗어났습니다.');
    result.crop=crop;
  }
  if(raw.rotation!==undefined)result.rotation=number(raw.rotation,-360,360);
  if(raw.customPorts!==undefined)result.customPorts=unique(list(raw.customPorts,64,v=>{const p=record(v,'연결점');return {id:id(p.id),point:anchor(p.point)};}));
  if(raw.contentMode!==undefined)result.contentMode=choice(raw.contentMode,['text','checklist','table']);
  if(raw.textRuns!==undefined)result.textRuns=normalizeTextRuns(raw.textRuns as FlowNode['textRuns']&{},text(raw.text??'','본문',50000));
  if(raw.table!==undefined)result.table=normalizeNodeTable(raw.table as NonNullable<FlowNode['table']>);
  if(result.contentMode==='table'&&!result.table)throw new Error('표 내용이 없습니다.');
  return result;
}

export function validateEdgeExtensions(raw:RecordValue):Pick<FlowEdge,'relation'|'labelPosition'|'fromAnchor'|'toAnchor'|'condition'|'labelBackground'|'labelAngle'> {
  const result:Pick<FlowEdge,'relation'|'labelPosition'|'fromAnchor'|'toAnchor'|'condition'|'labelBackground'|'labelAngle'>={};
  if(raw.relation!==undefined)result.relation=choice(raw.relation,['required','alternative','optional','reference','output']);
  if(raw.labelPosition!==undefined)result.labelPosition=number(raw.labelPosition,0,1);
  if(raw.fromAnchor!==undefined)result.fromAnchor=anchor(raw.fromAnchor);
  if(raw.toAnchor!==undefined)result.toAnchor=anchor(raw.toAnchor);
  if(raw.condition!==undefined){const condition=record(raw.condition,'연결 조건');result.condition={nodeId:id(condition.nodeId),field:fieldKey(condition.field),operator:choice(condition.operator,['equals','notEquals']),value:text(condition.value,'조건 비교 값',2000)};}
  if(raw.labelBackground!==undefined){const color=text(raw.labelBackground,'설명 배경 색',9);if(!/^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/.test(color))throw new Error('설명 배경 색이 올바르지 않습니다.');result.labelBackground=color;}
  if(raw.labelAngle!==undefined){if(![-90,0,90].includes(raw.labelAngle as number))throw new Error('설명 회전은 -90, 0, 90도 중 하나여야 합니다.');result.labelAngle=raw.labelAngle as -90|0|90;}
  return result;
}

export function validateWorkspace(value:unknown,nodes:FlowNode[]):WorkspaceData {
  const raw=record(value,'작업 공간'), result:WorkspaceData={},nodeIds=new Set(nodes.map(n=>n.id));
  if(raw.attachments!==undefined)result.attachments=validateAttachments(raw.attachments);
  const attachmentIds=new Set(result.attachments?.map(a=>a.id));
  for(const node of nodes)if(node.details?.attachmentIds?.some(id=>!attachmentIds.has(id)))throw new Error('요소가 참조하는 첨부 파일이 문서에 없습니다.');
  if(raw.pages!==undefined)result.pages=unique(list(raw.pages,1000,v=>{const p=record(v,'페이지');return {id:id(p.id),name:text(p.name,'페이지 이름',300)};}));
  if(raw.layers!==undefined)result.layers=unique(list(raw.layers,500,v=>{const l=record(v,'레이어');return {id:id(l.id),name:text(l.name,'레이어 이름',300),...(l.hidden!==undefined?{hidden:flag(l.hidden)}:{}),...(l.locked!==undefined?{locked:flag(l.locked)}:{})};}));
  if(raw.groups!==undefined){
    result.groups=unique(list(raw.groups,10000,v=>{const g=record(v,'그룹');return {id:id(g.id),name:text(g.name,'그룹 이름',300),...(g.description!==undefined?{description:text(g.description,'그룹 설명',5000)}:{}),...(g.parentId!==undefined?{parentId:id(g.parentId)}:{}),...(g.collapsed!==undefined?{collapsed:flag(g.collapsed)}:{})};}));
    const groups=new Map(result.groups.map(g=>[g.id,g])),done=new Set<string>();
    for(const group of result.groups){
      let current:string|undefined=group.id;const path=new Set<string>();
      while(current&&!done.has(current)){
        if(path.has(current))throw new Error('그룹이 자기 자신을 포함할 수 없습니다.');
        path.add(current);const g=groups.get(current);if(!g)throw new Error('상위 그룹이 존재하지 않습니다.');current=g.parentId;
      }
      for(const key of path)done.add(key);
    }
  }
  if(raw.activePageId!==undefined){result.activePageId=id(raw.activePageId);if(!result.pages?.some(p=>p.id===result.activePageId))throw new Error('선택한 페이지가 존재하지 않습니다.');}
  const pageIds=new Set(result.pages?.map(p=>p.id)),layerIds=new Set(result.layers?.map(l=>l.id));
  for(const node of nodes){
    if(node.details?.pageId&&result.pages&&!pageIds.has(node.details.pageId))throw new Error('요소의 페이지가 존재하지 않습니다.');
    if(node.details?.layerId&&result.layers&&!layerIds.has(node.details.layerId))throw new Error('요소의 레이어가 존재하지 않습니다.');
  }
  if(raw.comments!==undefined)result.comments=unique(list(raw.comments,5000,v=>{
    const c=record(v,'검토 의견');const nodeId=c.nodeId!==undefined?id(c.nodeId):undefined;if(nodeId&&!nodeIds.has(nodeId))throw new Error('검토 의견의 요소가 존재하지 않습니다.');
    return {id:id(c.id),author:text(c.author,'작성자',300),text:text(c.text,'검토 의견',10000),createdAt:date(c.createdAt),...(nodeId?{nodeId}:{}),...(c.resolved!==undefined?{resolved:flag(c.resolved)}:{})};
  }));
  if(raw.bookmarks!==undefined)result.bookmarks=unique(list(raw.bookmarks,1000,v=>{
    const b=record(v,'북마크'),p=record(b.viewport,'북마크 보기');const nodeId=b.nodeId!==undefined?id(b.nodeId):undefined;if(nodeId&&!nodeIds.has(nodeId))throw new Error('북마크의 요소가 존재하지 않습니다.');
    return {id:id(b.id),name:text(b.name,'북마크 이름',300),...(nodeId?{nodeId}:{}),viewport:{x:number(p.x,-10000000,10000000),y:number(p.y,-10000000,10000000),zoom:number(p.zoom,.05,8)}};
  }));
  return result;
}
