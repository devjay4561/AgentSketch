import './style.css';
import {installAutomation} from './automation-client.ts';
import {runCommandInPlace,CommandError} from './commands.ts';
import {mountDocumentTabs} from './document-tabs.ts';
import type {WorkbenchHost} from './workspace-types.ts';
import {mountWorkbench} from './workbench.ts';
import {projectVisibleDocument,editableNodeIds,groupMembers,topGroupId,DEFAULT_PAGE,createGroup,ungroup,reparentDroppedNodes} from './organization.ts';
import {applyNodeDefaults,applyEdgeDefaults} from './style-defaults.ts';
import {addNextStep,splitConnection} from './diagram-actions.ts';
import {setNodePlainText} from './rich-text.ts';
import {compareDocuments} from './review-model.ts';
import {cloneNode,cloneEdge,cloneWorkspace} from './model.ts';
import type { Asset, Box, FlowDocument, FlowEdge, FlowNode, Point, Port, RenderState, Tool } from './types.ts';
import { History, cloneDocument, createNode, emptyDocument, uid, duplicateSelection, removeSelection, alignNodes, distributeNodes, autoLayout, validateDocument, translateInternalRoutes } from './model.ts';
import { bounds, contains, intersects, portPoint, edgePoints, distanceToSegment, prepareRoutes, routeHandles } from './geometry.ts';
import { createSample } from './sample.ts';
import { Renderer, drawMinimap } from './renderer.ts';
import { isNative, openDocument, saveDocument, autosave, loadAutosave, exportFile, importImages } from './persistence.ts';
import { icon } from './icons.ts';
import { FONT_FAMILY, PALETTE } from './theme.ts';
import { setupUIFeedback } from './ui-feedback.ts';
import { installDomTranslation, lang, setLang, t, formatShortcutLabel } from './i18n.ts';

installDomTranslation();
setupUIFeedback();
// The native window title is set by Go before the page loads.
if (lang === 'en') (window as any).runtime?.WindowSetTitle?.(t('AgentSketch · 흐름을 한 장에'));
(window as any).go?.main?.App?.SetLanguage?.(lang);
{ const b = document.querySelector<HTMLElement>('[data-action="language"] span:last-child'); if (b) b.textContent = lang === 'ko' ? 'English' : '한국어'; }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('board');
const wrap = $('canvas-wrap');
const textEditor = $<HTMLTextAreaElement>('text-editor');
const ports: Port[] = ['top', 'right', 'bottom', 'left'];
const escapeHTML = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const history = new History(60);
let doc = emptyDocument();
let selected = new Set<string>();
let selectedEdge: string | null = null;
let currentTool: Tool = 'select';
let grid = true, snap = true, space = false, dirty = false, filePath = '';
let marquee: Box | undefined;
let guides: RenderState['guides'];
let reconnecting: {from:Point;to:Point}|undefined;
let connecting: { node: string; port: Port; to: Point } | null = null;
let editing: string | null = null;
let scheduled = false, saveTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let clipboard: { nodes: FlowNode[]; edges: FlowEdge[]; assets: Record<string, Asset>; workspace?:FlowDocument['workspace'] } | null = null;
let copiedText = '';
let cursor: Point = { x: 400, y: 300 };
let tabs:ReturnType<typeof mountDocumentTabs>|undefined;
let workbench:ReturnType<typeof mountWorkbench>|undefined;
let pathChange:Promise<unknown>=Promise.resolve();
let booting = true, revision = 0, operationBusy = false;
let lastSavedRecovery = 0;
let aiChanged = new Set<string>(), aiTimer: ReturnType<typeof setTimeout> | undefined, aiFollow = localStorage.getItem('agentsketch.ai-follow') !== '0';
type Gesture = {
  kind: 'pan' | 'move' | 'resize' | 'marquee' | 'create' | 'draw' | 'connect' | 'route' | 'reconnect';
  start: Point; screen: Point; before: FlowDocument;
  positions?: { id: string; x: number; y: number }[];
  side?:'from'|'to'; edgeId?: string; waypoint?: number; insertWaypoint?: boolean; nodeId?: string; corner?: number; original?: FlowNode;
  moved: boolean; initialSelection?: Set<string>;
};
let gesture: Gesture | null = null;
const renderer = new Renderer(canvas, invalidate);

function toast(message: string, error = false) {
  const el = $('toast'); el.textContent = formatShortcutLabel(message); el.classList.toggle('error', error);
  el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, error ? 6500 : 3300);
}
function setStatus(message: string) { $('save-status').textContent = formatShortcutLabel(message); }
function screenPoint(e: { clientX: number; clientY: number }): Point {
  const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function worldPoint(e: { clientX: number; clientY: number }): Point {
  const p = screenPoint(e), v = doc.viewport; return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
}
function center(): Point { return { x: (canvas.clientWidth / 2 - doc.viewport.x) / doc.viewport.zoom, y: (canvas.clientHeight / 2 - doc.viewport.y) / doc.viewport.zoom }; }
function invalidate() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const startNode = connecting ? doc.nodes.find(n => n.id === connecting!.node) : undefined;
    if (connecting && !startNode) connecting = null;
    const view=projectVisibleDocument(doc);
    renderer.render({ doc:view, selection: selected, edgeSelection: selectedEdge, grid, marquee, guides, remote: aiChanged, connection: reconnecting ?? (connecting && startNode ? { from: portPoint(startNode, connecting.port), to: connecting.to } : undefined) });
    const warning = $('route-warning');
    warning.hidden = renderer.blockedEdges.length === 0;
    warning.textContent = `경로 없음 ${renderer.blockedEdges.length}개 · 확인`;
    const minimap = $<HTMLCanvasElement>('minimap');
    if (minimap && !minimap.hidden) drawMinimap(minimap, view, canvas.clientWidth, canvas.clientHeight);
    $('zoom-value').textContent = `${Math.round(doc.viewport.zoom * 100)}%`;
    positionEditor();
  });
}
function changed(message?: string) {
  revision++; dirty = true; updateUI(); invalidate(); queueRecovery();
  if (message) toast(message);
}
function queueRecovery() {
  clearTimeout(saveTimer);
  if (booting) return;
  setStatus('변경사항 저장 중…');
  saveTimer = setTimeout(() => { void flushRecovery(); }, 650);
}
async function flushRecovery() {
  clearTimeout(saveTimer);
  const savedRevision = revision;
  try { await pathChange; await autosave(doc,filePath); lastSavedRecovery = savedRevision; if (savedRevision === revision) setStatus(filePath ? '자동 복구 저장됨 · 파일 저장 Ctrl+S' : '이 PC에 자동 복구 저장됨'); }
  catch (error) { setStatus('자동 복구 저장 실패'); toast(`자동 복구를 저장하지 못했습니다. Ctrl+S로 파일을 저장하세요. ${String(error)}`, true); }
}
function mutate(action: () => void, message?: string) { finishEdit(); const before=cloneDocument(doc),ids=new Set(selected),edge=selectedEdge;try{action();}catch(error){doc=before;selected=ids;selectedEdge=edge;updateUI();invalidate();toast(String(error),true);return;}history.push(before);changed(message); }
// Show an external agent's edit like a co-editor's: tag changed items briefly and bring them into view.
function aiCommit(next: FlowDocument) {
  // Compare with the normalized current document; raw sample/legacy nodes lack fields validation fills in.
  const touched = new Set(compareDocuments(validateDocument(cloneDocument(doc)), next).changes.filter(c => c.change !== 'removed').map(c => c.id));
  const nodes = next.nodes.filter(n => touched.has(n.id)), edges = next.edges.filter(e => touched.has(e.id));
  mutate(() => {
    doc = next; for (const id of [...selected]) if (!doc.nodes.some(n => n.id === id)) selected.delete(id); if (selectedEdge && !doc.edges.some(e => e.id === selectedEdge)) selectedEdge = null;
    const ends = new Set(edges.flatMap(e => [e.from, e.to])), focus = projectVisibleDocument(doc).nodes.filter(n => nodes.some(c => c.id === n.id) || ends.has(n.id));
    if (aiFollow && focus.length) {
      // Pan inside the commit so the revision returned to the agent already includes the new viewport.
      const b = bounds(focus), v = doc.viewport, view = { x: -v.x / v.zoom, y: -v.y / v.zoom, w: canvas.clientWidth / v.zoom, h: canvas.clientHeight / v.zoom };
      if (b.x < view.x || b.y < view.y || b.x + b.w > view.x + view.w || b.y + b.h > view.y + view.h) { v.x = canvas.clientWidth / 2 - (b.x + b.w / 2) * v.zoom; v.y = canvas.clientHeight / 2 - (b.y + b.h / 2) * v.zoom; }
    }
  });
  aiChanged = new Set([...nodes.map(n => n.id), ...edges.map(e => e.id)]); clearTimeout(aiTimer);
  aiTimer = setTimeout(() => { aiChanged = new Set(); invalidate(); }, 2500); invalidate();
}
function selectedNodes() { return doc.nodes.filter(n => selected.has(n.id)); }
function editableNodes() { const ids=editableNodeIds(doc);return selectedNodes().filter(n => ids.has(n.id)); }
function select(ids: Iterable<string>, edge: string | null = null) { selected = new Set(ids); selectedEdge = edge; updateUI(); invalidate(); }
function expandGroup(n: FlowNode): string[] { return n.groupId ? groupMembers(doc,topGroupId(doc,n.groupId)).map(m => m.id) : [n.id]; }
function hitNode(p: Point): FlowNode | undefined {
  return [...projectVisibleDocument(doc).nodes].reverse().find(n => {
    if (!contains(p, n)) return false;
    if (n.kind !== 'frame') return true;
    return p.y - n.y < 38 || Math.min(p.x - n.x, n.x + n.w - p.x, n.y + n.h - p.y) < 10 / doc.viewport.zoom;
  });
}
function hitEdge(p: Point) {
  const view=projectVisibleDocument(doc); const index = new Map(view.nodes.map(n=>[n.id,n])); prepareRoutes(view,index);
  return [...view.edges].reverse().find(e => {
    const ps = edgePoints(e, view, index); return ps.some((q, i) => i > 0 && distanceToSegment(p, ps[i - 1], q) < 8 / doc.viewport.zoom);
  });
}
function nearestPort(n: FlowNode, p: Point): Port {
  return [...ports].sort((a, b) => { const x = portPoint(n, a), y = portPoint(n, b); return Math.hypot(p.x - x.x, p.y - x.y) - Math.hypot(p.x - y.x, p.y - y.y); })[0];
}
function hitPort(p: Point): { node: FlowNode; port: Port } | null {
  for (const n of selectedNodes()) for (const port of ports) { const t = portPoint(n, port); if (Math.hypot(t.x - p.x, t.y - p.y) < 10 / doc.viewport.zoom) return { node: n, port }; }
  return null;
}
function resizeCorner(p: Point): { node: FlowNode; corner: number } | null {
  if (selected.size !== 1) return null;
  const n = selectedNodes()[0]; if (!n || !editableNodeIds(doc).has(n.id)) return null;
  const corners = [{ x: n.x, y: n.y }, { x: n.x + n.w, y: n.y }, { x: n.x + n.w, y: n.y + n.h }, { x: n.x, y: n.y + n.h }];
  const corner = corners.findIndex(c => Math.hypot(c.x - p.x, c.y - p.y) < 10 / doc.viewport.zoom);
  return corner < 0 ? null : { node: n, corner };
}
function setTool(tool: Tool) {
  finishEdit(); currentTool = tool; connecting = null;
  canvas.style.cursor = tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(el => { const active = el.dataset.tool === tool; el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active)); });
  const hints: Partial<Record<Tool, string>> = { select: '선택하고, 자유롭게 연결하세요', hand: '드래그해서 작업지를 이동하세요', connect: '시작 요소와 도착 요소를 차례로 선택하세요', text: '클릭하거나 드래그해서 글을 놓으세요', draw: '드래그해서 자유롭게 그리세요', frame: '함께 묶을 영역을 드래그하세요' };
  $('tool-hint').textContent = hints[tool] ?? '클릭하거나 드래그해서 도형을 놓으세요';
  invalidate();
}
function zoomAt(amount: number, screen = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }) {
  const v = doc.viewport, z = Math.max(.1, Math.min(4, amount)), x = (screen.x - v.x) / v.zoom, y = (screen.y - v.y) / v.zoom;
  v.zoom = z; v.x = screen.x - x * z; v.y = screen.y - y * z; invalidate(); queueRecovery();
}
function fit(nodes = projectVisibleDocument(doc).nodes) {
  if (!nodes.length) { doc.viewport = { x: 80, y: 80, zoom: 1 }; invalidate(); return; }
  const b = bounds(nodes), width = canvas.clientWidth, height = canvas.clientHeight;
  const z = Math.max(.1, Math.min(1.2, (width - 110) / Math.max(b.w, 1), (height - 110) / Math.max(b.h, 1)));
  doc.viewport = { x: width / 2 - (b.x + b.w / 2) * z, y: height / 2 - (b.y + b.h / 2) * z, zoom: z }; invalidate(); queueRecovery();
}
function attach(from: string, to: string, fromPort: Port, toPort: Port) {
  if (from === to) { toast('서로 다른 두 요소를 연결하세요.'); return; }
  if (doc.edges.some(e => e.from === from && e.to === to && e.fromPort === fromPort && e.toPort === toPort)) { toast('같은 연결선이 이미 있습니다.'); return; }
  history.push(doc);
  const edge: FlowEdge = { id: uid(), from, to, fromPort, toPort, label: '', color: PALETTE.line, width: 2, style: 'elbow', dashed: false, arrow: 'end' };
  applyEdgeDefaults(edge);doc.edges.push(edge); selectedEdge = edge.id; selected.clear(); changed('연결선을 추가했습니다. 오른쪽에서 이름을 적을 수 있습니다.');
}

