import type { Asset, Box, FlowDocument, FlowEdge, FlowNode, Port, ShapeKind } from './types.ts';
import { bounds } from './geometry.ts';
import { PALETTE } from './theme.ts';
import {validateNodeExtensions,validateEdgeExtensions,validateWorkspace} from './extension-validation.ts';
import type {WorkspaceData} from './workspace-types.ts';
import {t} from './i18n.ts';

export const DOCUMENT_LIMITS = { nodes: 10_000, edges: 30_000, assets: 200, assetData: 20 * 1024 * 1024, totalAssetData: 50 * 1024 * 1024, coordinate: 1_000_000 } as const;

export function uid(): string { return globalThis.crypto.randomUUID(); }

export function createNode(kind: ShapeKind, x: number, y: number): FlowNode {
  const text = kind === 'text' ? t('텍스트를 입력하세요') : kind === 'note' ? t('메모를 입력하세요') : kind === 'frame' ? t('그룹 제목') : kind === 'draw' || kind === 'image' ? '' : t('새 단계');
  return {
    id: uid(), kind, x, y, w: kind === 'frame' ? 560 : kind === 'text' ? 280 : kind === 'diamond' ? 180 : 220,
    h: kind === 'frame' ? 340 : kind === 'text' ? 64 : kind === 'note' ? 160 : kind === 'diamond' ? 140 : 100,
    text, fill: kind === 'text' || kind === 'draw' ? 'transparent' : kind === 'note' ? PALETTE.note : kind === 'frame' ? PALETTE.frame : '#FFFFFF',
    stroke: kind === 'text' ? 'transparent' : kind === 'note' ? PALETTE.noteBorder : PALETTE.border, color: PALETTE.ink, fontSize: 16,
    bold: false, align: kind === 'note' || kind === 'text' || kind === 'frame' ? 'left' : 'center',
    strokeWidth: kind === 'text' ? 0 : 1.5, dashed: kind === 'frame', locked: false, opacity: 1,
    ...(kind === 'draw' ? { points: [] } : {}),
  };
}

export function emptyDocument(): FlowDocument {
  return { format: 'agentsketch', version: 1, title: t('이름 없는 보드'), nodes: [], edges: [], assets: {}, viewport: { x: 80, y: 80, zoom: 1 } };
}

export function cloneNode(node: FlowNode): FlowNode {
  return { ...node,
    ...(node.points?{points:node.points.map(p=>({...p}))}:{}),
    ...(node.details?{details:{...node.details,...(node.details.checklist?{checklist:node.details.checklist.map(c=>({...c}))}:{}),...(node.details.attachmentIds?{attachmentIds:[...node.details.attachmentIds]}:{}),...(node.details.customFields?{customFields:{...node.details.customFields}}:{})}}:{}),
    ...(node.crop?{crop:{...node.crop}}:{}),
    ...(node.textRuns?{textRuns:node.textRuns.map(run=>({...run}))}:{}),
    ...(node.table?{table:{columns:[...node.table.columns],rows:node.table.rows.map(row=>[...row])}}:{}),
    ...(node.customPorts?{customPorts:node.customPorts.map(p=>({...p,point:{...p.point}}))}:{}) };
}
export function cloneEdge(edge: FlowEdge): FlowEdge {
  return {...edge,...(edge.waypoints?{waypoints:edge.waypoints.map(p=>({...p}))}:{}),...(edge.fromAnchor?{fromAnchor:{...edge.fromAnchor}}:{}),...(edge.toAnchor?{toAnchor:{...edge.toAnchor}}:{}),...(edge.condition?{condition:{...edge.condition}}:{})};
}
export function cloneWorkspace(workspace: WorkspaceData): WorkspaceData {
  return {...workspace,
    ...(workspace.attachments?{attachments:workspace.attachments.map(a=>({...a}))}:{}),
    ...(workspace.pages?{pages:workspace.pages.map(p=>({...p}))}:{}),
    ...(workspace.layers?{layers:workspace.layers.map(l=>({...l}))}:{}),
    ...(workspace.groups?{groups:workspace.groups.map(g=>({...g}))}:{}),
    ...(workspace.comments?{comments:workspace.comments.map(c=>({...c}))}:{}),
    ...(workspace.bookmarks?{bookmarks:workspace.bookmarks.map(b=>({...b,viewport:{...b.viewport}}))}:{})};
}
export function cloneDocument(doc: FlowDocument): FlowDocument {
  return { ...doc, nodes: doc.nodes.map(cloneNode), edges: doc.edges.map(cloneEdge), assets: Object.fromEntries(Object.entries(doc.assets).map(([id, asset]) => [id, { ...asset }])), viewport: { ...doc.viewport },...(doc.workspace?{workspace:cloneWorkspace(doc.workspace)}:{}) };
}

