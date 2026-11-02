import { createNode, emptyDocument, validateDocument, DOCUMENT_LIMITS } from './model.ts';
import type { FlowDocument, FlowEdge, FlowNode, Port, ShapeKind } from './types.ts';

export interface ImportResult { document: FlowDocument; warnings: string[] }
export interface TextExport { text: string; warnings: string[] }
const MAX_INPUT = 80 * 1024 * 1024;
const MAX_ROWS = 1 + DOCUMENT_LIMITS.nodes + DOCUMENT_LIMITS.edges + DOCUMENT_LIMITS.assets;
const columns = ['record','id','text','kind','x','y','width','height','from','to','source','owner','status','properties'] as const;
const shapes: ShapeKind[] = ['rect','round','ellipse','diamond','text','note','image','frame','draw'];
const ports: Port[] = ['top','right','bottom','left'];
const escapeXML = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
function checkInput(text: string) { if (!text.trim() || text.length > MAX_INPUT) throw new Error('가져올 파일이 비어 있거나 80MB를 초과합니다.'); }
function csvCell(value: unknown): string {
  let text = String(value ?? '');
  // Spreadsheet applications must not interpret imported user text as a formula.
  if (/^[=+@\-\t\r]/.test(text) || text.startsWith("'")) text = "'" + text;
  return '"' + text.replaceAll('"','""') + '"';
}
const unprotect = (value: string) => value.startsWith("'") && /^[=+@\-\t\r']/.test(value.slice(1)) ? value.slice(1) : value;

/** RFC 4180 records, with formula-safe cells. Assets occur once, never once per node. */
export function exportCSV(doc: FlowDocument): string {
  const rows: unknown[][] = [columns as unknown as string[]];
  rows.push(['document','',doc.title,'','','','','','','','','','',JSON.stringify({viewport:doc.viewport,workspace:doc.workspace})]);
  for (const n of doc.nodes) {
    const {id,text,kind,x,y,w,h,...properties} = n;
    rows.push(['node',id,text,kind,x,y,w,h,'','',n.details?.source??'',n.details?.owner??'',n.details?.status??'',JSON.stringify(properties)]);
  }
  for (const e of doc.edges) {
    const {id,from,to,label,...properties} = e;
    rows.push(['edge',id,label,'','','','','',from,to,'','','',JSON.stringify(properties)]);
  }
  for (const asset of Object.values(doc.assets)) rows.push(['asset',asset.id,asset.name,'','','',asset.width,asset.height,'','','','','',JSON.stringify(asset)]);
  return '\uFEFF' + rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
}

function parseCSV(text: string): string[][] {
  checkInput(text); text=text.replace(/^\uFEFF/,'');
  const rows: string[][]=[], row:string[]=[]; let field='',quoted=false,closed=false;
  const finishField=()=>{row.push(unprotect(field));field='';closed=false;if(row.length>100)throw new Error('CSV 열이 너무 많습니다.');};
  const finishRow=()=>{finishField();if(row.some(v=>v.length))rows.push([...row]);row.length=0;if(rows.length>MAX_ROWS+1)throw new Error('CSV 행이 너무 많습니다.');};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
    if(c==='"'){if(field||closed)throw new Error('CSV 따옴표 형식이 올바르지 않습니다.');quoted=true;}
    else if(c===',')finishField();
    else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;finishRow();}
    else {if(closed)throw new Error('CSV 따옴표 뒤에 잘못된 내용이 있습니다.');field+=c;}
  }
  if(quoted)throw new Error('CSV 따옴표가 닫히지 않았습니다.');
  if(field||row.length||closed)finishRow();return rows;
}
function jsonRecord(text: string): Record<string, unknown> {
  if(!text)return {};
  let value:unknown;try{value=JSON.parse(text);}catch{throw new Error('properties 열의 JSON 형식이 올바르지 않습니다.');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('properties 열은 JSON 객체여야 합니다.');
  return value as Record<string,unknown>;
}
const numeric=(value:string,fallback:number)=>value===''?fallback:Number(value);

export function importCSV(text: string): ImportResult {
  const rows=parseCSV(text), header=rows.shift();
  if(!header||!header.includes('record')||!header.includes('id'))throw new Error('CSV에 record, id 열이 필요합니다. 먼저 CSV 양식을 내보내세요.');
  if(new Set(header).size!==header.length)throw new Error('CSV에 중복된 열 이름이 있습니다.');
  const doc=emptyDocument(),warnings:string[]=[];doc.assets=Object.create(null);
  for(const [index,row] of rows.entries()){
    if(row.length!==header.length)throw new Error(`CSV ${index+2}행의 열 수가 맞지 않습니다.`);
    const data=Object.fromEntries(header.map((h,i)=>[h,row[i]])),p=jsonRecord(data.properties??'');
    if(data.record==='document') {doc.title=data.text||doc.title;if(p.viewport)doc.viewport=p.viewport as FlowDocument['viewport'];if(p.workspace)doc.workspace=p.workspace as FlowDocument['workspace'];}
    else if(data.record==='node'){
      const kind=(data.kind||'rect') as ShapeKind;if(!shapes.includes(kind))throw new Error(`CSV ${index+2}행의 도형 종류를 지원하지 않습니다.`);
      const node={...createNode(kind,0,0),...p,id:data.id,text:data.text??'',kind,x:numeric(data.x??'',0),y:numeric(data.y??'',0),w:numeric(data.width??'',220),h:numeric(data.height??'',100)} as FlowNode;
      if(data.source||data.owner||data.status||node.details)node.details={...node.details,...(header.includes('source')?{source:data.source}:{}),...(header.includes('owner')?{owner:data.owner}:{}),...(data.status?{status:data.status as NonNullable<FlowNode['details']>['status']}:{} )};
      doc.nodes.push(node);
    }else if(data.record==='edge'){
      doc.edges.push({fromPort:'right',toPort:'left',style:'elbow',color:'#67768A',width:2,dashed:false,arrow:'end',...p,id:data.id,from:data.from,to:data.to,label:data.text??''} as FlowEdge);
    }else if(data.record==='asset')doc.assets[data.id]={...p,id:data.id,name:data.text??'',width:numeric(data.width??'',1),height:numeric(data.height??'',1)} as FlowDocument['assets'][string];
    else warnings.push(`CSV ${index+2}행: 알 수 없는 record '${data.record}'를 건너뛰었습니다.`);
  }
  return {document:validateDocument(doc),warnings};
}

type XMLItem={name:string;attributes:Record<string,string>;children:XMLItem[];text:string};
function decodeXML(value:string):string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,(_m,entity:string)=>{
    const basic:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(basic[entity])return basic[entity];
    const code=entity.startsWith('#x')?parseInt(entity.slice(2),16):Number(entity.slice(1));
    return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'\uFFFD';
  });
}
/** Small bounded XML reader: quoted attributes, no DTD, entities, scripts, or fetching. */
function parseXML(source:string):XMLItem {
  checkInput(source);if(/<!DOCTYPE|<!ENTITY/i.test(source))throw new Error('외부 선언이 포함된 XML은 가져올 수 없습니다.');
  const root:XMLItem={name:'#root',attributes:{},children:[],text:''},stack=[root];let last=0,count=0;
  const tokens=/<(?:!--[\s\S]*?--|\?[\s\S]*?\?|(?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  for(const match of source.matchAll(tokens)){
    stack.at(-1)!.text+=decodeXML(source.slice(last,match.index));last=match.index!+match[0].length;
    const token=match[0];if(token.startsWith('<!--')||token.startsWith('<?'))continue;
    if(token.startsWith('</')){const name=token.slice(2,-1).trim();if(stack.length===1||stack.at(-1)!.name!==name)throw new Error('XML 닫는 태그가 올바르지 않습니다.');stack.pop();continue;}
    const found=/^<([A-Za-z_][\w:.-]*)/.exec(token);if(!found)throw new Error('지원하지 않는 XML 구문입니다.');
    const attrs:Record<string,string>=Object.create(null),body=token.slice(found[0].length,token.endsWith('/>')?-2:-1);
    let position=0;const pattern=/\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy;
    while(position<body.length){pattern.lastIndex=position;const attr=pattern.exec(body);if(!attr){if(body.slice(position).trim())throw new Error('XML 속성 형식이 올바르지 않습니다.');break;}if(Object.hasOwn(attrs,attr[1]))throw new Error('중복된 XML 속성입니다.');attrs[attr[1]]=decodeXML(attr[2]??attr[3]);position=pattern.lastIndex;}
    const node:XMLItem={name:found[1],attributes:attrs,children:[],text:''};stack.at(-1)!.children.push(node);if(++count>200000)throw new Error('XML 요소가 너무 많습니다.');
    if(!token.endsWith('/>')){stack.push(node);if(stack.length>80)throw new Error('XML 중첩이 너무 깊습니다.');}
  }
  if(stack.length!==1||source.slice(last).trim())throw new Error('XML 문서가 완전하지 않습니다.');
  return root;
}
function descendants(node:XMLItem,name:string):XMLItem[]{const out:XMLItem[]=[],queue=[node];for(let i=0;i<queue.length;i++){const n=queue[i];if(n.name===name)out.push(n);queue.push(...n.children);}return out;}
function parseStyle(value:string){return Object.fromEntries(value.split(';').filter(Boolean).map(x=>{const i=x.indexOf('=');return i<0?[x,'1']:[x.slice(0,i),x.slice(i+1)];}));}
function plainText(value:string){return decodeXML(value.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(?:div|p)>/gi,'\n').replace(/<[^>]*>/g,'')).trimEnd();}
function port(x:unknown,y:unknown,fallback:Port):Port{if(x==='0')return 'left';if(x==='1')return 'right';if(y==='0')return 'top';if(y==='1')return 'bottom';return fallback;}
const color=(s:string|undefined,fallback:string)=>s==='none'?'transparent':s&&/^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8})$/i.test(s)?s:fallback;
const simplePort:Record<Port,string>={left:'X=0;Y=0.5;',right:'X=1;Y=0.5;',top:'X=0.5;Y=0;',bottom:'X=0.5;Y=1;'};
function attachment(which:'entry'|'exit',p:Port){return simplePort[p].replaceAll('X=',`${which}X=`).replaceAll('Y=',`${which}Y=`);}