canvas.addEventListener('pointerdown', e => {
  if (e.button === 2) return;
  finishEdit(); $('context-menu').hidden = true; canvas.focus();
  const p = worldPoint(e), s = screenPoint(e); cursor = p;
  if (e.button === 1 || space || currentTool === 'hand') {
    gesture = { kind: 'pan', start: { x: doc.viewport.x, y: doc.viewport.y }, screen: s, before: cloneDocument(doc), moved: false };
    canvas.style.cursor = 'grabbing'; canvas.setPointerCapture(e.pointerId); e.preventDefault(); return;
  }
  if (e.button !== 0) return;
  if(currentTool==='select' && selectedEdge){
    const edge=doc.edges.find(e=>e.id===selectedEdge)!;
    const view=projectVisibleDocument(doc), visibleEdge=view.edges.find(e=>e.id===edge.id);
    if(visibleEdge&&visibleEdge.from===edge.from&&visibleEdge.to===edge.to){
      const points=edgePoints(visibleEdge,view);const side=points.length&&Math.hypot(points[0].x-p.x,points[0].y-p.y)<9/doc.viewport.zoom?'from':points.length&&Math.hypot(points.at(-1)!.x-p.x,points.at(-1)!.y-p.y)<9/doc.viewport.zoom?'to':undefined;
      if(side){gesture={kind:'reconnect',start:p,screen:s,before:cloneDocument(doc),edgeId:edge.id,side,moved:false};canvas.setPointerCapture(e.pointerId);return;}
    }
    if(edge.style==='elbow'&&visibleEdge&&visibleEdge.from===edge.from&&visibleEdge.to===edge.to){
      const handle=routeHandles(edge,edgePoints(edge,doc)).find(h=>Math.hypot(h.point.x-p.x,h.point.y-p.y)<10/doc.viewport.zoom);
      if(handle){gesture={kind:'route',start:p,screen:s,before:cloneDocument(doc),edgeId:edge.id,waypoint:handle.waypoint,insertWaypoint:handle.insert,moved:false};canvas.setPointerCapture(e.pointerId);return;}
    }
  }
  const corner = currentTool === 'select' ? resizeCorner(p) : null;
  const port = currentTool === 'select' ? hitPort(p) : null;
  const node = hitNode(p);
  if (corner) {
    gesture = { kind: 'resize', start: p, screen: s, before: cloneDocument(doc), original: { ...corner.node, points: corner.node.points?.map(p => ({ ...p })) }, nodeId: corner.node.id, corner: corner.corner, moved: false };
  } else if (port || currentTool === 'connect') {
    if (connecting && node && currentTool === 'connect') { attach(connecting.node, node.id, connecting.port, nearestPort(node, p)); connecting = null; invalidate(); return; }
    if (port || node) {
      const n = port?.node || node!; connecting = { node: n.id, port: port?.port || nearestPort(n, p), to: p };
      gesture = { kind: 'connect', start: p, screen: s, before: cloneDocument(doc), moved: false };
      if (currentTool === 'connect') toast('다음 요소를 클릭하거나 끌어서 연결하세요.');
    } else { connecting = null; invalidate(); }
  } else if (currentTool !== 'select') {
    const before = cloneDocument(doc), n = createNode(currentTool, p.x, p.y);
    applyNodeDefaults(n);if(doc.workspace)n.details={pageId:doc.workspace.activePageId??DEFAULT_PAGE};
    if (currentTool === 'draw') { n.points = [{ x: 0, y: 0 }]; n.w = 1; n.h = 1; n.fill = 'transparent'; n.text = ''; }
    if (currentTool === 'frame') doc.nodes.unshift(n); else doc.nodes.push(n);
    selected = new Set([n.id]); selectedEdge = null;
    gesture = { kind: currentTool === 'draw' ? 'draw' : 'create', start: p, screen: s, before, nodeId: n.id, moved: false };
    invalidate();
  } else if (node) {
    if (e.shiftKey) { const ids = expandGroup(node); if (selected.has(node.id)) ids.forEach(id => selected.delete(id)); else ids.forEach(id => selected.add(id)); }
    else if (!selected.has(node.id)) selected = new Set(expandGroup(node));
    selectedEdge = null;
    if (selected.has(node.id) && editableNodeIds(doc).has(node.id)) {
      const moving = new Set(selected);
      for (const frame of selectedNodes().filter(n => n.kind === 'frame')) doc.nodes.forEach(n => { if (n.id !== frame.id && n.x >= frame.x && n.y >= frame.y && n.x + n.w <= frame.x + frame.w && n.y + n.h <= frame.y + frame.h) moving.add(n.id); });
      const editable=editableNodeIds(doc);
      const positions = doc.nodes.filter(n => moving.has(n.id) && editable.has(n.id)).map(n => ({ id: n.id, x: n.x, y: n.y }));
      gesture = { kind: 'move', start: p, screen: s, before: cloneDocument(doc), positions, moved: false };
    }
    updateUI(); invalidate();
  } else {
    const edge = hitEdge(p);
    if (edge) { select([], edge.id); return; }
    if (!e.shiftKey) select([]);
    marquee = { ...p, w: 0, h: 0 }; gesture = { kind: 'marquee', start: p, screen: s, before: cloneDocument(doc), initialSelection: new Set(selected), moved: false };
  }
  if (gesture) canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', e => {
  const p = worldPoint(e), s = screenPoint(e); cursor = p;
  if (connecting) { connecting.to = p; invalidate(); }
  if (!gesture) {
    if (currentTool === 'select' && !space) { const h = resizeCorner(p); canvas.style.cursor = h ? (h.corner % 2 ? 'nesw-resize' : 'nwse-resize') : hitPort(p) ? 'crosshair' : hitNode(p) ? 'move' : 'default'; }
    return;
  }
  const g = gesture; if (Math.hypot(s.x - g.screen.x, s.y - g.screen.y) > 3) g.moved = true;
  if(g.kind==='reconnect'&&g.moved){const edge=g.before.edges.find(e=>e.id===g.edgeId)!;const points=edgePoints(edge,g.before);if(points.length)reconnecting={from:g.side==='from'?points.at(-1)!:points[0],to:p};}
  if(g.kind==='route'&&g.moved){
    const edge=doc.edges.find(e=>e.id===g.edgeId)!;const before=g.before.edges.find(e=>e.id===g.edgeId)!;
    const points=before.waypoints?.map(q=>({...q}))??[];
    if(g.insertWaypoint)points.splice(g.waypoint!,0,{...p});else points[g.waypoint!]={...p};
    const previous=edge.waypoints; edge.waypoints=points;
    if(!edgePoints(edge,doc).length)edge.waypoints=previous;
  }
  if (g.kind === 'pan') { doc.viewport.x = g.start.x + s.x - g.screen.x; doc.viewport.y = g.start.y + s.y - g.screen.y; }
  if (g.kind === 'move' && g.moved && g.positions?.length) {
    let dx = p.x - g.start.x, dy = p.y - g.start.y; guides = [];
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const moving = new Set(g.positions.map(n => n.id));
    const original = g.before.nodes.filter(n => moving.has(n.id)), b = bounds(original);
    if (snap && !e.altKey) {
      const threshold = 7 / doc.viewport.zoom;
      let bestX = threshold, bestY = threshold, fixX = 0, fixY = 0, lineX: number | undefined, lineY: number | undefined;
      for (const n of doc.nodes) { if (moving.has(n.id) || n.kind === 'frame') continue;
        for (const x of [n.x, n.x + n.w / 2, n.x + n.w]) for (const own of [b.x + dx, b.x + b.w / 2 + dx, b.x + b.w + dx]) { const diff = x - own; if (Math.abs(diff) < bestX) { bestX = Math.abs(diff); fixX = diff; lineX = x; } }
        for (const y of [n.y, n.y + n.h / 2, n.y + n.h]) for (const own of [b.y + dy, b.y + b.h / 2 + dy, b.y + b.h + dy]) { const diff = y - own; if (Math.abs(diff) < bestY) { bestY = Math.abs(diff); fixY = diff; lineY = y; } }
      }
      if (lineX !== undefined) { dx += fixX; guides.push({ axis: 'x', value: lineX }); } else dx = Math.round((b.x + dx) / 10) * 10 - b.x;
      if (lineY !== undefined) { dy += fixY; guides.push({ axis: 'y', value: lineY }); } else dy = Math.round((b.y + dy) / 10) * 10 - b.y;
      if (e.shiftKey) { if (Math.abs(p.x - g.start.x) > Math.abs(p.y - g.start.y)) dy = 0; else dx = 0; }
    }
    for(const edge of doc.edges){if(moving.has(edge.from)&&moving.has(edge.to)){const old=g.before.edges.find(e=>e.id===edge.id);if(old?.waypoints)edge.waypoints=old.waypoints.map(q=>({x:q.x+dx,y:q.y+dy}));}}
    for (const original of g.positions) { const n = doc.nodes.find(n => n.id === original.id)!; n.x = original.x + dx; n.y = original.y + dy; }
  }
  if (g.kind === 'resize' && g.original && g.moved) {
    const n = doc.nodes.find(n => n.id === g.nodeId)!, o = g.original, c = g.corner!;
    const right = c === 1 || c === 2, bottom = c >= 2;
    let w = Math.max(30, o.w + (p.x - g.start.x) * (right ? 1 : -1)), h = Math.max(24, o.h + (p.y - g.start.y) * (bottom ? 1 : -1));
    if (snap && !e.altKey) { w = Math.max(30, Math.round(w / 10) * 10); h = Math.max(24, Math.round(h / 10) * 10); }
    if (e.shiftKey || (n.kind === 'image' && !e.altKey)) { const ratio = o.w / o.h; if (Math.abs(w - o.w) > Math.abs(h - o.h)) h = w / ratio; else w = h * ratio; }
    n.x = right ? o.x : o.x + o.w - w; n.y = bottom ? o.y : o.y + o.h - h; n.w = w; n.h = h;
    if (o.points) n.points = o.points.map(q => ({ x: q.x * w / o.w, y: q.y * h / o.h }));
  }
  if (g.kind === 'create' && g.moved) {
    const n = doc.nodes.find(n => n.id === g.nodeId)!; let w = Math.abs(p.x - g.start.x), h = Math.abs(p.y - g.start.y);
    if (e.shiftKey) w = h = Math.max(w, h);
    n.x = p.x < g.start.x ? g.start.x - w : g.start.x; n.y = p.y < g.start.y ? g.start.y - h : g.start.y; n.w = Math.max(30, w); n.h = Math.max(24, h);
  }
  if (g.kind === 'draw') {
    const n = doc.nodes.find(n => n.id === g.nodeId)!, points = n.points!, q = { x: p.x - n.x, y: p.y - n.y }, last = points[points.length - 1];
    if (Math.hypot(q.x - last.x, q.y - last.y) > 2 / doc.viewport.zoom && points.length < 6000) points.push(q);
    n.w = Math.max(1, ...points.map(q => q.x)); n.h = Math.max(1, ...points.map(q => q.y));
  }
  if (g.kind === 'marquee') { marquee = { x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), w: Math.abs(p.x - g.start.x), h: Math.abs(p.y - g.start.y) }; }
  invalidate();
});

