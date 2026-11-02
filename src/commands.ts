/** Shared, DOM-free document command contract used by desktop, CLI and MCP. */
import type {FlowDocument,FlowNode,FlowEdge} from './types.ts';
import {cloneDocument,createNode,emptyDocument,uid,validateDocument,duplicateSelection,removeSelection,alignNodes,distributeNodes,translateInternalRoutes} from './model.ts';
import * as org from './organization.ts';
import {computeLayout,applyLayout} from './layout-engine.ts';
import {analyzeWorkflow,traceNodes} from './workflow.ts';
import {compareDocuments,presentationStops} from './review-model.ts';
import {setNodePlainText,formatNodeTextRange} from './rich-text.ts';
import {addNextStep,splitConnection} from './diagram-actions.ts';
import {availableRouteSegments,fixRouteSegment,releaseRouteSegment} from './route-segments.ts';
import {edgePoints,intersects} from './geometry.ts';
import {addAttachment,removeAttachment,previewSourceRelink,applySourceRelink} from './attachments.ts';
import {createSample} from './sample.ts';

export class CommandError extends Error {code:string;details:unknown;constructor(code:string,message:string,details?:unknown){super(message);this.code=code;this.details=details;}}
export type Schema=Record<string,any>;
export type Invocation={command:string;args?:Record<string,any>};
type Context={doc:FlowDocument};
type Definition={name:string;description:string;inputSchema:Schema;mutates:boolean;run:(c:Context,a:any)=>any};
const S={type:'string'},N={type:'number'},B={type:'boolean'},O={type:'object'},A={type:'array'};
const ids={type:'array',items:S,minItems:1,maxItems:10000};
const en=(...values:string[])=>({type:'string',enum:values});
const object=(properties:Record<string,Schema>,required:string[]=[]):Schema=>({type:'object',properties,required,additionalProperties:false});
const point=object({x:N,y:N},['x','y']);
const nodeFields=['kind','text','x','y','w','h','fill','stroke','color','fontSize','bold','align','strokeWidth','dashed','locked','groupId','assetId','points','opacity','details','crop','rotation','customPorts','textRuns','contentMode','table'];
const edgeFields=['from','to','fromPort','toPort','label','color','width','style','dashed','arrow','waypoints','relation','labelPosition','fromAnchor','toAnchor','condition','labelBackground','labelAngle'];
export const nodeProperties=object(Object.fromEntries(nodeFields.map(k=>[k,{}])));
export const edgeProperties=object(Object.fromEntries(edgeFields.map(k=>[k,{}])));
for(const k of ['text','fill','stroke','color'])nodeProperties.properties[k]=S;
for(const k of ['x','y','w','h','fontSize','strokeWidth','opacity','rotation'])nodeProperties.properties[k]=N;
for(const k of ['bold','dashed','locked'])nodeProperties.properties[k]=B;
nodeProperties.properties.kind=en('rect','round','ellipse','diamond','text','note','image','frame','draw');
nodeProperties.properties.align=en('left','center','right');
const optional=(s:Schema)=>({...s,type:[s.type,'null']});
for(const k of ['groupId','assetId'])nodeProperties.properties[k]=optional(S);
nodeProperties.properties.points=optional({type:'array',items:point});
nodeProperties.properties.crop=optional(object({x:N,y:N,w:N,h:N},['x','y','w','h']));
nodeProperties.properties.contentMode=optional(en('text','table','checklist'));
nodeProperties.properties.textRuns=optional({type:'array',items:object({text:S,bold:B,color:S,fontSize:N,href:S},['text'])});
nodeProperties.properties.table=optional(object({columns:{type:'array',items:S},rows:{type:'array',items:{type:'array',items:S}}},['columns','rows']));
nodeProperties.properties.customPorts=optional({type:'array',items:object({id:S,point},['id','point'])});
const details:Record<string,Schema>={};for(const k of ['documentPath','owner','source','sourceSystem','version','verifiedVersion','checkedBy','checkedAt','dueAt','sourceFingerprint','verifiedSourceFingerprint','notes','pageId','layerId'])details[k]=optional(S);
Object.assign(details,{role:optional(en('step','resource')),status:optional(en('missing','collected','reviewing','verified','stale')),requirement:optional(en('all','any')),reviewIntervalDays:optional(N),attachmentIds:optional(ids),customFields:optional(O),checklist:optional({type:'array',items:object({id:S,text:S,done:B},['id','text','done'])})});
nodeProperties.properties.details=optional(object(details));
for(const k of ['from','to','label','color'])edgeProperties.properties[k]=S;
for(const k of ['width','labelPosition','labelAngle'])edgeProperties.properties[k]=N;
for(const k of ['fromPort','toPort'])edgeProperties.properties[k]=en('top','right','bottom','left');
edgeProperties.properties.style=en('elbow','straight','curve');edgeProperties.properties.arrow=en('end','both','none');edgeProperties.properties.dashed=B;
edgeProperties.properties.relation=optional(en('required','alternative','optional','reference','output'));
edgeProperties.properties.waypoints=optional({type:'array',items:point});for(const k of ['fromAnchor','toAnchor'])edgeProperties.properties[k]=optional(point);
edgeProperties.properties.labelBackground=optional(S);edgeProperties.properties.condition=optional(object({nodeId:S,field:S,operator:en('equals','notEquals'),value:S},['nodeId','field','operator','value']));
const defs:Definition[]=[];
function def(name:string,description:string,inputSchema:Schema,mutates:boolean,run:Definition['run']){defs.push({name,description,inputSchema,mutates,run});}
function fail(code:string,message:string):never{throw new CommandError(code,message);}
function findNode(c:Context,id:string){return c.doc.nodes.find(n=>n.id===id)??fail('NOT_FOUND',`요소 없음: ${id}`);}
function findEdge(c:Context,id:string){return c.doc.edges.find(e=>e.id===id)??fail('NOT_FOUND',`연결선 없음: ${id}`);}
function editable(c:Context,list:string[]){const allowed=org.editableNodeIds(c.doc);for(const id of list){findNode(c,id);if(!allowed.has(id))fail('LOCKED',`잠금·숨김·다른 페이지 요소: ${id}`);}}
function edgeEditable(c:Context,e:FlowEdge){editable(c,[e.from,e.to]);}
function patch(target:any,values:any){for(const [k,v] of Object.entries(values)){if(v===null)delete target[k];else if(k==='details'){target[k]={...target[k]};patch(target[k],v);}else target[k]=v;}}
function clean(value:any){if(value&&typeof value==='object'){for(const key of Object.keys(value)){if(['__proto__','constructor','prototype'].includes(key))fail('INVALID_ARGUMENT','허용되지 않는 속성 이름');clean(value[key]);}}}
export function checkSchema(value:any,schema:Schema,path='args'):void{
 if(Array.isArray(schema.type)){if(value===null&&schema.type.includes('null'))return;schema={...schema,type:schema.type.find((t:string)=>t!=='null')};}
 if(value===undefined)fail('INVALID_ARGUMENT',`${path} 필요`);
 if(schema.type==='object'){if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_ARGUMENT',`${path}: 객체 필요`);for(const k of schema.required??[])if(value[k]===undefined)fail('INVALID_ARGUMENT',`${path}.${k} 필요`);for(const [k,v] of Object.entries(value)){if(schema.additionalProperties===false&&!Object.hasOwn(schema.properties??{},k))fail('INVALID_ARGUMENT',`${path}.${k}: 알 수 없는 속성`);if(schema.properties?.[k])checkSchema(v,schema.properties[k],`${path}.${k}`);}}
 else if(schema.type==='array'){if(!Array.isArray(value))fail('INVALID_ARGUMENT',`${path}: 배열 필요`);if(value.length<(schema.minItems??0)||value.length>(schema.maxItems??10000))fail('INVALID_ARGUMENT',`${path}: 배열 한도 초과`);if(schema.items)value.forEach((v:any,i:number)=>checkSchema(v,schema.items,`${path}[${i}]`));}
 else if(schema.type==='number'){if(typeof value!=='number'||!Number.isFinite(value))fail('INVALID_ARGUMENT',`${path}: 유한 숫자 필요`);}
 else if(schema.type&&typeof value!==schema.type)fail('INVALID_ARGUMENT',`${path}: ${schema.type} 필요`);
 if(schema.enum&&!schema.enum.includes(value))fail('INVALID_ARGUMENT',`${path}: ${schema.enum.join(', ')} 중 선택`);
}
export async function revisionOf(doc:FlowDocument){const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;const bytes=new TextEncoder().encode(JSON.stringify(canonical(doc)));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function summary(doc:FlowDocument,includeData=false){const next=cloneDocument(doc);if(!includeData){for(const a of Object.values(next.assets))a.data='[omitted: asset.get]';for(const a of next.workspace?.attachments??[])a.data='[omitted: attachment.get]';}return next;}
def('document.read','문서 전체 구조 조회. 기본적으로 이미지·첨부 본문 제외.',object({includeData:B}),false,(c,a)=>summary(c.doc,a.includeData));
def('document.new','빈 문서 또는 편집 가능한 예시로 현재 문서를 교체.',object({title:S,template:en('blank','simple','launch')}),true,(c,a)=>{c.doc=createSample(a.template??'blank');if(a.title)c.doc.title=a.title;});
def('document.replace','검증된 문서로 전체 교체. 명시적인 전체 문서 작업.',object({document:O},['document']),true,(c,a)=>{c.doc=validateDocument(a.document);});
def('document.rename','문서 이름 수정.',object({title:S},['title']),true,(c,a)=>{c.doc.title=a.title;});
def('document.compare','입력 문서와 현재 문서의 변경 목록.',object({document:O},['document']),false,(c,a)=>compareDocuments(c.doc,validateDocument(a.document)));
def('node.add','도형·글·이미지·자유선·문서 카드 생성. props는 모든 FlowNode 편집 속성 지원.',object({id:S,kind:en('rect','round','ellipse','diamond','text','note','image','frame','draw'),x:N,y:N,props:nodeProperties},['kind','x','y']),true,(c,a)=>{const n=createNode(a.kind,a.x,a.y);if(a.id)n.id=a.id;patch(n,a.props??{});n.details={...n.details,pageId:n.details?.pageId??c.doc.workspace?.activePageId??org.DEFAULT_PAGE};c.doc.nodes.push(n);return {id:n.id};});
def('node.update','모든 요소 속성 수정. details는 병합하며 선택 필드는 null로 제거.',object({ids,props:nodeProperties},['ids','props']),true,(c,a)=>{if(Object.keys(a.props).some(k=>k!=='locked'))editable(c,a.ids);for(const id of a.ids){const n=findNode(c,id);if('text'in a.props)setNodePlainText(n,a.props.text);patch(n,a.props);}return {ids:a.ids};});
def('node.delete','선택 요소·연결·관련 메타데이터 삭제. 조건 참조 보호.',object({ids},['ids']),true,(c,a)=>{editable(c,a.ids);removeSelection(c.doc,a.ids);});
def('node.move','그룹과 수동 경로를 유지하는 상대 이동.',object({ids,dx:N,dy:N},['ids','dx','dy']),true,(c,a)=>{const expanded=new Set<string>(a.ids);for(const id of a.ids){const n=findNode(c,id);if(n.groupId)for(const member of org.groupMembers(c.doc,org.topGroupId(c.doc,n.groupId)))expanded.add(member.id);}editable(c,[...expanded]);translateInternalRoutes(c.doc,expanded,a.dx,a.dy);for(const id of expanded){const n=findNode(c,id);n.x+=a.dx;n.y+=a.dy;}return {ids:[...expanded]};});
def('node.duplicate','연결·그룹·자료 속성을 포함해 복제.',object({ids,offset:N},['ids']),true,(c,a)=>{editable(c,a.ids);return {ids:duplicateSelection(c.doc,a.ids,a.offset??24)};});
def('node.order','앞으로 또는 뒤로 이동.',object({ids,position:en('front','back')},['ids','position']),true,(c,a)=>{editable(c,a.ids);const set=new Set(a.ids),chosen=c.doc.nodes.filter(n=>set.has(n.id)),rest=c.doc.nodes.filter(n=>!set.has(n.id));c.doc.nodes=a.position==='front'?[...rest,...chosen]:[...chosen,...rest];});
def('node.align','그룹을 고려한 정렬.',object({ids,mode:en('left','right','top','bottom','centerX','centerY')},['ids','mode']),true,(c,a)=>{editable(c,a.ids);alignNodes(c.doc,a.ids,a.mode);});
def('node.distribute','같은 간격으로 배치.',object({ids,direction:en('horizontal','vertical')},['ids','direction']),true,(c,a)=>{editable(c,a.ids);distributeNodes(c.doc,a.ids,a.direction);});
def('node.next','다음 단계와 연결선 함께 추가.',object({id:S},['id']),true,(c,a)=>{editable(c,[a.id]);return {id:addNextStep(c.doc,a.id)};});
def('text.format','선택 문자 범위의 굵기·색·크기·링크 설정.',object({id:S,start:N,end:N,style:object({bold:B,color:S,fontSize:N,href:S})},['id','start','end','style']),true,(c,a)=>{editable(c,[a.id]);formatNodeTextRange(findNode(c,a.id),a.start,a.end,a.style);});
def('edge.add','도형 사이 연결. 모든 선 속성·조건·경유점 지원.',object({id:S,from:S,to:S,props:edgeProperties},['from','to']),true,(c,a)=>{editable(c,[a.from,a.to]);const e:FlowEdge={id:a.id??uid(),from:a.from,to:a.to,fromPort:'right',toPort:'left',label:'',color:'#7B8798',width:2,style:'elbow',dashed:false,arrow:'end'};patch(e,a.props??{});edgeEditable(c,e);c.doc.edges.push(e);return {id:e.id};});
def('edge.update','연결 끝점·서식·라벨·조건 수정. null로 선택 속성 해제.',object({id:S,props:edgeProperties},['id','props']),true,(c,a)=>{const e=findEdge(c,a.id);edgeEditable(c,e);patch(e,a.props);edgeEditable(c,e);});
def('edge.delete','연결 삭제.',object({id:S},['id']),true,(c,a)=>{edgeEditable(c,findEdge(c,a.id));c.doc.edges=c.doc.edges.filter(e=>e.id!==a.id);});
def('edge.route','계산된 실제 경로·고정 가능한 구간 조회.',object({id:S},['id']),false,(c,a)=>{const e=findEdge(c,a.id);return {points:edgePoints(e,c.doc),segments:availableRouteSegments(c.doc,e)};});
def('edge.reset','수동 경유점을 지우고 자동 우회로 복귀.',object({id:S},['id']),true,(c,a)=>{const e=findEdge(c,a.id);edgeEditable(c,e);delete e.waypoints;});
def('edge.pin','직각 구간 양끝 고정.',object({id:S,index:N},['id','index']),true,(c,a)=>{const e=findEdge(c,a.id);edgeEditable(c,e);fixRouteSegment(c.doc,e,a.index);});
def('edge.unpin','고정 구간 양끝 해제.',object({id:S,index:N},['id','index']),true,(c,a)=>{const e=findEdge(c,a.id);edgeEditable(c,e);releaseRouteSegment(e,a.index);});
def('edge.split','연결 사이에 단계 삽입.',object({id:S,nodeId:S},['id']),true,(c,a)=>{edgeEditable(c,findEdge(c,a.id));if(a.nodeId)editable(c,[a.nodeId]);return {id:splitConnection(c.doc,a.id,a.nodeId)};});
const layoutSchema=object({mode:en('horizontal','vertical','tree','radial','swimlane'),gap:N,selection:ids,preservePositions:B,keepManualRoutes:B,alignment:en('none','row','column'),reverseOrder:B});
def('layout.preview','적용 전 자동 배치 계획과 경고.',layoutSchema,false,(c,a)=>computeLayout(c.doc,a));
def('layout.apply','공통 자동 배치 엔진 적용.',layoutSchema,true,(c,a)=>{const plan=computeLayout(c.doc,a);applyLayout(c.doc,plan);return plan;});
def('group.create','선택 요소를 중첩 가능한 그룹으로 묶기.',object({ids,name:S,parentId:S},['ids']),true,(c,a)=>{editable(c,a.ids);return {id:org.createGroup(c.doc,a.ids,a.name,a.parentId)};});
def('group.update','그룹 이름·설명·접기·상위 그룹 지정.',object({id:S,name:S,description:S,collapsed:B,parentId:S},['id']),true,(c,a)=>{const g=org.ensureWorkspace(c.doc).groups!.find(g=>g.id===a.id)??fail('NOT_FOUND','그룹 없음');if(a.parentId!==undefined)org.setGroupParent(c.doc,a.id,a.parentId||undefined);for(const k of ['name','description','collapsed'])if(a[k]!==undefined)(g as any)[k]=a[k];});
def('group.ungroup','그룹 해제.',object({id:S},['id']),true,(c,a)=>org.ungroup(c.doc,a.id));
def('group.resize','그룹 전체 비율 변경.',object({id:S,scale:N},['id','scale']),true,(c,a)=>org.resizeGroup(c.doc,a.id,a.scale));
def('group.members','그룹 안팎으로 요소 편입.',object({ids,groupId:S},['ids']),true,(c,a)=>{editable(c,a.ids);org.reparentDroppedNodes(c.doc,a.ids,a.groupId);});
for(const kind of ['page','layer'] as const){
 def(`${kind}.add`,`${kind} 추가.`,object({name:S},['name']),true,(c,a)=>({id:kind==='page'?org.addPage(c.doc,a.name):org.addLayer(c.doc,a.name)}));
 def(`${kind}.delete`,`${kind} 삭제. 기존 공통 이동·기본 항목 보호 규칙 적용.`,object({id:S},['id']),true,(c,a)=>kind==='page'?org.removePage(c.doc,a.id):org.removeLayer(c.doc,a.id));
 def(`${kind}.assign`,`${kind}에 선택 요소 배정.`,object({ids,id:S},['ids','id']),true,(c,a)=>{editable(c,a.ids);if(kind==='page')org.moveToPage(c.doc,a.ids,a.id);else org.assignLayer(c.doc,a.ids,a.id);});
 def(`${kind}.update`,`${kind} 이름·레이어 표시/잠금 변경.`,object({id:S,name:S,...(kind==='layer'?{hidden:B,locked:B}:{})},['id']),true,(c,a)=>{const ws=org.ensureWorkspace(c.doc),item=(kind==='page'?ws.pages:ws.layers)!.find(v=>v.id===a.id)??fail('NOT_FOUND',`${kind} 없음`);for(const [k,v] of Object.entries(a))if(k!=='id')(item as any)[k]=v;});
 def(`${kind}.order`,`${kind} 표시 순서 변경. 모든 ID를 한 번씩 전달.`,object({ids},['ids']),true,(c,a)=>{const ws=org.ensureWorkspace(c.doc),items=kind==='page'?ws.pages!:ws.layers!;if(items.length!==a.ids.length||new Set(a.ids).size!==items.length||a.ids.some((id:string)=>!items.some(v=>v.id===id)))fail('INVALID_ARGUMENT','전체 ID 순서 필요');if(kind==='page')ws.pages=a.ids.map((id:string)=>items.find(v=>v.id===id));else ws.layers=a.ids.map((id:string)=>items.find(v=>v.id===id));});
}
def('page.activate','활성 페이지 변경.',object({id:S},['id']),true,(c,a)=>{const ws=org.ensureWorkspace(c.doc);if(!ws.pages!.some(p=>p.id===a.id))fail('NOT_FOUND','페이지 없음');ws.activePageId=a.id;});
def('viewport.set','확대 비율·이동 좌표 지정.',object({x:N,y:N,zoom:N},['x','y','zoom']),true,(c,a)=>{c.doc.viewport={...a};});
def('bookmark.add','현재 화면 또는 요소 북마크 추가.',object({name:S,nodeId:S},['name']),true,(c,a)=>({id:org.addBookmark(c.doc,a.name,a.nodeId)}));
def('bookmark.update','북마크 이름·요소·저장 화면 수정.',object({id:S,name:S,nodeId:optional(S),viewport:object({x:N,y:N,zoom:N},['x','y','zoom'])},['id']),true,(c,a)=>{const bookmark=org.ensureWorkspace(c.doc).bookmarks!.find(b=>b.id===a.id)??fail('NOT_FOUND','북마크 없음');patch(bookmark,a);});
def('bookmark.delete','북마크 삭제.',object({id:S},['id']),true,(c,a)=>{const w=org.ensureWorkspace(c.doc);w.bookmarks=w.bookmarks!.filter(b=>b.id!==a.id);});
def('comment.add','보드 또는 요소에 검토 댓글 추가.',object({id:S,nodeId:S,author:S,text:S},['author','text']),true,(c,a)=>{const id=a.id??uid();(org.ensureWorkspace(c.doc).comments??=[]).push({...a,id,createdAt:new Date().toISOString(),resolved:false});return {id};});
def('comment.update','댓글 수정·해결·재개.',object({id:S,text:S,resolved:B},['id']),true,(c,a)=>{const comment=org.ensureWorkspace(c.doc).comments?.find(v=>v.id===a.id)??fail('NOT_FOUND','댓글 없음');patch(comment,a);});
def('comment.delete','댓글 삭제.',object({id:S},['id']),true,(c,a)=>{const w=org.ensureWorkspace(c.doc);w.comments=(w.comments??[]).filter(v=>v.id!==a.id);});
def('asset.put','이미지 자산 추가·교체. 검증된 data URL과 픽셀 크기 사용.',object({id:S,name:S,data:S,width:N,height:N},['id','name','data','width','height']),true,(c,a)=>{editable(c,c.doc.nodes.filter(n=>n.assetId===a.id).map(n=>n.id));c.doc.assets[a.id]={...a};return {id:a.id};});
def('asset.get','이미지 자산 본문 조회.',object({id:S},['id']),false,(c,a)=>c.doc.assets[a.id]??fail('NOT_FOUND','이미지 없음'));
def('asset.prune','어느 요소도 쓰지 않는 이미지 자산 제거.',object({}),true,c=>{const used=new Set(c.doc.nodes.map(n=>n.assetId));for(const id of Object.keys(c.doc.assets))if(!used.has(id))delete c.doc.assets[id];});
def('attachment.add','자료 요소에 파일 본문 첨부. 파일당5MiB·합계20MiB.',object({nodeId:S,attachment:O},['nodeId','attachment']),true,(c,a)=>{editable(c,[a.nodeId]);return {id:addAttachment(c.doc,a.nodeId,a.attachment)};});
def('attachment.delete','첨부 파일과 참조 제거.',object({id:S},['id']),true,(c,a)=>{editable(c,c.doc.nodes.filter(n=>n.details?.attachmentIds?.includes(a.id)).map(n=>n.id));removeAttachment(c.doc,a.id);});
def('attachment.get','첨부 본문 조회.',object({id:S},['id']),false,(c,a)=>c.doc.workspace?.attachments?.find(v=>v.id===a.id)??fail('NOT_FOUND','첨부 없음'));
def('source.relink','원본 경로 일괄 변경. dryRun으로 먼저 확인 가능.',object({from:S,to:S},['from','to']),true,(c,a)=>{const changes=previewSourceRelink(c.doc,a.from,a.to);editable(c,changes.map(v=>v.nodeId));applySourceRelink(c.doc,changes);return changes;});
def('workflow.analyze','선행 조건·변경 영향·준비 상태 검사. 실제 업무 승인은 아님.',object({}),false,c=>{const analysis=analyzeWorkflow(c.doc);return {...analysis,nodes:[...analysis.nodes.values()]};});
def('evidence.verify','실제 확인자가 검토한 근거와 버전을 기록. confirmed:true는 사용자 확인을 받은 경우에만 지정.',object({id:S,checkedBy:S,confirmed:B},['id','checkedBy','confirmed']),true,(c,a)=>{editable(c,[a.id]);const n=findNode(c,a.id),d=n.details??={};if(a.confirmed!==true||!a.checkedBy.trim())fail('CONFIRMATION_REQUIRED','실제 확인자와 명시적 확인 필요');if(d.role==='resource'&&!d.source?.trim()&&!c.doc.workspace?.attachments?.some(f=>d.attachmentIds?.includes(f.id)))fail('MISSING_EVIDENCE','출처 또는 첨부 근거 필요');d.checkedBy=a.checkedBy;d.status='verified';d.checkedAt=new Date().toISOString();d.verifiedVersion=d.version??'';d.verifiedSourceFingerprint=d.sourceFingerprint??'';});
def('workflow.trace','선행 또는 후행 영향 관계 조회.',object({id:S,direction:en('upstream','downstream')},['id','direction']),false,(c,a)=>({ids:[...traceNodes(c.doc,a.id,a.direction)]}));
def('presentation.plan','선택·관계·북마크에 따른 발표 순서.',object({mode:en('selection','dependencies','bookmarks'),ids:{type:'array',items:S}},['mode']),false,(c,a)=>presentationStops(c.doc,new Set(a.ids??[]),a.mode==='dependencies'?'nodes':a.mode));
def('library.extract','선택 요소를 재사용 가능한 묶음으로 출력.',object({ids,name:S},['ids','name']),false,(c,a)=>org.createLibraryItem(c.doc,a.ids,a.name));
def('library.insert','저장한 묶음을 위치에 삽입.',object({item:O,at:point},['item','at']),true,(c,a)=>({ids:org.insertLibraryItem(c.doc,a.item,a.at)}));
def('document.diagnose','문서 검증, 경로 없음과 도형 겹침 검사. 겹침은 최대2000요소 범위.',object({}),false,c=>{validateDocument(c.doc);const visible=org.projectVisibleDocument(c.doc);const missing=visible.edges.filter(e=>!edgePoints(e,visible).length).map(e=>e.id);const nodes=visible.nodes.filter(n=>!['draw','frame'].includes(n.kind)).slice(0,2000),overlaps:string[][]=[];for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length&&overlaps.length<1000;j++)if(intersects(nodes[i],nodes[j]))overlaps.push([nodes[i].id,nodes[j].id]);return {valid:true,missingRoutes:missing,overlaps,overlapScanTruncated:visible.nodes.length>2000||overlaps.length===1000};});

export function commandCatalog(){return defs.map(({run:_run,...definition})=>definition);}
export function isDocumentCommand(name:string){return defs.some(d=>d.name===name);}
export function runCommandInPlace(doc:FlowDocument,invocation:Invocation){const definition=defs.find(d=>d.name===invocation.command)??fail('UNKNOWN_COMMAND',invocation.command);const args=invocation.args??{};clean(args);checkSchema(args,definition.inputSchema);const context={doc};const result=definition.run(context,args);if(context.doc!==doc){for(const key of Object.keys(doc))delete (doc as any)[key];Object.assign(doc,context.doc);}return result??null;}
export async function executeCommands(doc:FlowDocument,commands:Invocation[],options:{expectedRevision?:string;dryRun?:boolean}={}){
 if(!Array.isArray(commands)||!commands.length||commands.length>1000)fail('INVALID_ARGUMENT','1~1000개 명령 필요');
 const beforeRevision=await revisionOf(doc);if(options.expectedRevision&&options.expectedRevision!==beforeRevision)fail('REVISION_CONFLICT','문서가 바뀌었습니다. 다시 읽고 수정하세요.');
 const draft=cloneDocument(doc),results=[];let mutates=false;
 for(const invocation of commands){const definition=defs.find(d=>d.name===invocation.command)??fail('UNKNOWN_COMMAND',invocation.command);mutates ||= definition.mutates;results.push({command:invocation.command,result:runCommandInPlace(draft,invocation)});}
 const next=validateDocument(draft);return {document:next,results,beforeRevision,revision:await revisionOf(next),mutates,dryRun:!!options.dryRun,changes:compareDocuments(doc,next)};
}