function drawioNodeText(node:FlowNode):string {
  if(node.contentMode==='table'&&node.table){
    return [node.text,[node.table.columns,...node.table.rows].map(row=>row.join(' | ')).join('\n')].filter(Boolean).join('\n');
  }
  if(node.contentMode==='checklist'){
    return [node.text,...(node.details?.checklist??[]).map(item=>`${item.done?'[완료]':'[미완료]'} ${item.text}`)].filter(Boolean).join('\n');
  }
  return node.textRuns?.map(run=>run.text).join('')??node.text;
}

export function exportDrawio(doc:FlowDocument):TextExport {
  const warnings:string[]=[];const nodes:string[]=['<mxCell id="0"/>','<mxCell id="1" parent="0"/>'];
  const ids=new Map(doc.nodes.map((n,i)=>[n.id,`n${i}`]));
  for(const n of doc.nodes){
    const shape=n.kind==='ellipse'?'ellipse;':n.kind==='diamond'?'rhombus;':n.kind==='round'?'rounded=1;':n.kind==='text'?'text;':'rounded=0;';
    if(['draw','image','frame','note'].includes(n.kind))warnings.push(`${n.text||n.kind}: ${n.kind} 요소를 사각형으로 변환했습니다.`);
    if(n.crop||n.rotation||n.customPorts?.length)warnings.push(`${n.text||n.kind}: 이미지 자르기·회전·사용자 연결점 속성은 포함하지 않았습니다.`);
    if(n.contentMode==='table'||n.contentMode==='checklist')warnings.push(`${n.text||n.kind}: 표·확인 목록의 전체 내용을 일반 글자로 변환했습니다. 셀 구조와 체크 조작은 보존하지 않습니다.`);
    if(n.textRuns?.some(run=>run.bold!==undefined||run.color!==undefined||run.fontSize!==undefined||run.href!==undefined))warnings.push(`${n.text||n.kind}: 부분 글자의 굵기·색상·크기·링크 서식은 보존하지 않습니다. 글자 내용은 모두 포함했습니다.`);
    const style=`${shape}whiteSpace=wrap;html=0;fillColor=${n.fill==='transparent'?'none':n.fill};strokeColor=${n.stroke==='transparent'?'none':n.stroke};fontColor=${n.color};fontSize=${n.fontSize};fontStyle=${n.bold?1:0};align=${n.align};strokeWidth=${n.strokeWidth};dashed=${n.dashed?1:0};opacity=${Math.round((n.opacity??1)*100)};`;
    nodes.push(`<mxCell id="${ids.get(n.id)}" value="${escapeXML(drawioNodeText(n))}" style="${escapeXML(style)}" vertex="1" parent="1"><mxGeometry x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" as="geometry"/></mxCell>`);
  }
  for(const [i,e] of doc.edges.entries()){
    if(e.labelAngle!==undefined||e.labelBackground!==undefined||e.labelPosition!==undefined)warnings.push(`${e.label||e.id}: 연결선 설명의 회전·배경색·수동 위치를 기본값으로 내보냈습니다.`);
    const style=`edgeStyle=${e.style==='elbow'?'orthogonalEdgeStyle':'none'};curved=${e.style==='curve'?1:0};rounded=0;html=0;strokeColor=${e.color};strokeWidth=${e.width};dashed=${e.dashed?1:0};startArrow=${e.arrow==='both'?'block':'none'};endArrow=${e.arrow!=='none'?'block':'none'};${attachment('exit',e.fromPort)}${attachment('entry',e.toPort)}`;
    const points=e.waypoints?.length?`<Array as="points">${e.waypoints.map(p=>`<mxPoint x="${p.x}" y="${p.y}"/>`).join('')}</Array>`:'';
    nodes.push(`<mxCell id="e${i}" value="${escapeXML(e.label)}" source="${ids.get(e.from)}" target="${ids.get(e.to)}" style="${style}" edge="1" parent="1"><mxGeometry relative="1" as="geometry">${points}</mxGeometry></mxCell>`);
  }
  if(doc.workspace||doc.nodes.some(n=>n.groupId||n.details)||doc.edges.some(e=>e.relation||e.fromAnchor||e.toAnchor))warnings.push('그룹·페이지·업무 자료 속성·사용자 연결점은 draw.io 교환 형식에 포함하지 않았습니다. 원본은 .agentsketch로 보관하세요.');
  if(doc.edges.some(e=>e.condition))warnings.push('draw.io에는 연결 조건식을 포함하지 않습니다. 조건 참조 요소의 글자는 포함되지만 조건의 필드·연산자·값은 .agentsketch 또는 CSV로 보관하세요.');
  return {text:`<?xml version="1.0" encoding="UTF-8"?><mxfile host="AgentSketch"><diagram name="${escapeXML(doc.title)}"><mxGraphModel><root>${nodes.join('')}</root></mxGraphModel></diagram></mxfile>`,warnings};
}