function endGesture(e: PointerEvent, canceled = false) {
  if (!gesture) return;
  const g = gesture; gesture = null;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  if (canceled) { doc = g.before; reconnecting=undefined; connecting = null; marquee = undefined; guides = undefined; updateUI(); invalidate(); return; }
  if(g.kind==='reconnect'){
    reconnecting=undefined;const target=hitNode(worldPoint(e)),edge=doc.edges.find(e=>e.id===g.edgeId);
    if(g.moved&&target&&edge&&target.id!==(g.side==='from'?edge.to:edge.from)){history.push(g.before);if(g.side==='from'){edge.from=target.id;edge.fromPort=nearestPort(target,worldPoint(e));delete edge.fromAnchor;}else{edge.to=target.id;edge.toPort=nearestPort(target,worldPoint(e));delete edge.toAnchor;}delete edge.waypoints;changed('연결 끝점을 바꿨습니다.');}else invalidate();return;
  }
  if (g.kind === 'connect') {
    const node = hitNode(worldPoint(e));
    if (g.moved && node && connecting) { attach(connecting.node, node.id, connecting.port, nearestPort(node, worldPoint(e))); connecting = null; }
    else if (currentTool !== 'connect') connecting = null;
  } else if (g.kind === 'marquee') {
    const ids = new Set(g.initialSelection),editable=editableNodeIds(doc); if (g.moved && marquee) projectVisibleDocument(doc).nodes.filter(n => editable.has(n.id) && n.kind !== 'frame' && intersects(n, marquee!)).forEach(n => expandGroup(n).forEach(id => ids.add(id)));
    selected = ids; marquee = undefined; updateUI();
  } else if (g.kind === 'pan') { queueRecovery(); }
  else if (g.moved || g.kind === 'create' || g.kind === 'draw') {
    if (g.kind === 'draw') {
      const n = doc.nodes.find(n => n.id === g.nodeId)!;
      if (!g.moved) { doc = g.before; selected.clear(); updateUI(); invalidate(); return; }
      const points = n.points!, minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y)), maxX = Math.max(...points.map(p => p.x)), maxY = Math.max(...points.map(p => p.y));
      n.x += minX; n.y += minY; n.w = Math.max(1, maxX - minX); n.h = Math.max(1, maxY - minY); n.points = points.map(p => ({ x: p.x - minX, y: p.y - minY }));
    }
    if(g.kind==='move'&&e.altKey&&g.positions?.length){
      const moving=new Set(g.positions.map(n=>n.id));const p=worldPoint(e);
      const target=[...projectVisibleDocument(doc).nodes].reverse().find(n=>!moving.has(n.id)&&n.groupId&&contains(p,n));
      try{reparentDroppedNodes(doc,moving,target?.groupId);}catch(error){toast(String(error),true);}
    }
    if((g.kind==='move'&&g.positions?.length===1||g.kind==='create')&&!e.altKey){
      const id=g.nodeId??g.positions?.[0].id,node=doc.nodes.find(n=>n.id===id);
      if(node&&node.kind!=='frame'&&node.kind!=='draw'&&!doc.edges.some(edge=>edge.from===id||edge.to===id)){
        const p=worldPoint(e),edge=g.before.edges.find(edge=>edgePoints(edge,g.before).some((q,i,points)=>i>0&&distanceToSegment(p,points[i-1],q)<9/doc.viewport.zoom));
        if(edge)try{splitConnection(doc,edge.id,node.id);toast('연결선 사이에 단계를 넣었습니다. 수동 경로는 다시 계산합니다.');}catch(error){toast(String(error),true);}
      }
    }
    history.push(g.before); changed();
    if (g.kind === 'create') { const n = doc.nodes.find(n => n.id === g.nodeId)!; setTool('select'); if (n.kind === 'text' || n.kind === 'note') beginEdit(n); }
  }
  guides = undefined; canvas.style.cursor = currentTool === 'hand' || space ? 'grab' : currentTool === 'select' ? 'default' : 'crosshair'; invalidate();
}
canvas.addEventListener('pointerup', e => endGesture(e));
canvas.addEventListener('pointercancel', e => endGesture(e, true));
canvas.addEventListener('wheel', e => {
  e.preventDefault(); finishEdit();
  if (e.shiftKey) { doc.viewport.x -= e.deltaY; doc.viewport.y -= e.deltaX; invalidate(); queueRecovery(); }
  else zoomAt(doc.viewport.zoom * Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * .0018), screenPoint(e));
}, { passive: false });
canvas.addEventListener('dblclick', e => {
  const node = hitNode(worldPoint(e)); if(node?.details?.documentPath){void openLinkedCard(node);return;} if (node && !node.locked && node.kind !== 'draw') beginEdit(node);
  else { const edge = hitEdge(worldPoint(e)); if (edge) { select([], edge.id); $<HTMLInputElement>('edge-label').focus(); } }
});