/** Approximate retained mutable object count; immutable image/attachment strings
 * are shared by cloneDocument and are deliberately not charged per snapshot. */
function snapshotWeight(doc: FlowDocument): number {
  let cost=5+Object.keys(doc.assets).length+doc.nodes.length+doc.edges.length;
  for(const node of doc.nodes){
    cost+=(node.points?.length??0)+(node.crop?1:0)+(node.customPorts?.length??0)*2+(node.textRuns?.length??0);
    if(node.table)cost+=3+node.table.rows.length;
    if(node.details)cost+=1+(node.details.checklist?.length??0)+(node.details.customFields?1:0)+(node.details.attachmentIds?1:0);
  }
  for(const edge of doc.edges)cost+=(edge.waypoints?.length??0)+(edge.fromAnchor?1:0)+(edge.toAnchor?1:0)+(edge.condition?1:0);
  if(doc.workspace){const w=doc.workspace;cost+=7+(w.pages?.length??0)+(w.groups?.length??0)+(w.layers?.length??0)+(w.comments?.length??0)+(w.bookmarks?.length??0)*2+(w.attachments?.length??0);}
  return cost;
}
interface HistoryEntry {document:FlowDocument;weight:number}
export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private retainedWeight=0;
  readonly limit: number;
  readonly objectBudget: number;
  constructor(limit = 60, objectBudget = 120_000) { this.limit = Number.isFinite(limit)?Math.max(1,Math.floor(limit)):60;this.objectBudget=Number.isFinite(objectBudget)?Math.max(1,Math.floor(objectBudget)):120_000; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get retainedObjects(): number { return this.retainedWeight; }
  private entry(doc:FlowDocument):HistoryEntry {const document=cloneDocument(doc);return {document,weight:snapshotWeight(document)};}
  private trim(prefer:'past'|'future'):void {
    while(this.past.length+this.future.length>this.limit||this.retainedWeight>this.objectBudget&&this.past.length+this.future.length>1){
      const first=prefer==='past'?this.past:this.future,second=prefer==='past'?this.future:this.past;
      const removed=(first.length?first:second).shift();if(!removed)break;this.retainedWeight-=removed.weight;
    }
  }
  push(doc: FlowDocument): void {
    for(const entry of this.future)this.retainedWeight-=entry.weight;this.future=[];
    const entry=this.entry(doc);this.past.push(entry);this.retainedWeight+=entry.weight;this.trim('past');
  }
  undo(current: FlowDocument): FlowDocument | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.retainedWeight-=previous.weight;
    const entry=this.entry(current);this.future.push(entry);this.retainedWeight+=entry.weight;this.trim('past');
    return previous.document;
  }
  redo(current: FlowDocument): FlowDocument | null {
    const next = this.future.pop();
    if (!next) return null;
    this.retainedWeight-=next.weight;
    const entry=this.entry(current);this.past.push(entry);this.retainedWeight+=entry.weight;this.trim('future');
    return next.document;
  }
  clear(): void { this.past = []; this.future = []; this.retainedWeight=0; }
}