export function importDrawio(text:string):ImportResult {
  const xml=parseXML(text),models=descendants(xml,'mxGraphModel'),diagrams=descendants(xml,'diagram');
  if(!models.length)throw new Error('비압축 draw.io XML만 지원합니다. draw.io에서 XML 내보내기의 압축 옵션을 해제하세요.');
  const doc=emptyDocument(),warnings:string[]=[];doc.title=diagrams[0]?.attributes.name||'가져온 draw.io';
  if(models.length>1)warnings.push('여러 페이지 중 첫 번째 페이지만 가져왔습니다.');
  const cells=descendants(models[0],'mxCell'),mapping=new Map<string,string>(),cellMap=new Map<string,XMLItem>();
  for(const cell of cells){const id=cell.attributes.id;if(id&&cellMap.has(id))throw new Error('중복된 draw.io 요소 ID가 있습니다.');if(id)cellMap.set(id,cell);}
  function offset(cell:XMLItem):{x:number;y:number}{let parent=cell.attributes.parent,x=0,y=0;const seen=new Set<string>();while(parent&&cellMap.has(parent)){if(seen.has(parent))throw new Error('draw.io 그룹에 순환 참조가 있습니다.');seen.add(parent);const p=cellMap.get(parent)!,g=p.children.find(n=>n.name==='mxGeometry');if(p.attributes.vertex==='1'&&g){x+=numeric(g.attributes.x??'',0);y+=numeric(g.attributes.y??'',0);}parent=p.attributes.parent;}return{x,y};}
  for(const cell of cells){
    if(cell.attributes.vertex!=='1')continue;
    if(doc.nodes.length>=DOCUMENT_LIMITS.nodes)throw new Error('요소 수가 허용 범위를 초과합니다.');
    const attr=cell.attributes,style=parseStyle(attr.style??''),geometry=cell.children.find(n=>n.name==='mxGeometry');
    if(!geometry){warnings.push(`${attr.id}: 위치가 없는 요소를 건너뛰었습니다.`);continue;}
    if(style.group==='1'||style.shape==='group'){warnings.push(`${attr.id}: 그룹을 풀어서 가져왔습니다.`);continue;}
    let kind:ShapeKind=style.ellipse==='1'||style.shape==='ellipse'?'ellipse':style.rhombus==='1'||style.shape==='rhombus'?'diamond':style.text==='1'||style.shape==='text'?'text':style.rounded==='1'?'round':'rect';
    if(style.image||style.shape==='image'){kind='rect';warnings.push(`${attr.id}: 이미지 자료는 가져오지 않고 자리 상자로 표시했습니다.`);}
    else if(style.shape&&!['ellipse','rhombus','text','rectangle'].includes(style.shape))warnings.push(`${attr.id}: 지원하지 않는 '${style.shape}' 도형을 사각형으로 표시했습니다.`);
    const g=geometry.attributes,off=offset(cell),n=createNode(kind,numeric(g.x??'',0)+off.x,numeric(g.y??'',0)+off.y);
    n.id=`import-node-${doc.nodes.length}`;if(attr.id)mapping.set(attr.id,n.id);n.text=style.html==='1'?plainText(attr.value??''):(attr.value??'');n.w=numeric(g.width??'',220);n.h=numeric(g.height??'',100);
    n.fill=color(style.fillColor,n.fill);n.stroke=color(style.strokeColor,n.stroke);n.color=color(style.fontColor,n.color);n.fontSize=numeric(style.fontSize??'',16);n.bold=(numeric(style.fontStyle??'',0)&1)!==0;n.dashed=style.dashed==='1';n.strokeWidth=numeric(style.strokeWidth??'',1.5);n.opacity=numeric(style.opacity??'',100)/100;
    if(['left','center','right'].includes(style.align))n.align=style.align as FlowNode['align'];
    if(geometry.attributes.relative==='1')warnings.push(`${attr.id}: 상대 위치를 일반 좌표로 가져왔습니다. 위치를 확인하세요.`);
    if(style.html==='1')warnings.push(`${attr.id}: HTML 서식을 일반 글자로 변환했습니다.`);
    doc.nodes.push(n);
  }
  for(const cell of cells){
    if(cell.attributes.edge!=='1')continue;const attr=cell.attributes,from=mapping.get(attr.source),to=mapping.get(attr.target);
    if(!from||!to){warnings.push(`${attr.id}: 연결 대상이 없는 선을 건너뛰었습니다.`);continue;}
    const style=parseStyle(attr.style??''),points=descendants(cell,'mxPoint').filter(p=>!p.attributes.as).map(p=>({x:numeric(p.attributes.x??'',0),y:numeric(p.attributes.y??'',0)}));
    if(points.length>32)warnings.push(`${attr.id}: 경유점이 32개를 초과해 자동 경로로 가져왔습니다.`);
    doc.edges.push({id:`import-edge-${doc.edges.length}`,from,to,label:style.html==='1'?plainText(attr.value??''):(attr.value??''),fromPort:port(style.exitX,style.exitY,'right'),toPort:port(style.entryX,style.entryY,'left'),style:style.curved==='1'?'curve':style.edgeStyle==='orthogonalEdgeStyle'||style.edgeStyle==='elbowEdgeStyle'?'elbow':'straight',color:color(style.strokeColor,'#67768A'),width:numeric(style.strokeWidth??'',2),dashed:style.dashed==='1',arrow:style.startArrow&&style.startArrow!=='none'?'both':style.endArrow==='none'?'none':'end',...(points.length&&points.length<=32?{waypoints:points}:{})});
  }
  if(!doc.nodes.length)throw new Error('가져올 수 있는 도형이 없습니다.');
  warnings.push('기본 도형·일반 글자·색상·연결·경유점만 가져옵니다. 원본의 글꼴·그룹·레이어·업무 속성은 보존하지 않습니다.');
  return {document:validateDocument(doc),warnings:[...new Set(warnings)]};
}