async function openLinkedCard(node:FlowNode){
  const path=node.details?.documentPath;if(!path)return;
  const api=(window as any).go?.main?.App;
  if(!api?.ReadLinkedDocument){toast('연결 문서 열기는 Windows 실행 파일에서 사용할 수 있습니다.',true);return;}
  try{await tabs?.openLinked(path,async()=>{const result=await api.ReadLinkedDocument(path);return validateDocument(JSON.parse(result.data));});}catch(error){toast(String(error),true);}
}
async function addDocumentCard(reconnect=false){
  const api=(window as any).go?.main?.App;
  if(!api?.OpenDocument){toast('문서 카드는 Windows 실행 파일에서 추가할 수 있습니다.',true);return;}
  const origin=doc,target=reconnect?selectedNodes()[0]:undefined;
  if(reconnect&&(!target||!editableNodeIds(doc).has(target.id)))return;
  const result=await api.OpenDocument();if(!result||doc!==origin)return;
  if(!/\.(agentsketch|flowpaper)$/i.test(result.path))throw new Error('.agentsketch 파일을 선택하세요.');
  const linked=validateDocument(JSON.parse(result.data));
  mutate(()=>{const node=target??createNode('round',(canvas.clientWidth/2-doc.viewport.x)/doc.viewport.zoom-130,(canvas.clientHeight/2-doc.viewport.y)/doc.viewport.zoom-55);
    node.details={...node.details,documentPath:result.path};
    if(!target){node.w=260;node.h=110;node.fill='#FFF0E5';node.stroke='#C2410C';node.text=`문서 · ${linked.title}\n더블클릭하여 상세 문서 열기`;node.details.pageId=doc.workspace?.activePageId??DEFAULT_PAGE;doc.nodes.push(node);select([node.id]);}
  },target?'문서 연결을 바꿨습니다.':'문서 카드를 추가했습니다. 더블클릭하면 새 탭으로 열립니다.');
}
function beginEdit(n: FlowNode) { if(!editableNodeIds(doc).has(n.id))return; finishEdit(); select([n.id]); editing = n.id; textEditor.value = n.text; textEditor.hidden = false; positionEditor(); textEditor.focus(); textEditor.select(); }
function positionEditor() {
  if (!editing) return; const n = doc.nodes.find(n => n.id === editing); if (!n) return;
  const v = doc.viewport;
  Object.assign(textEditor.style, { left: `${n.x * v.zoom + v.x}px`, top: `${n.y * v.zoom + v.y}px`, width: `${Math.max(100, n.w * v.zoom)}px`, height: `${Math.max(52, n.h * v.zoom)}px`, fontFamily: FONT_FAMILY, fontSize: `${Math.max(11, n.fontSize * v.zoom)}px`, fontWeight: n.bold ? '700' : '400', textAlign: n.align, color: n.color, background: n.kind === 'image' || n.fill === 'transparent' ? '#ffffff' : n.fill, padding: `${12 * v.zoom}px` });
}
function finishEdit(cancel = false) {
  if (!editing) return;
  const n = doc.nodes.find(n => n.id === editing), value = textEditor.value; editing = null; textEditor.hidden = true;
  if (!cancel && n && n.text !== value) { history.push(doc); setNodePlainText(n,value.slice(0,20000)); changed(); }
}
textEditor.addEventListener('blur', () => finishEdit());
textEditor.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); finishEdit(true); canvas.focus(); } else if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void action(e.shiftKey ? 'save-as' : 'save'); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finishEdit(); canvas.focus(); } e.stopPropagation(); });

function updateUI() {
  workbench?.update(); tabs?.update();
  const title = $<HTMLInputElement>('document-title'); if (document.activeElement !== title) title.value = doc.title;
  $('node-count').textContent = `${doc.nodes.length}개 요소 · ${doc.edges.length}개 연결`;
  const nodes = selectedNodes(), edge = doc.edges.find(e => e.id === selectedEdge), n = nodes[0];
  const names: Record<FlowNode['kind'], string> = { rect: '사각형', round: '둥근 사각형', ellipse: '타원', diamond: '판단', text: '텍스트', note: '메모', image: '이미지', draw: '자유선', frame: '영역 상자' };
  $('selection-summary').textContent = edge ? '연결선' : nodes.length ? nodes.length === 1 ? `${names[n.kind]} · 1개` : `${nodes.length}개 요소 선택` : '작업 안내';
  $('node-inspector').classList.toggle('multi-selection', nodes.length > 1);
  $('selection-description').hidden = nodes.length < 2;
  $('node-inspector').hidden = !n; $('edge-inspector').hidden = !edge; $('empty-inspector').hidden = Boolean(n || edge);
  $('linked-document-info').hidden=nodes.length!==1||!n?.details?.documentPath;
  $('linked-document-path').textContent=n?.details?.documentPath??'';
  if (n) {
    const values: Record<string, string | number | boolean> = { 'node-text': n.text, 'node-fill': n.fill === 'transparent' ? '#ffffff' : n.fill, 'node-stroke': n.stroke, 'node-color': n.color, 'node-font': n.fontSize, 'node-bold': n.bold, 'node-align': n.align, 'node-width': Math.round(n.w), 'node-height': Math.round(n.h), 'node-x': Math.round(n.x), 'node-y': Math.round(n.y), 'node-stroke-width': n.strokeWidth, 'node-dashed': n.dashed, 'node-locked': n.locked, 'node-opacity': n.opacity ?? 1 };
    for (const [id, value] of Object.entries(values)) { const input = $<HTMLInputElement>(id); if (!input || document.activeElement === input) continue; if (typeof value === 'boolean') input.checked = value; else input.value = input.type === 'color' && value === 'transparent' ? '#ffffff' : String(value); }
    $('node-text').setAttribute('placeholder', nodes.length > 1 ? '여러 요소에 같은 내용을 적용합니다' : '내용을 입력하세요');
  }
  if (edge) {
    $('route-help').textContent=edgePoints(edge,doc).length?'선의 주황 손잡이를 드래그하면 꺾이는 위치를 바꿀 수 있습니다.':'경로를 찾을 수 없습니다. 겹친 요소를 옮기거나 자동 경로로 되돌리세요.';
    const values: Record<string, string | number | boolean> = { 'edge-label': edge.label, 'edge-style': edge.style, 'edge-color': edge.color, 'edge-width': edge.width, 'edge-arrow': edge.arrow, 'edge-dashed': edge.dashed };
    for (const [id, value] of Object.entries(values)) { const input = $<HTMLInputElement>(id); if (document.activeElement === input) continue; if (typeof value === 'boolean') input.checked = value; else input.value = input.type === 'color' && value === 'transparent' ? '#ffffff' : String(value); }
  }
  document.querySelectorAll<HTMLButtonElement>('[data-action="undo"]').forEach(b => b.disabled = !history.canUndo);
  document.querySelectorAll<HTMLButtonElement>('[data-action="redo"]').forEach(b => b.disabled = !history.canRedo);
  for (const name of ['group', 'ungroup', 'front', 'back', 'duplicate', 'lock']) document.querySelectorAll<HTMLButtonElement>(`[data-action="${name}"]`).forEach(b => b.disabled = !nodes.length);
  document.querySelectorAll<HTMLButtonElement>('[data-action="delete"]').forEach(b => b.disabled = !nodes.length && !edge);
  const list = $('layers-list');
  if (list && !$('layers-panel').hidden) {
    list.innerHTML = [...doc.nodes].reverse().map(n => `<button class="layer-row ${selected.has(n.id) ? 'selected' : ''}" data-node-id="${escapeHTML(n.id)}" title="클릭하여 선택, 두 번 클릭하여 이동"><span class="layer-kind">${icon(n.kind, 16)}</span><span>${escapeHTML(n.text.split('\n')[0] || (n.kind === 'image' ? '이미지' : '이름 없는 요소'))}</span><span>${n.locked ? '잠금' : ''}</span></button>`).join('') || '<p class="empty-layers">도형이나 이미지를 추가하세요.</p>';
  }
}