type RecordValue = Record<string, unknown>;
function record(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return value as RecordValue;
}
function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} 값이 허용 범위를 벗어났습니다.`);
  return value;
}
function str(value: unknown, label: string, max = 10_000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} 문자열이 올바르지 않거나 너무 깁니다.`);
  return value;
}
function id(value: unknown, label: string): string {
  const result = str(value, label, 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(result) || ['__proto__', 'prototype', 'constructor'].includes(result)) throw new Error(`${label} 식별자가 올바르지 않습니다.`);
  return result;
}
function oneOf<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`${label} 값이 올바르지 않습니다.`);
  return value as T;
}
function color(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^(?:#[a-fA-F0-9]{3}(?:[a-fA-F0-9]{3})?|#[a-fA-F0-9]{8}|transparent)$/.test(value)) throw new Error('색상 형식이 올바르지 않습니다.');
  return value;
}
function flag(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error('선택 값의 형식이 올바르지 않습니다.');
  return value;
}

export function validateDocument(input: unknown): FlowDocument {
  const raw = record(input, '문서');
  if ((raw.format !== 'agentsketch' && raw.format !== 'flowpaper') || raw.version !== 1) throw new Error('지원하는 AgentSketch 문서 형식이 아닙니다.');
  if (!Array.isArray(raw.nodes) || raw.nodes.length > DOCUMENT_LIMITS.nodes || !Array.isArray(raw.edges) || raw.edges.length > DOCUMENT_LIMITS.edges) throw new Error('요소 또는 연결선 목록이 없거나 허용 개수를 넘었습니다.');
  const rawAssets = record(raw.assets ?? {}, '이미지 목록');
  const entries = Object.entries(rawAssets);
  if (entries.length > DOCUMENT_LIMITS.assets) throw new Error('이미지는 200개까지 저장할 수 있습니다.');
  const assets: Record<string, Asset> = Object.create(null) as Record<string, Asset>;
  let assetLength = 0;
  for (const [key, value] of entries) {
    const asset = record(value, '이미지');
    const assetId = id(key, '이미지');
    if (asset.id !== assetId) throw new Error('이미지 식별자가 일치하지 않습니다.');
    const data = str(asset.data, '이미지 데이터', DOCUMENT_LIMITS.assetData);
    if (!/^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/]+={0,2}$/.test(data)) throw new Error('PNG, JPEG, WebP, GIF 이미지 데이터만 불러올 수 있습니다.');
    assetLength += data.length;
    if (assetLength > DOCUMENT_LIMITS.totalAssetData) throw new Error('이미지 전체 크기가 50 MiB를 넘었습니다. 이미지를 줄여 주세요.');
    assets[assetId] = { id: assetId, data, name: str(asset.name ?? '이미지', '이미지 이름', 300), width: finite(asset.width, '이미지 너비', 1, 32_768), height: finite(asset.height, '이미지 높이', 1, 32_768) };
  }
  const nodeIds = new Set<string>();
  const nodes: FlowNode[] = raw.nodes.map((value, index) => {
    const n = record(value, `${index + 1}번째 요소`), nodeId = id(n.id, '요소');
    if (nodeIds.has(nodeId)) throw new Error('중복된 요소 식별자가 있습니다.');
    nodeIds.add(nodeId);
    const kind = oneOf(n.kind, ['rect', 'round', 'ellipse', 'diamond', 'text', 'note', 'image', 'frame', 'draw'] as const, '도형');
    const defaults = createNode(kind, 0, 0);
    const node: FlowNode = {
      id: nodeId, kind, text: str(n.text ?? '', '요소 글자', 50_000),
      x: finite(n.x, '가로 위치', -DOCUMENT_LIMITS.coordinate, DOCUMENT_LIMITS.coordinate), y: finite(n.y, '세로 위치', -DOCUMENT_LIMITS.coordinate, DOCUMENT_LIMITS.coordinate),
      w: finite(n.w, '너비', 1, 100_000), h: finite(n.h, '높이', 1, 100_000),
      fill: color(n.fill, defaults.fill), stroke: color(n.stroke, defaults.stroke), color: color(n.color, defaults.color),
      fontSize: finite(n.fontSize ?? defaults.fontSize, '글자 크기', 6, 200), bold: flag(n.bold),
      align: oneOf(n.align ?? defaults.align, ['left', 'center', 'right'] as const, '글자 정렬'),
      strokeWidth: finite(n.strokeWidth ?? defaults.strokeWidth, '선 두께', 0, 50), dashed: flag(n.dashed), locked: flag(n.locked), opacity: finite(n.opacity ?? 1, '불투명도', 0, 1),
    };
    if (n.groupId !== undefined) node.groupId = id(n.groupId, '그룹');
    if (n.assetId !== undefined) {
      node.assetId = id(n.assetId, '이미지');
      if (!assets[node.assetId]) throw new Error('요소에서 참조한 이미지가 문서에 없습니다.');
    }
    if (kind === 'image' && !node.assetId) throw new Error('이미지 요소에 이미지 데이터가 없습니다.');
    if (n.points !== undefined) {
      if (!Array.isArray(n.points) || n.points.length > 100_000) throw new Error('자유선 점 목록이 올바르지 않거나 너무 큽니다.');
      node.points = n.points.map(p => { const point = record(p, '자유선 점'); return { x: finite(point.x, '자유선 가로 위치', -1_000_000, 1_000_000), y: finite(point.y, '자유선 세로 위치', -1_000_000, 1_000_000) }; });
    }
    Object.assign(node,validateNodeExtensions(n));
    return node;
  });
  const edgeIds = new Set<string>();
  const ports: readonly Port[] = ['top', 'right', 'bottom', 'left'];
  const edges: FlowEdge[] = raw.edges.map(value => {
    const e = record(value, '연결선'), edgeId = id(e.id, '연결선');
    if (edgeIds.has(edgeId) || nodeIds.has(edgeId)) throw new Error('중복된 연결선 식별자가 있습니다.');
    edgeIds.add(edgeId);
    const from = id(e.from, '연결 시작'), to = id(e.to, '연결 끝');
    if (!nodeIds.has(from) || !nodeIds.has(to)) throw new Error('연결선이 존재하지 않는 요소를 가리킵니다.');
    let waypoints;
    if(e.waypoints!==undefined){if(!Array.isArray(e.waypoints)||e.waypoints.length>32)throw new Error('경유점은 32개까지 사용할 수 있습니다.');waypoints=e.waypoints.map(p=>{const q=record(p,'경유점');return {x:finite(q.x,'경유점 X',-1000000,1000000),y:finite(q.y,'경유점 Y',-1000000,1000000)};});}
    return { ...validateEdgeExtensions(e), ...(waypoints?{waypoints}:{}), id: edgeId, from, to, fromPort: oneOf(e.fromPort ?? 'right', ports, '연결 시작점'), toPort: oneOf(e.toPort ?? 'left', ports, '연결 끝점'), label: str(e.label ?? '', '연결선 글자', 5_000), color: color(e.color, PALETTE.line), width: finite(e.width ?? 2, '연결선 두께', .5, 30), style: oneOf(e.style ?? 'elbow', ['elbow', 'straight', 'curve'] as const, '연결선 모양'), dashed: flag(e.dashed), arrow: oneOf(e.arrow ?? 'end', ['end', 'both', 'none'] as const, '화살표') };
  });
  const viewport = record(raw.viewport ?? { x: 80, y: 80, zoom: 1 }, '보기');
  if(edges.some(e=>e.condition&&!nodeIds.has(e.condition.nodeId)))throw new Error('연결 조건이 존재하지 않는 요소를 참조합니다.');
  const workspace=raw.workspace!==undefined?validateWorkspace(raw.workspace,nodes):undefined;
  if(!workspace&&nodes.some(n=>n.details?.attachmentIds?.length))throw new Error('요소가 참조하는 첨부 파일이 문서에 없습니다.');
  return { ...(workspace?{workspace}:{}), format: 'agentsketch', version: 1, title: str(raw.title ?? t('이름 없는 보드'), '보드 이름', 300), nodes, edges, assets, viewport: { x: finite(viewport.x, '보기 가로 위치', -10_000_000, 10_000_000), y: finite(viewport.y, '보기 세로 위치', -10_000_000, 10_000_000), zoom: finite(viewport.zoom, '보기 배율', .05, 8) } };
}

