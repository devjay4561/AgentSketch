import type { FlowNode, NodeTable, TextRun } from './types.ts';

export type TextStyle=Omit<TextRun,'text'>;
export const RICH_TEXT_LIMITS={runs:1000,text:50000,columns:20,rows:200,cells:2000,cellText:2000,checklist:500} as const;

export function safeTextHref(value:string):boolean {
  if(value.length>2000||/[\x00-\x20\x7f]/.test(value))return false;
  try{const url=new URL(value);return ['http:','https:','mailto:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}
}
function validateStyle(run:TextRun):TextRun {
  if(typeof run.text!=='string'||run.text.length>RICH_TEXT_LIMITS.text)throw new Error('서식 글자가 너무 깁니다.');
  const result:TextRun={text:run.text};
  if(run.bold!==undefined){if(typeof run.bold!=='boolean')throw new Error('굵기 설정이 올바르지 않습니다.');result.bold=run.bold;}
  if(run.color!==undefined){if(!/^#[\da-fA-F]{3}(?:[\da-fA-F]{3})?$/.test(run.color))throw new Error('글자 색은 HEX 색상이어야 합니다.');result.color=run.color;}
  if(run.fontSize!==undefined){if(typeof run.fontSize!=='number'||!Number.isFinite(run.fontSize)||run.fontSize<6||run.fontSize>200)throw new Error('글자 크기는 6~200 범위여야 합니다.');result.fontSize=run.fontSize;}
  if(run.href!==undefined&&run.href!==''){if(typeof run.href!=='string'||!safeTextHref(run.href))throw new Error('링크는 HTTP, HTTPS 또는 mailto 주소여야 합니다.');result.href=run.href;}
  return result;
}
function sameStyle(a:TextRun,b:TextRun):boolean{return a.bold===b.bold&&a.color===b.color&&a.fontSize===b.fontSize&&a.href===b.href;}

/** Sanitize and merge adjacent identical styles without duplicating image data. */
export function normalizeTextRuns(input:readonly TextRun[], expectedText?:string):TextRun[]{
  if(!Array.isArray(input)||input.length>RICH_TEXT_LIMITS.runs)throw new Error('글자 서식 구간은 1,000개까지 사용할 수 있습니다.');
  const runs:TextRun[]=[];let length=0;
  for(const value of input){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('글자 서식 구간이 올바르지 않습니다.');
    const run=validateStyle(value);length+=run.text.length;if(length>RICH_TEXT_LIMITS.text)throw new Error('글자는 50,000자까지 사용할 수 있습니다.');
    if(!run.text)continue;
    const last=runs.at(-1);if(last&&sameStyle(last,run))last.text+=run.text;else runs.push(run);
  }
  if(expectedText!==undefined&&runs.map(run=>run.text).join('')!==expectedText)throw new Error('본문과 부분 글자 서식의 내용이 일치하지 않습니다.');
  return runs;
}

export function setNodePlainText(node:FlowNode,value:string):void{
  if(typeof value!=='string'||value.length>RICH_TEXT_LIMITS.text)throw new Error('글자는 50,000자까지 사용할 수 있습니다.');
  node.text=value;delete node.textRuns;
}
export function setNodeRichText(node:FlowNode,runs:readonly TextRun[]):void{
  const normalized=normalizeTextRuns(runs);node.text=normalized.map(run=>run.text).join('');node.textRuns=normalized;node.contentMode='text';
}

/** start/end are the textarea's UTF-16 selection offsets. Empty ranges do nothing. */
export function formatNodeTextRange(node:FlowNode,start:number,end:number,style:TextStyle):boolean{
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>node.text.length||start>end)throw new Error('글자 선택 범위가 올바르지 않습니다.');
  if(start===end)return false;
  // Validate supplied styles before touching the node. Empty href removes a link.
  validateStyle({text:'',...style});
  const source=node.textRuns&&node.textRuns.map(run=>run.text).join('')===node.text?node.textRuns:[{text:node.text}],out:TextRun[]=[];
  let offset=0;
  for(const run of source){
    const finish=offset+run.text.length,left=Math.max(start,offset),right=Math.min(end,finish);
    if(left>=right)out.push({...run});else{
      if(left>offset)out.push({...run,text:run.text.slice(0,left-offset)});
      out.push({...run,...style,text:run.text.slice(left-offset,right-offset)});
      if(right<finish)out.push({...run,text:run.text.slice(right-offset)});
    }
    offset=finish;
  }
  setNodeRichText(node,out);return true;
}

export function normalizeNodeTable(value:NodeTable):NodeTable{
  if(!value||typeof value!=='object'||!Array.isArray(value.columns)||value.columns.length<1||value.columns.length>RICH_TEXT_LIMITS.columns||!Array.isArray(value.rows)||value.rows.length>RICH_TEXT_LIMITS.rows)throw new Error('표는 1~20열, 최대 200행까지 사용할 수 있습니다.');
  if(value.columns.length*(value.rows.length+1)>RICH_TEXT_LIMITS.cells)throw new Error('표는 머리글을 포함해 2,000칸까지 사용할 수 있습니다.');
  let length=0;
  const cell=(value:unknown)=>{if(typeof value!=='string'||value.length>RICH_TEXT_LIMITS.cellText)throw new Error('표의 한 칸은 2,000자까지 사용할 수 있습니다.');length+=value.length;if(length>RICH_TEXT_LIMITS.text)throw new Error('표 전체 글자는 50,000자까지 사용할 수 있습니다.');return value;};
  return {columns:value.columns.map(cell),rows:value.rows.map(row=>{if(!Array.isArray(row)||row.length!==value.columns.length)throw new Error('표의 행마다 열 개수가 같아야 합니다.');return row.map(cell);})};
}
export function parseTableText(value:string):NodeTable{
  const lines=value.replace(/\r\n/g,'\n').replace(/\n$/,'').split('\n').map(line=>line.split('\t'));
  const columns=lines.shift()??[''];return normalizeNodeTable({columns,rows:lines});
}
export function setNodeTable(node:FlowNode,table:NodeTable):void{node.table=normalizeNodeTable(table);node.contentMode='table';}
export function setNodeChecklist(node:FlowNode,items:readonly {id:string;text:string;done:boolean}[]):void{
  if(!Array.isArray(items)||items.length>RICH_TEXT_LIMITS.checklist)throw new Error('확인 목록은 500개까지 사용할 수 있습니다.');
  let length=0;
  const ids=new Set<string>(),checklist=items.map(item=>{
    if(!item||typeof item.id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(item.id)||['__proto__','prototype','constructor'].includes(item.id)||ids.has(item.id)||typeof item.text!=='string'||item.text.length>2000||typeof item.done!=='boolean')throw new Error('확인 목록 항목이 올바르지 않습니다.');
    length+=item.text.length;if(length>RICH_TEXT_LIMITS.text)throw new Error('확인 목록 전체 글자는 50,000자까지 사용할 수 있습니다.');
    ids.add(item.id);return {id:item.id,text:item.text,done:item.done};
  });
  node.details={...node.details,checklist};node.contentMode='checklist';
}