const propertyKeys: Record<string, keyof FlowNode> = { 'node-text': 'text', 'node-fill': 'fill', 'node-stroke': 'stroke', 'node-color': 'color', 'node-font': 'fontSize', 'node-bold': 'bold', 'node-align': 'align', 'node-width': 'w', 'node-height': 'h', 'node-x': 'x', 'node-y': 'y', 'node-stroke-width': 'strokeWidth', 'node-dashed': 'dashed', 'node-locked': 'locked', 'node-opacity': 'opacity' };
for (const [id, key] of Object.entries(propertyKeys)) {
  $<HTMLInputElement>(id)?.addEventListener('change', e => {
    const input = e.target as HTMLInputElement;
    let value: string | number | boolean = input.type === 'checkbox' ? input.checked : input.type === 'number' || input.type === 'range' ? Number(input.value) : input.value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) { updateUI(); return; }
      const limits: Record<string, [number, number]> = { fontSize: [8, 160], w: [20, 100000], h: [20, 100000], x: [-1000000, 1000000], y: [-1000000, 1000000], strokeWidth: [0, 20], opacity: [.1, 1] }; const limit = limits[key]; if (limit) value = Math.min(limit[1], Math.max(limit[0], value));
    }
    mutate(() => { for (const n of selectedNodes()) { if (!editableNodeIds(doc).has(n.id) && key !== 'locked') continue; if (n.points && (key === 'w' || key === 'h')) { const factor = Number(value) / n[key]; n.points = n.points.map(p => ({ x: key === 'w' ? p.x * factor : p.x, y: key === 'h' ? p.y * factor : p.y })); } if(key==='text')setNodePlainText(n,String(value).slice(0,20000));else Object.assign(n,{[key]:value}); } });
  });
}
const edgeKeys: Record<string, keyof FlowEdge> = { 'edge-label': 'label', 'edge-style': 'style', 'edge-color': 'color', 'edge-width': 'width', 'edge-arrow': 'arrow', 'edge-dashed': 'dashed' };
for (const [id, key] of Object.entries(edgeKeys)) $<HTMLInputElement>(id)?.addEventListener('change', e => {
  const input = e.target as HTMLInputElement, edge = doc.edges.find(e => e.id === selectedEdge); if (!edge) return;
  const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Math.min(12, Math.max(1, Number(input.value) || 2)) : input.value.slice(0, 1000);
  mutate(() => { Object.assign(edge, { [key]: value }); });
});

function copySelection() {
  if (!selected.size) return;
  const nodes = selectedNodes().map(cloneNode), edges = doc.edges.filter(e => selected.has(e.from) && selected.has(e.to)).map(cloneEdge);
  const assets: Record<string, Asset> = {}; nodes.forEach(n => { if (n.assetId && doc.assets[n.assetId]) assets[n.assetId] = doc.assets[n.assetId]; });
  clipboard = { nodes, edges, assets, workspace:doc.workspace?cloneWorkspace(doc.workspace):undefined };
  copiedText = nodes.map(n => n.text || (n.kind === 'image' ? '이미지' : '요소')).join('\n');
}
function pasteSelection() {
  if (!clipboard?.nodes.length) return;
  mutate(() => {
    const temp: FlowDocument = { ...emptyDocument(), nodes: clipboard!.nodes.map(cloneNode), edges: clipboard!.edges.map(cloneEdge), assets: clipboard!.assets, workspace:clipboard!.workspace?cloneWorkspace(clipboard!.workspace):undefined };
    const ids = duplicateSelection(temp, temp.nodes.map(n => n.id), 28), idset = new Set(ids);
    for(const node of temp.nodes.filter(n=>idset.has(n.id)))node.details={...node.details,pageId:doc.workspace?.activePageId??DEFAULT_PAGE,layerId:'layer-main'};
    if(temp.workspace){
      doc.workspace??={};const originalGroups=new Set(clipboard!.workspace?.groups?.map(g=>g.id));const newGroups=temp.workspace.groups?.filter(g=>!originalGroups.has(g.id))??[];
      if(newGroups.length)doc.workspace.groups=[...(doc.workspace.groups??[]),...newGroups];
      const needed=new Set(temp.nodes.filter(n=>idset.has(n.id)).flatMap(n=>n.details?.attachmentIds??[]));
      for(const attachment of temp.workspace.attachments??[]){if(!needed.has(attachment.id))continue;doc.workspace.attachments??=[];const existing=doc.workspace.attachments.find(a=>a.id===attachment.id);if(existing&&existing.data!==attachment.data){const newId=uid();for(const n of temp.nodes.filter(n=>idset.has(n.id)))if(n.details?.attachmentIds)n.details.attachmentIds=n.details.attachmentIds.map(id=>id===attachment.id?newId:id);doc.workspace.attachments.push({...attachment,id:newId});}else if(!existing)doc.workspace.attachments.push({...attachment});}
    }
    doc.nodes.push(...temp.nodes.filter(n => idset.has(n.id))); doc.edges.push(...temp.edges.filter(e => idset.has(e.from) && idset.has(e.to))); Object.assign(doc.assets, clipboard!.assets); selected = idset; selectedEdge = null;
    validateDocument(doc);
    clipboard!.nodes = clipboard!.nodes.map(n => ({ ...n, x: n.x + 28, y: n.y + 28 }));
    clipboard!.edges = clipboard!.edges.map(e=>({...e, waypoints:e.waypoints?.map(p=>({x:p.x+28,y:p.y+28}))}));
  });
}
function deleteSelection() {
  if (!selected.size && !selectedEdge) return;
  const locked = selectedNodes().some(n => n.locked);
  mutate(() => { const ids = new Set(editableNodes().map(n => n.id)); removeSelection(doc, ids); if (selectedEdge) doc.edges = doc.edges.filter(e => e.id !== selectedEdge); selected.clear(); selectedEdge = null; }, locked ? '잠긴 요소는 보존했습니다. 잠금을 풀면 삭제할 수 있습니다.' : undefined);
}
function groupSelection() { if (editableNodes().length < 2) { toast('두 개 이상의 요소를 선택하세요.'); return; } mutate(() => { createGroup(doc,editableNodes().map(n=>n.id)); }, '요소를 묶었습니다. Ctrl+Shift+G로 풀 수 있습니다.'); }
async function addImages(files: File[], at = center()) {
  if (!files.length) return;
  const targetDocument = doc;
  try {
    const result = await importImages(files, at);
    if (doc !== targetDocument) { toast('보드가 바뀌어 이미지 추가를 취소했습니다. 현재 보드에 다시 추가하세요.'); return; }
    if (!result.nodes.length) return;
    const candidate = { ...doc, nodes: [...doc.nodes, ...result.nodes], assets: { ...doc.assets, ...result.assets } };
    validateDocument(candidate);
    mutate(() => { for(const node of result.nodes){applyNodeDefaults(node);if(doc.workspace)node.details={pageId:doc.workspace.activePageId??DEFAULT_PAGE};}doc.nodes.push(...result.nodes); Object.assign(doc.assets, result.assets); selected = new Set(result.nodes.map(n => n.id)); selectedEdge = null; }, `${result.nodes.length}개 이미지를 추가했습니다.`);
    setTool('select');
  } catch (error) { toast(`이미지를 추가하지 못했습니다. ${String(error)}`, true); }
}
function pickImages() { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif'; input.multiple = true; input.onchange = () => void addImages([...input.files || []]); input.click(); }
document.addEventListener('paste', e => {
  if (isTyping(e.target)) return;
  const files = [...e.clipboardData?.items || []].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter((f): f is File => Boolean(f));
  if (files.length) { e.preventDefault(); void addImages(files); return; }
  const plain = e.clipboardData?.getData('text/plain');
  if (clipboard && (e.clipboardData?.getData('application/x-agentsketch') === 'selection' || plain === copiedText)) { e.preventDefault(); pasteSelection(); }
  else if (plain) { e.preventDefault(); const p = center(); mutate(() => { const n = createNode('text', p.x - 140, p.y - 40); n.text = plain.slice(0, 20000);applyNodeDefaults(n); if(doc.workspace)n.details={pageId:doc.workspace.activePageId??DEFAULT_PAGE}; doc.nodes.push(n); selected = new Set([n.id]); selectedEdge = null; }); }
});
for (const kind of ['copy', 'cut'] as const) document.addEventListener(kind, e => {
  if (isTyping(e.target) || !selected.size) return;
  e.preventDefault(); copySelection(); e.clipboardData?.setData('application/x-agentsketch', 'selection'); e.clipboardData?.setData('text/plain', copiedText);
  if (kind === 'cut') deleteSelection(); else toast('선택한 요소를 복사했습니다.');
});
let dragDepth = 0;
wrap.addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); dragDepth++; $('drop-overlay').hidden = false; } });
wrap.addEventListener('dragleave', () => { dragDepth--; if (dragDepth <= 0) $('drop-overlay').hidden = true; });
wrap.addEventListener('dragover', e => { e.preventDefault(); });
wrap.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true; const files = [...e.dataTransfer?.files || []]; if (files.length === 1 && /\.(agentsketch|flowpaper|json)$/i.test(files[0].name)) void openDropped(files[0]); else void addImages(files, worldPoint(e)); });