function selected(doc: FlowDocument, ids: Iterable<string>): FlowNode[] {
  const keys = new Set(ids); return doc.nodes.filter(n => keys.has(n.id) && !n.locked);
}

interface LayoutUnit extends Box { id: string; members: FlowNode[] }

/** A selected member represents its entire group. One locked member freezes the group. */
function layoutUnits(doc: FlowDocument, ids: Iterable<string>): LayoutUnit[] {
  const keys = new Set(ids);
  const selectedGroups = new Set(doc.nodes.filter(n => keys.has(n.id) && n.groupId).map(n => n.groupId!));
  const groups = new Map<string, FlowNode[]>();
  for (const node of doc.nodes) {
    if (!keys.has(node.id) && !(node.groupId && selectedGroups.has(node.groupId))) continue;
    const key = node.groupId ? `group:${node.groupId}` : `node:${node.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(node);
  }
  const units: LayoutUnit[] = [];
  for (const [id, members] of groups) {
    if (members.some(n => n.locked)) continue;
    units.push({ id, members, ...bounds(members) });
  }
  return units;
}

export function translateInternalRoutes(doc: FlowDocument, ids: Set<string>, dx: number, dy: number): void {
  for (const edge of doc.edges) if (edge.waypoints && ids.has(edge.from) && ids.has(edge.to)) {
    edge.waypoints = edge.waypoints.map(p => ({ x: p.x + dx, y: p.y + dy }));
  }
}

function moveUnit(doc: FlowDocument, unit: LayoutUnit, x: number, y: number): void {
  const dx = x - unit.x, dy = y - unit.y;
  translateInternalRoutes(doc, new Set(unit.members.map(n => n.id)), dx, dy);
  for (const node of unit.members) { node.x += dx; node.y += dy; }
  unit.x = x; unit.y = y;
}

export function duplicateSelection(doc: FlowDocument, ids: Iterable<string>, offset = 24): string[] {
  const keys = new Set(ids), mapping = new Map<string, string>(), groups = new Map<string, string>();
  const sourceGroups=new Map(doc.workspace?.groups?.map(g=>[g.id,g])??[]);
  for(const node of doc.nodes)if(keys.has(node.id)&&node.groupId){
    let current:string|undefined=node.groupId;
    while(current&&!groups.has(current)){groups.set(current,uid());current=sourceGroups.get(current)?.parentId;}
  }
  const copies = doc.nodes.filter(n => keys.has(n.id)).map(n => {
    const nextId = uid(); mapping.set(n.id, nextId);
    const copy=cloneNode(n);copy.id=nextId;copy.x+=offset;copy.y+=offset;copy.locked=false;
    if(n.groupId)copy.groupId=groups.get(n.groupId);
    if(copy.details?.checklist)copy.details.checklist=copy.details.checklist.map(c=>({...c,id:uid()}));
    return copy;
  });
  doc.nodes.push(...copies);
  doc.edges.push(...doc.edges.filter(e => mapping.has(e.from) && mapping.has(e.to)).map(e => ({ ...cloneEdge(e), id: uid(), from: mapping.get(e.from)!, to: mapping.get(e.to)!, ...(e.waypoints?{waypoints:e.waypoints.map(p=>({x:p.x+offset,y:p.y+offset}))}:{}),...(e.condition?{condition:{...e.condition,nodeId:mapping.get(e.condition.nodeId)??e.condition.nodeId}}:{}) })));
  if(doc.workspace?.groups){for(const [oldId,newId] of groups){const group=sourceGroups.get(oldId);if(group)doc.workspace.groups.push({...group,id:newId,...(group.parentId?{parentId:groups.get(group.parentId)??group.parentId}:{})});}}
  return copies.map(n => n.id);
}

export function removeSelection(doc: FlowDocument, ids: Iterable<string>): void {
  const keys = new Set(selected(doc, ids).map(n => n.id));
  if(doc.edges.some(e=>e.condition&&keys.has(e.condition.nodeId)&&!keys.has(e.from)&&!keys.has(e.to)))throw new Error('다른 연결선의 조건이 이 요소를 참조합니다. 조건을 변경하거나 해당 연결선을 먼저 삭제하세요.');
  doc.nodes = doc.nodes.filter(n => !keys.has(n.id));
  doc.edges = doc.edges.filter(e => !keys.has(e.from) && !keys.has(e.to));
  if(doc.workspace?.comments)doc.workspace.comments=doc.workspace.comments.filter(c=>!c.nodeId||!keys.has(c.nodeId));
  if(doc.workspace?.bookmarks)doc.workspace.bookmarks=doc.workspace.bookmarks.filter(b=>!b.nodeId||!keys.has(b.nodeId));
  const used = new Set(doc.nodes.map(n => n.assetId).filter(Boolean));
  doc.assets = Object.fromEntries(Object.entries(doc.assets).filter(([key]) => used.has(key)));
}

export type Alignment = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';
export function alignNodes(doc: FlowDocument, ids: Iterable<string>, mode: Alignment): void {
  const units = layoutUnits(doc, ids); if (units.length < 2) return;
  const box = bounds(units);
  for (const unit of units) {
    let x = unit.x, y = unit.y;
    if (mode === 'left') x = box.x;
    else if (mode === 'right') x = box.x + box.w - unit.w;
    else if (mode === 'top') y = box.y;
    else if (mode === 'bottom') y = box.y + box.h - unit.h;
    else if (mode === 'centerX') x = box.x + (box.w - unit.w) / 2;
    else if (mode === 'centerY') y = box.y + (box.h - unit.h) / 2;
    moveUnit(doc, unit, x, y);
  }
}

export function distributeNodes(doc: FlowDocument, ids: Iterable<string>, direction: 'horizontal' | 'vertical'): void {
  const units = layoutUnits(doc, ids); if (units.length < 3) return;
  const horizontal = direction === 'horizontal', axis = horizontal ? 'x' : 'y', size = horizontal ? 'w' : 'h';
  units.sort((a, b) => a[axis] - b[axis]);
  const first = units[0][axis], last = units[units.length - 1];
  const gap = (last[axis] + last[size] - first - units.reduce((sum, n) => sum + n[size], 0)) / (units.length - 1);
  let cursor = first;
  for (const unit of units) { moveUnit(doc, unit, horizontal ? cursor : unit.x, horizontal ? unit.y : cursor); cursor += unit[size] + gap; }
}

export function groupNodes(doc: FlowDocument, ids: Iterable<string>): string | null {
  const nodes = selected(doc, ids); if (nodes.length < 2) return null;
  const group = uid(); for (const node of nodes) node.groupId = group;
  return group;
}
export function ungroupNodes(doc: FlowDocument, ids: Iterable<string>): void {
  const nodes = selected(doc, ids), groups = new Set(nodes.map(n => n.groupId).filter(Boolean));
  for (const node of doc.nodes) if (!node.locked && node.groupId && groups.has(node.groupId)) delete node.groupId;
}

export function autoLayout(doc: FlowDocument, ids?: Iterable<string>, direction: 'horizontal' | 'vertical' = 'horizontal'): void {
  const keys = ids ? new Set(ids) : new Set(doc.nodes.filter(n => n.groupId || (n.kind !== 'frame' && n.kind !== 'text')).map(n => n.id));
  const units = layoutUnits(doc, keys); if (!units.length) return;
  const owner = new Map(units.flatMap(unit => unit.members.map(node => [node.id, unit.id] as const)));
  const adjacency = new Map(units.map(unit => [unit.id, [] as string[]]));
  const reverse = new Map(units.map(unit => [unit.id, [] as string[]]));
  for (const edge of doc.edges) {
    const from = owner.get(edge.from), to = owner.get(edge.to);
    if (from && to && from !== to) { adjacency.get(from)!.push(to); reverse.get(to)!.push(from); }
  }
  // Iterative Kosaraju avoids call-stack limits on large boards and preserves cycles.
  const visited = new Set<string>(), order: string[] = [];
  for (const node of units) {
    if (visited.has(node.id)) continue;
    const stack: [string, boolean][] = [[node.id, false]];
    while (stack.length) {
      const [key, done] = stack.pop()!;
      if (done) { order.push(key); continue; }
      if (visited.has(key)) continue;
      visited.add(key); stack.push([key, true]);
      for (const to of adjacency.get(key)!) if (!visited.has(to)) stack.push([to, false]);
    }
  }
  const component = new Map<string, number>(), components: string[][] = [];
  for (let i = order.length - 1; i >= 0; i--) {
    const key = order[i]; if (component.has(key)) continue;
    const index = components.length, members: string[] = [], stack = [key];
    component.set(key, index);
    while (stack.length) {
      const current = stack.pop()!; members.push(current);
      for (const from of reverse.get(current)!) if (!component.has(from)) { component.set(from, index); stack.push(from); }
    }
    components.push(members);
  }
  const componentEdges = components.map(() => new Set<number>()), indegree = components.map(() => 0), rank = components.map(() => 0);
  for (const [from, targets] of adjacency) for (const to of targets) {
    const a = component.get(from)!, b = component.get(to)!;
    if (a !== b && !componentEdges[a].has(b)) { componentEdges[a].add(b); indegree[b]++; }
  }
  const queue = indegree.flatMap((value, index) => value === 0 ? [index] : []);
  for (let q = 0; q < queue.length; q++) for (const target of componentEdges[queue[q]]) {
    rank[target] = Math.max(rank[target], rank[queue[q]] + 1);
    if (--indegree[target] === 0) queue.push(target);
  }
  const layers = new Map<number, LayoutUnit[]>();
  // Original order within each rank makes layout predictable between runs.
  for (const node of units) {
    const layer = rank[component.get(node.id)!];
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer)!.push(node);
  }
  const origin = bounds(units), horizontal = direction === 'horizontal';
  const along = horizontal ? 'x' : 'y', cross = horizontal ? 'y' : 'x', alongSize = horizontal ? 'w' : 'h', crossSize = horizontal ? 'h' : 'w';
  let position = origin[along];
  for (const [, layer] of [...layers.entries()].sort(([a], [b]) => a - b)) {
    let crossPosition = origin[cross];
    let widest = 0;
    for (const unit of layer) {
      moveUnit(doc, unit, horizontal ? position : crossPosition, horizontal ? crossPosition : position);
      crossPosition += unit[crossSize] + 48; widest = Math.max(widest, unit[alongSize]);
    }
    position += widest + 130;
  }
  for (const edge of doc.edges) {
    const from = owner.get(edge.from), to = owner.get(edge.to);
    if (from && to && from !== to) { delete edge.waypoints; edge.fromPort = horizontal ? 'right' : 'bottom'; edge.toPort = horizontal ? 'left' : 'top'; }
  }
}