function isTyping(target: EventTarget | null) { return target instanceof HTMLElement && (target.matches('input,textarea,select') || target.isContentEditable); }
async function guardReplace(): Promise<boolean> {
  finishEdit(); if (!dirty) return true;
  return await confirmChoice('현재 보드를 바꾸기 전에 파일로 저장할까요?', '이 PC의 자동 복구는 최근 보드 하나만 보관합니다. 보관할 작업은 파일로 저장하세요.', [
    { label: '저장하고 계속', value: 'save' }, { label: '저장하지 않고 계속', value: 'discard' }, { label: '취소', value: 'cancel' }
  ]).then(async value => value === 'discard' || (value === 'save' && await save(false)));
}
async function confirmChoice(title: string, message: string, options: { label: string; value: string }[]): Promise<string> {
  const dialog = document.createElement('dialog'); dialog.className = 'confirm-dialog'; dialog.innerHTML = `<form method="dialog"><h2>${escapeHTML(title)}</h2><p>${escapeHTML(message)}</p><div class="dialog-actions">${options.map((o, i) => `<button value="${o.value}" class="${i === 0 ? 'primary-button' : ''}">${escapeHTML(o.label)}</button>`).join('')}</div></form>`;
  document.body.append(dialog); dialog.showModal(); return await new Promise(resolve => dialog.addEventListener('close', () => { const result = dialog.returnValue || 'cancel'; dialog.remove(); resolve(result); }, { once: true }));
}
async function save(saveAs: boolean): Promise<boolean> {
  finishEdit(); try { const savedRevision = revision, path = await saveDocument(doc, filePath, saveAs); if (path === null) return false; filePath = path; if (revision === savedRevision) dirty = false; setStatus('파일로 저장했습니다');updateUI(); toast('보드를 파일로 저장했습니다.'); return true; } catch (error) { toast(`저장하지 못했습니다. ${String(error)}`, true); return false; }
}
function replaceDocument(next: FlowDocument, path = '') {
  const bridge=(window as any).go?.main?.App;
  if(bridge?.SetActiveDocumentPath)pathChange=pathChange.then(()=>bridge.SetActiveDocumentPath(path)).catch(error=>toast(String(error),true)); history.clear(); doc = next; selected.clear(); selectedEdge = null; connecting = null; filePath = path; dirty = false; revision++; updateUI(); invalidate(); queueRecovery(); }
async function openDropped(file: File) { try { if (file.size > 80 * 1024 * 1024) throw new Error('문서가 너무 큽니다. 최대 80 MB까지 열 수 있습니다.'); const next = validateDocument(JSON.parse(await file.text())); if (await guardReplace()) replaceDocument(next); } catch (error) { toast(`보드를 열지 못했습니다. ${String(error)}`, true); } }
async function runAction(action: string) {
  switch (action) {
    case 'next-step': if(selected.size===1)mutate(()=>{const id=addNextStep(doc,[...selected][0]);selected=new Set([id]);},'다음 단계를 추가했습니다.');break;
    case 'workbench': finishEdit();workbench?.open();break;
    case 'advanced-layout': finishEdit();workbench?.open('layout');break;
    case 'ai-follow': {aiFollow=!aiFollow;localStorage.setItem('agentsketch.ai-follow',aiFollow?'1':'0');document.querySelector('[data-action="ai-follow"]')?.setAttribute('aria-pressed',String(aiFollow));break;}
    case 'automation': {await (window as any).go?.main?.App?.DisableAutomation();break;}
    case 'document-card': await addDocumentCard(); break;
    case 'relink-document': await addDocumentCard(true); break;
    case 'open-linked-document': if(selectedNodes()[0])await openLinkedCard(selectedNodes()[0]); break;
    case 'unlink-document': {const n=selectedNodes()[0];if(n&&editableNodeIds(doc).has(n.id))mutate(()=>{delete n.details?.documentPath;},'문서 연결을 해제했습니다. 원본 파일은 유지됩니다.');break;}
    case 'new': if (await guardReplace()) { replaceDocument(emptyDocument()); fit(); toast('빈 보드를 만들었습니다. 왼쪽 도구로 시작하세요.'); } break;
    case 'open': if (await guardReplace()) { const result = await openDocument(); if (result) replaceDocument(result.doc, result.path); } break;
    case 'save': await save(false); break;
    case 'save-as': await save(true); break;
    case 'undo': { finishEdit(); const previous = history.undo(doc); if (previous) { doc = previous; selected.clear(); selectedEdge = null; connecting = null; changed(); } break; }
    case 'redo': { finishEdit(); const next = history.redo(doc); if (next) { doc = next; selected.clear(); selectedEdge = null; connecting = null; changed(); } break; }
    case 'image': pickImages(); break;
    case 'fit': fit(); break;
    case 'fit-selection': fit(selectedNodes().length ? selectedNodes() : doc.nodes); break;
    case 'zoom-in': zoomAt(doc.viewport.zoom * 1.2); break;
    case 'zoom-out': zoomAt(doc.viewport.zoom / 1.2); break;
    case 'zoom-reset': zoomAt(1); break;
    case 'grid': grid = !grid; updateToggles(); invalidate(); break;
    case 'snap': snap = !snap; updateToggles(); break;
    case 'auto-layout': if (selected.size === 1) toast('두 개 이상의 요소를 선택하거나 선택을 해제해 전체 보드를 배치하세요.'); else if (doc.nodes.length) mutate(() => { autoLayout(doc, selected.size > 1 ? selected : undefined, 'horizontal'); fit(); }, '연결 순서에 맞춰 자동 배치했습니다. Ctrl+Z로 되돌릴 수 있습니다.'); break;
    case 'blocked-route': { const id=renderer.blockedEdges[0]; if(id)select([],id); break; }
    case 'reset-route': {const edge=doc.edges.find(e=>e.id===selectedEdge);if(edge)mutate(()=>delete edge.waypoints,'자동 경로로 되돌렸습니다.');break;}
    case 'group': groupSelection(); break;
    case 'ungroup': mutate(() => {const groups=new Set(editableNodes().filter(n=>n.groupId).map(n=>topGroupId(doc,n.groupId!)));groups.forEach(id=>ungroup(doc,id));}); break;
    case 'front': mutate(() => { const ids = new Set(editableNodes().map(n => n.id)); doc.nodes = [...doc.nodes.filter(n => !ids.has(n.id)), ...doc.nodes.filter(n => ids.has(n.id))]; }); break;
    case 'back': mutate(() => { const ids = new Set(editableNodes().map(n => n.id)); doc.nodes = [...doc.nodes.filter(n => ids.has(n.id)), ...doc.nodes.filter(n => !ids.has(n.id))]; }); break;
    case 'duplicate': if (selected.size) mutate(() => { selected = new Set(duplicateSelection(doc, selected)); selectedEdge = null; }); break;
    case 'copy': copySelection(); if (navigator.clipboard) await navigator.clipboard.writeText(copiedText).catch(() => {}); toast('선택한 요소를 복사했습니다.'); break;
    case 'paste': pasteSelection(); break;
    case 'delete': deleteSelection(); break;
    case 'lock': if (selected.size) mutate(() => { const shouldLock = !selectedNodes().every(n => n.locked); selectedNodes().forEach(n => n.locked = shouldLock); }); break;
    case 'align-left': case 'align-right': case 'align-top': case 'align-bottom': case 'align-center': case 'align-middle': {
      if (editableNodes().length < 2) { toast('정렬할 요소를 두 개 이상 선택하세요.'); break; }
      const mode = action.replace('align-', '') === 'center' ? 'centerX' : action.replace('align-', '') === 'middle' ? 'centerY' : action.replace('align-', ''); mutate(() => runCommandInPlace(doc,{command:'node.align',args:{ids:editableNodes().map(n=>n.id),mode}})); break;
    }
    case 'distribute-horizontal': case 'distribute-vertical': if (editableNodes().length < 3) toast('간격을 맞출 요소를 세 개 이상 선택하세요.'); else mutate(() => runCommandInPlace(doc,{command:'node.distribute',args:{ids:editableNodes().map(n=>n.id),direction:action.endsWith('horizontal')?'horizontal':'vertical'}})); break;
    case 'export-png': case 'export-svg': case 'export-pdf': case 'export-html': {
      finishEdit(); if (!doc.nodes.length) { toast('내보낼 요소를 먼저 추가하세요.'); break; }
      toast('보드를 내보내고 있습니다…'); const path = await exportFile(projectVisibleDocument(doc), action.slice(7) as 'png' | 'svg' | 'pdf' | 'html'); if (path) toast('내보내기를 완료했습니다.'); break;
    }
    case 'language': setLang(lang === 'ko' ? 'en' : 'ko'); toast(lang === 'ko' ? 'Restart AgentSketch to switch to English. · 다시 시작하면 영어로 바뀝니다.' : '다시 시작하면 한국어로 바뀝니다. · Restart AgentSketch to switch to Korean.'); break;
    case 'template-launch': case 'template-simple': if (await guardReplace()) { replaceDocument(createSample(action === 'template-launch' ? 'launch' : 'simple')); dirty = true; fit(); toast('설명용 예시를 열었습니다. 자유롭게 편집하세요.'); } break;
    case 'help': $<HTMLDialogElement>('help-dialog').showModal(); break;
    case 'focus': $('app').classList.toggle('focus-mode'); break;
    case 'search': { document.querySelector<HTMLElement>('[data-tab="layers"]')?.click(); $('app').classList.remove('focus-mode'); $<HTMLInputElement>('search-input').focus(); break; }
  }
}
async function action(name: string) {
  const long = ['document-card','relink-document','open-linked-document','new', 'open', 'save', 'save-as', 'template-launch', 'template-simple', 'export-png', 'export-svg', 'export-pdf', 'export-html'].includes(name);
  if (long && operationBusy) return;
  if (long) operationBusy = true;
  try { await runAction(name); } catch (error) { toast(`작업을 완료하지 못했습니다. ${String(error)}`, true); } finally { if (long) operationBusy = false; }
}
function updateToggles() {
  for (const [name, value] of [['grid', grid], ['snap', snap]] as const) { const input = $<HTMLInputElement>(`${name}-toggle`); if (input) input.checked = value; document.querySelectorAll(`[data-action="${name}"]`).forEach(el => { el.classList.toggle('active', value); el.setAttribute('aria-pressed', String(value)); }); }
}
document.addEventListener('click', e => {
  const target = e.target as HTMLElement, tool = target.closest<HTMLElement>('[data-tool]'), button = target.closest<HTMLElement>('[data-action]'), tab = target.closest<HTMLElement>('[data-tab]'), layer = target.closest<HTMLElement>('[data-node-id]');
  if (tool) setTool(tool.dataset.tool as Tool);
  if (button && !(button as HTMLButtonElement).disabled) { void action(button.dataset.action!); button.closest('details')?.removeAttribute('open'); }
  if (tab) { const layers = tab.dataset.tab === 'layers'; $('layers-panel').hidden = !layers; $('properties-panel').hidden = layers; document.querySelectorAll<HTMLElement>('[data-tab]').forEach(t => { const active = t === tab; t.classList.toggle('active', active); t.setAttribute('aria-selected', String(active)); }); updateUI(); }
  if (layer) { const n = doc.nodes.find(n => n.id === layer.dataset.nodeId); if (n) { if ((e as MouseEvent).shiftKey) { const ids = new Set(selected); ids.has(n.id) ? ids.delete(n.id) : ids.add(n.id); select(ids); } else select(expandGroup(n)); } }
  if (!target.closest('#context-menu')) $('context-menu').hidden = true;
  document.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(d => { if (!d.contains(target)) d.open = false; });
});
$('layers-list').addEventListener('dblclick', e => { const el = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]'); const n = doc.nodes.find(n => n.id === el?.dataset.nodeId); if (n) fit([n]); });
$<HTMLInputElement>('document-title').addEventListener('change', e => { const value = (e.target as HTMLInputElement).value.trim().slice(0, 200) || '이름 없는 보드'; if (value !== doc.title) mutate(() => doc.title = value); });
for (const name of ['grid', 'snap']) $(`${name}-toggle`)?.addEventListener('change', e => { if (name === 'grid') grid = (e.target as HTMLInputElement).checked; else snap = (e.target as HTMLInputElement).checked; updateToggles(); invalidate(); });
$<HTMLInputElement>('search-input').addEventListener('input', e => {
  const term = (e.target as HTMLInputElement).value.trim().toLocaleLowerCase(), results = $('search-results');
  results.hidden = !term; if (!term) return;
  const matches = doc.nodes.filter(n => n.text.toLocaleLowerCase().includes(term)).slice(0, 40);
  results.innerHTML = matches.length ? matches.map(n => `<button data-search-id="${escapeHTML(n.id)}">${escapeHTML(n.text.slice(0, 90) || '이름 없는 요소')}</button>`).join('') : '<p>일치하는 요소가 없습니다.</p>';
});
$('search-results').addEventListener('click', e => { const item = (e.target as HTMLElement).closest<HTMLElement>('[data-search-id]'), n = doc.nodes.find(n => n.id === item?.dataset.searchId); if (n) { select([n.id]); fit([n]); $('search-results').hidden = true; } });

canvas.addEventListener('contextmenu', e => {
  e.preventDefault(); finishEdit(); const p = worldPoint(e), n = hitNode(p), edge = n ? undefined : hitEdge(p);
  if (n && !selected.has(n.id)) select(expandGroup(n)); else if (edge) select([], edge.id);
  const menu = $('context-menu');
  const entries = n || selected.size ? [['next-step', '다음 단계 추가', ''], ['duplicate', '복제', 'Ctrl+D'], ['copy', '복사', 'Ctrl+C'], ['group', '묶기', 'Ctrl+G'], ['ungroup', '묶기 해제', 'Ctrl+Shift+G'], ['front', '맨 앞으로', ']'], ['back', '맨 뒤로', '['], ['lock', selectedNodes().every(n => n.locked) ? '잠금 해제' : '잠금', 'Ctrl+L'], ['fit-selection', '선택 요소로 이동', 'Shift+1'], ['delete', '삭제', 'Delete']] : edge ? [['delete', '연결선 삭제', 'Delete']] : [['paste', '붙여넣기', 'Ctrl+V'], ['fit', '전체 보기', '1'], ['image', '이미지 추가', ''], ['help', '단축키 보기', '?']];
  if(n?.details?.documentPath)entries.unshift(['open-linked-document','연결 문서 열기','Enter'],['relink-document','문서 다시 연결',''],['unlink-document','문서 연결 해제','']);
  menu.innerHTML = entries.map(([a, text, key]) => `<button data-action="${a}"><span>${text}</span><kbd>${formatShortcutLabel(key)}</kbd></button>`).join('');
  menu.hidden = false; menu.style.left = `${Math.min(e.clientX, window.innerWidth - 236)}px`; menu.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 12))}px`;
});

document.addEventListener('keydown', e => {
  if(workbench?.isOpen)return;
  const modifier = e.ctrlKey || e.metaKey;
  if (document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape') { finishEdit(true); if (gesture) { doc = gesture.before; gesture = null; } connecting = null; reconnecting=undefined; marquee = undefined; guides = undefined; select([]); setTool('select'); $('context-menu').hidden = true; $('search-results').hidden = true; }
  if (isTyping(e.target)) { if (modifier && e.key.toLowerCase() === 's') { e.preventDefault(); void action(e.shiftKey ? 'save-as' : 'save'); } return; }
  if (modifier) {
    const key = e.key.toLowerCase();
    const shortcuts: Record<string, string> = { s: e.shiftKey ? 'save-as' : 'save', o: 'open', n: 'new', z: e.shiftKey ? 'redo' : 'undo', y: 'redo', d: 'duplicate', g: e.shiftKey ? 'ungroup' : 'group', l: 'lock', f: 'search', '0': 'fit', '[': 'back', ']': 'front' };
    if (key === 'i' && e.shiftKey) { e.preventDefault(); pickImages(); return; }
    if (shortcuts[key]) { e.preventDefault(); void action(shortcuts[key]); return; }
    if (key === 'a') { e.preventDefault(); select(projectVisibleDocument(doc).nodes.map(n => n.id)); return; }
    // Native paste event carries images; handling key V here would insert twice.
    return;
  }
  if (e.code === 'Space') { e.preventDefault(); space = true; canvas.style.cursor = 'grab'; return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (e.key.startsWith('Arrow') && selected.size) {
    e.preventDefault(); const amount = e.shiftKey ? 10 : 1, dx=e.key==='ArrowRight'?amount:e.key==='ArrowLeft'?-amount:0, dy=e.key==='ArrowDown'?amount:e.key==='ArrowUp'?-amount:0; mutate(() => { const nodes=editableNodes(); translateInternalRoutes(doc,new Set(nodes.map(n=>n.id)),dx,dy); nodes.forEach(n=>{n.x+=dx;n.y+=dy;}); }); return;
  }
  if (e.key === 'Enter' && selected.size === 1) { const n = selectedNodes()[0]; if(n.details?.documentPath){e.preventDefault();void openLinkedCard(n);return;} if (!n.locked && n.kind !== 'draw') { e.preventDefault(); beginEdit(n); } return; }
  if (e.code === 'Digit1') { e.preventDefault(); fit(e.shiftKey && selected.size ? selectedNodes() : doc.nodes); return; }
  if (e.key === 'Tab' && e.target === canvas) { e.preventDefault(); void action('focus'); return; }
  if (e.key === '0') { zoomAt(1); return; }
  if (e.key === '+' || e.key === '=') { zoomAt(doc.viewport.zoom * 1.2); return; }
  if (e.key === '-') { zoomAt(doc.viewport.zoom / 1.2); return; }
  if (e.key === '?') { void action('help'); return; }
  if (e.key === '[' || e.key === ']') { void action(e.key === '[' ? 'back' : 'front'); return; }
  const tools: Record<string, Tool> = { v: 'select', h: 'hand', r: 'rect', o: 'ellipse', d: 'diamond', t: 'text', n: 'note', c: 'connect', p: 'draw', f: 'frame' };
  if (tools[e.key.toLowerCase()]) setTool(tools[e.key.toLowerCase()]);
});
document.addEventListener('keyup', e => { if (e.code === 'Space') { space = false; canvas.style.cursor = currentTool === 'hand' ? 'grab' : 'default'; } });
window.addEventListener('blur', () => { space = false; });

const minimap = $<HTMLCanvasElement>('minimap');
minimap?.addEventListener('pointerdown', e => {
  if (!doc.nodes.length) return;
  const raw = bounds(projectVisibleDocument(doc).nodes), b = { x: raw.x - 80, y: raw.y - 80, w: raw.w + 160, h: raw.h + 160 }, r = minimap.getBoundingClientRect();
  const scale = Math.min((r.width - 14) / Math.max(b.w, 1), (r.height - 14) / Math.max(b.h, 1));
  const offsetX = (r.width - b.w * scale) / 2, offsetY = (r.height - b.h * scale) / 2;
  const x = b.x + (e.clientX - r.left - offsetX) / scale, y = b.y + (e.clientY - r.top - offsetY) / scale;
  doc.viewport.x = canvas.clientWidth / 2 - x * doc.viewport.zoom; doc.viewport.y = canvas.clientHeight / 2 - y * doc.viewport.zoom; invalidate(); queueRecovery();
});
const observer = new ResizeObserver(() => { renderer.resize(wrap.clientWidth, wrap.clientHeight); invalidate(); }); observer.observe(wrap);
window.addEventListener('beforeunload', e => { if (!isNative && dirty && lastSavedRecovery !== revision) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden && !booting) { finishEdit(); void flushRecovery(); } });

async function initialize() {
  try { await document.fonts.load('500 13px "Pretendard Variable"', '월간보고 AgentSketch'); } catch { /* System fallback keeps the editor usable. */ }
  renderer.resize(wrap.clientWidth, wrap.clientHeight);
  try { const launch=await (window as any).go?.main?.App?.TakeLaunchDocument?.();const recovered=launch?validateDocument(JSON.parse(launch.data)):await loadAutosave();if(launch){filePath=launch.path;pathChange=(window as any).go.main.App.SetActiveDocumentPath(filePath);} if (recovered) { doc = recovered; dirty = !launch; toast(launch?'문서 파일을 열었습니다.':'이 PC에 저장된 마지막 작업을 복구했습니다.'); } else { doc = createSample('launch'); requestAnimationFrame(() => fit()); } }
  catch (error) { doc = createSample('launch'); toast(`이전 작업을 복구하지 못했습니다. 저장한 파일을 열 수 있습니다. ${String(error)}`, true); requestAnimationFrame(() => fit()); }
  booting = false; tabs=mountDocumentTabs({...workbenchHost,commitEditing:finishEdit,setDirty:value=>{dirty=value;updateUI();},restoreTab:async(next,path,wasDirty)=>{finishEdit();replaceDocument(next,path);dirty=wasDirty;updateUI();return true;}},$('document-tabs'));setTool('select'); updateToggles(); updateUI(); invalidate(); queueRecovery();
  if (isNative) {
    document.querySelector('[data-action="ai-follow"]')?.setAttribute('aria-pressed',String(aiFollow));
    installAutomation({getDocument:()=>doc,getStamp:()=>revision,commitEdit:finishEdit,commit:aiCommit,mutate,session:async(command,args)=>{
      const api=(window as any).go.main.App;
      if(command==='session.read')return {path:filePath,dirty,selection:[...selected],edge:selectedEdge,canUndo:history.canUndo,canRedo:history.canRedo,grid,snap};
      if(command==='session.select'){for(const id of args.ids??[])if(!doc.nodes.some(n=>n.id===id))throw new Error(`요소 없음: ${id}`);select(args.ids??[],args.edgeId);return true;}
      if(command==='session.fit'){fit(args.ids?doc.nodes.filter(n=>args.ids.includes(n.id)):undefined);return true;}
      if(command==='session.settings'){if(args.grid!==undefined)grid=args.grid;if(args.snap!==undefined)snap=args.snap;if(args.focus!==undefined)$('app').classList.toggle('focus-mode',args.focus);updateToggles();invalidate();return true;}
      if(command==='session.panel'){if(args.name==='close')workbench?.close();else await workbench?.open(args.name);return true;}
      if(command==='history.undo'||command==='history.redo'){await runAction(command.endsWith('undo')?'undo':'redo');return true;}
      if(command==='tabs.list')return tabs?.list();
      if(command==='tabs.activate')return tabs?.activate(args.id);
      if(command==='tabs.new')return tabs?.create();
      if(command==='tabs.close')return tabs?.closeSaved(args.id);
      if(command==='document.open')return tabs?.openLinked(args.path,async()=>validateDocument(JSON.parse((await api.ReadLinkedDocument(args.path)).data)));
      if(command==='document.save'){const path=args.path??filePath;if(!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(path)||! /\.agentsketch$/i.test(path))throw new CommandError('INVALID_ARGUMENT','저장할 절대 .agentsketch 경로가 필요합니다.');const original=doc,stamp=revision;const result=await api.SaveDocument(JSON.stringify(doc),path,false);if(doc===original){filePath=result;pathChange=api.SetActiveDocumentPath(result);if(revision===stamp)dirty=false;updateUI();queueRecovery();}return {path:result};}
      if(command==='source.watch'){select(args.ids);await workbench?.open('evidence');const input=document.querySelector<HTMLInputElement>('[data-evidence-watch]')!;input.checked=args.enabled;input.dispatchEvent(new Event('change',{bubbles:true}));return {status:document.querySelector('[data-evidence-watch-status]')?.textContent};}
      if(command==='presentation.start'){await workbench?.open('review');document.querySelector<HTMLSelectElement>('[data-review="presentation-mode"]')!.value=args.mode??'nodes';document.querySelector<HTMLButtonElement>('[data-review-action="present"]')!.click();return {active:document.body.classList.contains('fp-presenting')};}
      if(command.startsWith('presentation.')){document.querySelector<HTMLButtonElement>(`[data-present="${command.split('.')[1]}"]`)?.click();return {active:document.body.classList.contains('fp-presenting')};}
      throw new CommandError('UNKNOWN_COMMAND',command);
    }});
    const native = (window as unknown as { go: { main: { App: { Ready(): Promise<void>; CloseWithRecovery(data: string): Promise<void>;CloseWithRecoveryForDocument?(data:string,path:string):Promise<void> } } }; runtime: { EventsOn(name: string, fn: () => void): void } });
    native.runtime.EventsOn('agentsketch:closing', () => {
      finishEdit(); clearTimeout(saveTimer);
      void (tabs?.flush()??Promise.resolve()).catch(error=>toast(`탭 복구 보관: ${String(error)}`,true)).then(()=>pathChange).then(()=>autosave(doc,filePath)).then(() => native.go.main.App.CloseWithRecoveryForDocument?native.go.main.App.CloseWithRecoveryForDocument(JSON.stringify(doc),filePath):native.go.main.App.CloseWithRecovery(JSON.stringify(doc))).catch(error => toast(`작업을 보존하지 못해 종료를 멈췄습니다. 파일로 저장하세요. ${String(error)}`, true));
    });
    let openQueue=Promise.resolve();
    native.runtime.EventsOn('agentsketch:open-file',()=>{
      openQueue=openQueue.then(async()=>{
        while(true){
          const result=await (window as any).go.main.App.TakeLaunchDocument();
          if(!result)break;
          try{if(await guardReplace()){replaceDocument(validateDocument(JSON.parse(result.data)),result.path);fit();}}
          catch(error){toast(`파일을 열지 못했습니다. ${String(error)}`,true);}
        }
      }).catch(error=>toast(`파일을 열지 못했습니다. ${String(error)}`,true));
    });
    await native.go.main.App.Ready();
  }
}
const workbenchHost:WorkbenchHost={getDocument:()=>doc,getSelection:()=>selected,getSelectedEdge:()=>selectedEdge,mutate,select,fit,invalidate,toast,replaceDocument:async(next,path)=>{if(!await guardReplace())return false;replaceDocument(next,path);return true;},getFilePath:()=>filePath,getDirty:()=>dirty};
workbench=mountWorkbench(workbenchHost);
void initialize();

