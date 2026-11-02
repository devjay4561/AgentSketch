import type { Asset, Box, FlowDocument, FlowEdge, FlowNode, Point, RenderState } from './types.ts';
import { bounds, edgePoints, portPoint, prepareRoutes, routeHandles } from './geometry.ts';
import { FONT_FAMILY, PALETTE } from './theme.ts';
import { renderRichContent, svgRichContent, WRAP_TOKENS } from './rich-render.ts';
import { layoutEdgeLabels, type EdgeLabel } from './edge-labels.ts';
import { t } from './i18n.ts';

const FONT = FONT_FAMILY;
const PAPER = PALETTE.paper;
const ACCENT = PALETTE.accent;
const REMOTE = '#2F6FED';
const IMAGE_PIXELS = 8_000_000;
const IMAGE_COUNT = 64;
const PAD = 40;

type Bitmap = ImageBitmap | HTMLImageElement;
type CachedImage = { data: string; bitmap?: Bitmap; loading: boolean; failed: boolean; pixels: number; last: number; maximum: number };

function intersects(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function inflate(b: Box, amount: number): Box {
  return { x: b.x - amount, y: b.y - amount, w: b.w + amount * 2, h: b.h + amount * 2 };
}

function rasterData(data: string): boolean {
  return /^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=\r\n]+$/.test(data);
}

async function decodeImage(asset: Asset, maximum = 2048): Promise<Bitmap> {
  if (!rasterData(asset.data)) throw new Error('지원하지 않는 이미지입니다.');
  const ratio = Math.min(1, maximum / Math.max(asset.width, asset.height));
  if (typeof createImageBitmap === 'function') {
    const raw = atob(asset.data.substring(asset.data.indexOf(',') + 1));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const type = asset.data.substring(5, asset.data.indexOf(';'));
    return createImageBitmap(new Blob([bytes], { type }), {
      resizeWidth: Math.max(1, Math.round(asset.width * ratio)),
      resizeHeight: Math.max(1, Math.round(asset.height * ratio)),
      resizeQuality: 'high',
    });
  }
  const image = new Image();
  image.src = asset.data;
  await image.decode();
  return image;
}

function closeImage(bitmap?: Bitmap): void {
  if (bitmap && 'close' in bitmap) bitmap.close();
  else if (bitmap) bitmap.src = '';
}

export function lineSegments(text: string, width: number, measure: (text: string) => number): string[] {
  const result: string[] = [];
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    if (!paragraph) { result.push(''); continue; }
    let line = '', wrapped = false;
    for (const token of paragraph.match(WRAP_TOKENS) ?? []) {
      if (line && measure(line + token) > width) { result.push(line.trimEnd()); line = ''; wrapped = true; }
      // Leading spaces a user typed are kept; the space at a wrap point is dropped.
      if (!line && wrapped && /^\s$/.test(token)) continue;
      if (!line && measure(token) > width) {
        // A word wider than the box still breaks, so no text is ever hidden.
        for (const char of token) {
          if (line && measure(line + char) > width) { result.push(line); line = char; } else line += char;
        }
        continue;
      }
      line += token;
    }
    result.push(line);
  }
  return result;
}

export function textBox(node: FlowNode): Box {
  if (node.kind === 'frame') return { x: node.x + 16, y: node.y + 9, w: node.w - 32, h: 30 };
  if (node.kind === 'image') return { x: node.x + 10, y: node.y + node.h - 34, w: node.w - 20, h: 27 };
  if (node.kind === 'diamond') return { x: node.x + node.w * .22, y: node.y + node.h * .22, w: node.w * .56, h: node.h * .56 };
  if (node.kind === 'text') {
    const paddingY = Math.min(10, Math.max(0, (node.h - node.fontSize * 1.45) / 2));
    return { x: node.x + 14, y: node.y + paddingY, w: node.w - 28, h: node.h - paddingY * 2 };
  }
  return { x: node.x + 14, y: node.y + 10, w: node.w - 28, h: node.h - 20 };
}

function pathNode(ctx: CanvasRenderingContext2D, node: FlowNode): void {
  const { x, y, w, h, kind } = node;
  ctx.beginPath();
  if (kind === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, Math.max(.5, w / 2), Math.max(.5, h / 2), 0, 0, Math.PI * 2);
  else if (kind === 'diamond') {
    ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h / 2);
    ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x, y + h / 2); ctx.closePath();
  } else if (kind === 'draw') {
    const points = node.points ?? [];
    if (points.length) {
      ctx.moveTo(x + points[0].x, y + points[0].y);
      for (const p of points.slice(1)) ctx.lineTo(x + p.x, y + p.y);
    }
  } else if (kind === 'round' || kind === 'frame' || kind === 'image') {
    ctx.roundRect(x, y, w, h, Math.min(kind === 'round' ? 15 : 8, w / 2, h / 2));
  } else ctx.rect(x, y, w, h);
}

function drawText(ctx: CanvasRenderingContext2D, node: FlowNode): void {
  const box = textBox(node);
  if (renderRichContent(ctx,node,box,FONT)) return;
  if (!node.text) return;
  if (box.w < 4 || box.h < 4) return;
  const fontSize = node.kind === 'frame' ? Math.min(18, node.fontSize) : node.fontSize;
  ctx.save();
  ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  ctx.font = `${node.bold ? 600 : 400} ${fontSize}px ${FONT}`;
  ctx.fillStyle = node.color;
  ctx.textBaseline = 'middle';
  const align = node.kind === 'frame' ? 'left' : node.align;
  ctx.textAlign = align;
  const lines = lineSegments(node.text, box.w, text => ctx.measureText(text).width);
  const lh = fontSize * 1.45;
  const top = node.kind === 'note' || node.kind === 'text' || node.kind === 'frame';
  const start = box.y + (top ? lh / 2 : Math.max(lh / 2, (box.h - lines.length * lh) / 2 + lh / 2));
  const tx = box.x + (align === 'center' ? box.w / 2 : align === 'right' ? box.w : 0);
  lines.forEach((line, i) => ctx.fillText(line, tx, start + i * lh));
  ctx.restore();
}

function drawNode(ctx: CanvasRenderingContext2D, node: FlowNode, bitmap?: Bitmap, imageFailed = false, textVisible = true): void {
  ctx.save();
  ctx.globalAlpha = node.opacity ?? 1;
  ctx.lineWidth = node.strokeWidth;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = node.stroke; ctx.fillStyle = node.fill;
  ctx.setLineDash(node.dashed ? [8, 5] : []);
  pathNode(ctx, node);
  if (node.kind === 'draw') ctx.stroke();
  else {
    if (node.fill !== 'transparent') ctx.fill();
    if (node.strokeWidth > 0 && node.stroke !== 'transparent') ctx.stroke();
  }
  if (node.kind === 'note') {
    ctx.fillStyle = 'rgba(0,0,0,.045)'; ctx.fillRect(node.x, node.y, node.w, 7);
  }
  if (node.kind === 'frame') {
    ctx.beginPath(); ctx.moveTo(node.x, node.y + 43); ctx.lineTo(node.x + node.w, node.y + 43);
    ctx.strokeStyle = node.stroke; ctx.lineWidth = .8; ctx.setLineDash([]); ctx.stroke();
  }
  if (node.kind === 'image') {
    ctx.save(); pathNode(ctx, node); ctx.clip();
    if (bitmap) {
      const crop=node.crop??{x:0,y:0,w:1,h:1};
      ctx.save();
      if(node.rotation){ctx.translate(node.x+node.w/2,node.y+node.h/2);ctx.rotate(node.rotation*Math.PI/180);ctx.translate(-node.x-node.w/2,-node.y-node.h/2);}
      ctx.drawImage(bitmap,crop.x*bitmap.width,crop.y*bitmap.height,crop.w*bitmap.width,crop.h*bitmap.height,node.x,node.y,node.w,node.h);
      ctx.restore();
      if (node.text) { ctx.fillStyle = 'rgba(255,255,255,.93)'; ctx.fillRect(node.x, node.y + node.h - 40, node.w, 40); }
    } else {
      ctx.fillStyle = '#EFF2F6'; ctx.fillRect(node.x, node.y, node.w, node.h);
      const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
      ctx.strokeStyle = '#98A3B2'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
      ctx.strokeRect(cx - 18, cy - 24, 36, 30);
      ctx.beginPath(); ctx.moveTo(cx - 15, cy + 2); ctx.lineTo(cx - 4, cy - 9); ctx.lineTo(cx + 4, cy - 2); ctx.lineTo(cx + 10, cy - 8); ctx.lineTo(cx + 16, cy + 2); ctx.stroke();
      ctx.fillStyle = PALETTE.muted; ctx.font = `12px ${FONT}`; ctx.textAlign = 'center';
      if (textVisible) ctx.fillText(imageFailed ? t('이미지를 읽을 수 없습니다') : t('이미지'), cx, cy + 27, node.w - 12);
    }
    ctx.restore();
  }
  if (node.kind !== 'draw' && textVisible) drawText(ctx, node);
  if (node.locked) {
    const x = node.x + node.w - 13, y = node.y + 12;
    ctx.strokeStyle = PALETTE.muted; ctx.fillStyle = PAPER; ctx.lineWidth = 1.3; ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y - 2, 3, Math.PI, 0); ctx.stroke();
    ctx.fillRect(x - 4, y - 2, 8, 7); ctx.strokeRect(x - 4, y - 2, 8, 7);
  }
  ctx.restore();
}

function arrow(ctx: CanvasRenderingContext2D, tip: Point, from: Point, size: number): void {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  ctx.beginPath(); ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - size * Math.cos(angle - Math.PI / 6), tip.y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(tip.x - size * Math.cos(angle + Math.PI / 6), tip.y - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath(); ctx.fill();
}

function drawEdge(ctx: CanvasRenderingContext2D, edge: FlowEdge, points: Point[], selected = false, zoom = 1, label?: EdgeLabel, background: string = PAPER): void {
  if (points.length < 2) return;
  ctx.save(); ctx.lineJoin = edge.style === 'elbow' ? 'miter' : 'round'; ctx.lineCap = edge.style === 'elbow' ? 'butt' : 'round'; ctx.miterLimit = 2;
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  // A narrow paper casing makes a crossing visibly different from a junction.
  ctx.lineWidth=edge.width+4/zoom;ctx.strokeStyle=background;ctx.stroke();
  if (selected) { ctx.lineWidth = edge.width + 7 / zoom; ctx.strokeStyle = PALETTE.accentSoft; ctx.stroke(); }
  ctx.strokeStyle = edge.color; ctx.fillStyle = edge.color; ctx.lineWidth = edge.width;
  ctx.setLineDash(edge.dashed ? [7, 5] : []); ctx.stroke(); ctx.setLineDash([]);
  const size = Math.max(9, edge.width * 4);
  if (edge.arrow === 'end' || edge.arrow === 'both') arrow(ctx, points[points.length - 1], points[points.length - 2], size);
  if (edge.arrow === 'both') arrow(ctx, points[0], points[1], size);
  if (label) {
    const {center,lines,leader,angle,textWidth,textHeight}=label;
    if(leader.length){ctx.strokeStyle=edge.color;ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(leader[0].x,leader[0].y);for(const p of leader.slice(1))ctx.lineTo(p.x,p.y);ctx.stroke();}
    ctx.save();ctx.translate(center.x,center.y);ctx.rotate(angle*Math.PI/180);
    ctx.fillStyle=edge.labelBackground??'#fff';ctx.beginPath();ctx.roundRect(-textWidth/2,-textHeight/2,textWidth,textHeight,4);ctx.fill();
    ctx.fillStyle=edge.color;ctx.font=`12px ${FONT}`;ctx.textAlign='center';ctx.textBaseline='middle';
    lines.forEach((line,i)=>ctx.fillText(line,0,-textHeight/2+12+i*16));ctx.restore();
  }
  ctx.restore();
}

function selection(ctx: CanvasRenderingContext2D, node: FlowNode, zoom: number): void {
  const box = inflate(node, 3 / zoom), size = 7 / zoom;
  ctx.save(); ctx.strokeStyle = ACCENT; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5 / zoom; ctx.setLineDash([]);
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  if (!node.locked) {
    for (const x of [node.x, node.x + node.w]) for (const y of [node.y, node.y + node.h]) {
      ctx.fillRect(x - size / 2, y - size / 2, size, size); ctx.strokeRect(x - size / 2, y - size / 2, size, size);
    }
    for (const port of ['top', 'right', 'bottom', 'left'] as const) {
      const p = portPoint(node, port);
      ctx.beginPath(); ctx.arc(p.x, p.y, 4 / zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
}

export class Renderer {
  blockedEdges: string[] = [];
  private canvas: HTMLCanvasElement;
  private invalidate: () => void;
  private ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private images = new Map<string, CachedImage>();
  private imagePixels = 0;
  private generation = 0;
  private disposed = false;
  private decodes = 0;
  private imageQueue: Array<() => Promise<void>> = [];

  constructor(canvas: HTMLCanvasElement, invalidate: () => void) {
    this.canvas = canvas; this.invalidate = invalidate;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('그리기 화면을 시작할 수 없습니다.');
    this.ctx = ctx;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    this.ratio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.ratio);
    this.canvas.height = Math.round(this.height * this.ratio);
    this.canvas.style.width = `${this.width}px`; this.canvas.style.height = `${this.height}px`;
  }

  private evict(id: string): void {
    const image = this.images.get(id);
    if (!image) return;
    closeImage(image.bitmap); this.imagePixels -= image.pixels; this.images.delete(id);
  }

  private pumpImages(): void {
    while (!this.disposed && this.decodes < 3 && this.imageQueue.length) {
      const task = this.imageQueue.shift()!;
      this.decodes++;
      void task().finally(() => { this.decodes--; this.pumpImages(); });
    }
  }

  private requestImage(asset: Asset, maximum: number, pixelsBudget: number): CachedImage {
    let entry = this.images.get(asset.id);
    if (entry && (entry.data !== asset.data || (!entry.loading && !entry.failed && (maximum > entry.maximum * 1.8 || entry.pixels > pixelsBudget * 1.01)))) { this.evict(asset.id); entry = undefined; }
    if (entry) { entry.last = this.generation; return entry; }
    entry = { data: asset.data, loading: true, failed: false, pixels: 0, last: this.generation, maximum };
    this.images.set(asset.id, entry);
    const created = entry;
    this.imageQueue.push(async () => {
      if (this.disposed || this.images.get(asset.id) !== created) return;
      await decodeImage(asset, maximum).then(bitmap => {
      if (this.disposed || this.images.get(asset.id) !== created) { closeImage(bitmap); return; }
      created.loading = false; created.bitmap = bitmap; created.pixels = bitmap.width * bitmap.height;
      this.imagePixels += created.pixels;
      // Retain the current visible pass. Old offscreen assets are released first.
      for (const [id, old] of [...this.images].sort((a, b) => a[1].last - b[1].last)) {
        if (this.imagePixels <= IMAGE_PIXELS && this.images.size <= IMAGE_COUNT) break;
        if (old.last < this.generation && !old.loading) this.evict(id);
      }
      this.invalidate();
    }).catch(() => {
      if (this.images.get(asset.id) === created) { created.loading = false; created.failed = true; this.invalidate(); }
    });
    });
    this.pumpImages();
    return entry;
  }

  render(state: RenderState): void {
    if (this.disposed) return;
    const { doc } = state, { x, y, zoom } = doc.viewport, ctx = this.ctx;
    const nodeIndex = new Map(doc.nodes.map(node => [node.id, node])); prepareRoutes(doc, nodeIndex);
    this.generation++;
    for (const [id, cached] of this.images) if (!doc.assets[id] || doc.assets[id].data !== cached.data) this.evict(id);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, this.width, this.height);
    if (state.grid) {
      let grid = 20 * zoom;
      while (grid < 13) grid *= 5;
      ctx.fillStyle = '#CFD5DE';
      const gx = ((x % grid) + grid) % grid, gy = ((y % grid) + grid) % grid;
      for (let xx = gx; xx < this.width; xx += grid) for (let yy = gy; yy < this.height; yy += grid) {
        ctx.beginPath(); ctx.arc(xx, yy, .75, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.translate(x, y); ctx.scale(zoom, zoom);
    const visible = { x: -x / zoom - 80, y: -y / zoom - 80, w: this.width / zoom + 160, h: this.height / zoom + 160 };
    const visibleNodes = doc.nodes.filter(node => intersects(node, visible));
    const imageNodes = visibleNodes.filter(node => node.kind === 'image' && node.assetId && doc.assets[node.assetId]);
    imageNodes.sort((a, b) => Math.hypot(a.x + a.w / 2 - (visible.x + visible.w / 2), a.y + a.h / 2 - (visible.y + visible.h / 2)) - Math.hypot(b.x + b.w / 2 - (visible.x + visible.w / 2), b.y + b.h / 2 - (visible.y + visible.h / 2)));
    const activeImages = new Set(imageNodes.map(node => node.assetId!).slice(0, IMAGE_COUNT));
    // A large overview gets smaller decoded thumbnails, not a full-resolution
    // bitmap per photograph. Retain at most the closest 64 visible assets.
    for (const [id] of this.images) if (!activeImages.has(id)) this.evict(id);
    const imageBudget = IMAGE_PIXELS / Math.max(1, activeImages.size);
    for (const node of visibleNodes) if (node.kind === 'frame') drawNode(ctx, node, undefined, false, node.fontSize * zoom >= 5);
    const paths=new Map(doc.edges.map(e=>[e.id,edgePoints(e,doc,nodeIndex)]));
    ctx.font=`12px ${FONT}`;const labels=layoutEdgeLabels(doc,paths,t=>ctx.measureText(t).width);
    this.blockedEdges = [];
    for (const edge of doc.edges) {
      const points = paths.get(edge.id)!;
      if (!points.length) this.blockedEdges.push(edge.id);
      if (points.length) {
        const xs = points.map(p => p.x), ys = points.map(p => p.y);
        const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        if (intersects(inflate(box, 60), visible)) drawEdge(ctx, edge, points, state.edgeSelection === edge.id, zoom, labels.get(edge.id));
      }
    }
    for (const node of visibleNodes) {
      if (node.kind === 'frame') continue;
      let cached: CachedImage | undefined;
      if (node.kind === 'image' && node.assetId && activeImages.has(node.assetId)) {
        const asset = doc.assets[node.assetId];
        const aspect = Math.max(asset.width, asset.height) / Math.max(1, Math.min(asset.width, asset.height));
        const maximum = Math.max(32, Math.floor(Math.min(2048, Math.sqrt(imageBudget * aspect), Math.max(node.w, node.h) * zoom * this.ratio / Math.max(.05,Math.min(node.crop?.w??1,node.crop?.h??1)))));
        cached = this.requestImage(asset, maximum, imageBudget);
      }
      drawNode(ctx, node, cached?.bitmap, cached?.failed, node.fontSize * zoom >= 5);
    }
    const activeEdge=doc.edges.find(e=>e.id===state.edgeSelection);
    if(activeEdge?.style==='elbow'){
      const points=edgePoints(activeEdge,doc,nodeIndex);
      const handles=routeHandles(activeEdge,points).map(h=>h.point);
      ctx.fillStyle='#fff';ctx.strokeStyle=ACCENT;ctx.lineWidth=1.5/zoom;
      for(const p of handles){ctx.fillRect(p.x-4/zoom,p.y-4/zoom,8/zoom,8/zoom);ctx.strokeRect(p.x-4/zoom,p.y-4/zoom,8/zoom,8/zoom);}
      for(const p of [points[0],points.at(-1)])if(p){ctx.beginPath();ctx.arc(p.x,p.y,5/zoom,0,Math.PI*2);ctx.fill();ctx.stroke();}
    }
    for (const node of doc.nodes) if (state.selection.has(node.id)) selection(ctx, node, zoom);
    if (state.remote?.size) {
      // Recent edits from an external agent: outline plus a name tag, like a co-editor in a shared document.
      ctx.save(); ctx.strokeStyle = REMOTE; ctx.lineWidth = 2.5 / zoom; ctx.setLineDash([]);
      for (const edge of doc.edges) { const points = state.remote.has(edge.id) ? paths.get(edge.id) : undefined; if (points?.length) { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); } }
      ctx.font = `600 ${11 / zoom}px ${FONT}`; ctx.textBaseline = 'middle';
      for (const node of visibleNodes) if (state.remote.has(node.id)) {
        const box = inflate(node, 5 / zoom), h = 16 / zoom, w = ctx.measureText('AI').width + 10 / zoom;
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.fillStyle = REMOTE; ctx.fillRect(box.x, box.y - h, w, h); ctx.fillStyle = '#fff'; ctx.fillText('AI', box.x + 5 / zoom, box.y - h / 2);
      }
      ctx.restore();
    }
    if (state.marquee) {
      const b = state.marquee; ctx.fillStyle = 'rgba(247,107,21,.09)'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1 / zoom;
      ctx.fillRect(b.x, b.y, b.w, b.h); ctx.strokeRect(b.x, b.y, b.w, b.h);
    }
    if (state.connection) {
      const { from, to } = state.connection;
      ctx.strokeStyle = ACCENT; ctx.fillStyle = ACCENT; ctx.lineWidth = 2 / zoom; ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.setLineDash([]);
      arrow(ctx, to, from, 10 / zoom);
    }
    if (state.guides) {
      ctx.strokeStyle = PALETTE.accentText; ctx.lineWidth = 1 / zoom; ctx.setLineDash([4 / zoom, 4 / zoom]);
      for (const guide of state.guides) {
        ctx.beginPath();
        if (guide.axis === 'x') { ctx.moveTo(guide.value, visible.y); ctx.lineTo(guide.value, visible.y + visible.h); }
        else { ctx.moveTo(visible.x, guide.value); ctx.lineTo(visible.x + visible.w, guide.value); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.imageQueue.length = 0;
    for (const id of this.images.keys()) this.evict(id);
    this.canvas.width = 1; this.canvas.height = 1;
  }
}

function documentBounds(doc: FlowDocument): Box {
  const box = bounds(doc.nodes);
  const all = { ...box };
  const nodeIndex = new Map(doc.nodes.map(node => [node.id, node])); prepareRoutes(doc, nodeIndex);
  for (const edge of doc.edges) for (const p of edgePoints(edge, doc, nodeIndex)) {
    const right = Math.max(all.x + all.w, p.x + 15), bottom = Math.max(all.y + all.h, p.y + 15);
    all.x = Math.min(all.x, p.x - 15); all.y = Math.min(all.y, p.y - 15);
    all.w = right - all.x; all.h = bottom - all.y;
  }
  const measure=typeof document!=='undefined'?document.createElement('canvas').getContext('2d'):null;
  if(measure)measure.font=`12px ${FONT}`;
  const labels=layoutEdgeLabels(doc,new Map(doc.edges.map(e=>[e.id,edgePoints(e,doc,nodeIndex)])),measure?t=>measure.measureText(t).width:undefined);
  for(const {box} of labels.values()){const right=Math.max(all.x+all.w,box.x+box.w),bottom=Math.max(all.y+all.h,box.y+box.h);all.x=Math.min(all.x,box.x);all.y=Math.min(all.y,box.y);all.w=right-all.x;all.h=bottom-all.y;}
  return inflate(all, PAD);
}

export async function renderPNG(doc: FlowDocument, scale = 2): Promise<string> {
  const box = documentBounds(doc);
  const safeScale = Math.max(Number.EPSILON, Math.min(scale, 8192 / Math.max(box.w, box.h), Math.sqrt(32_000_000 / (box.w * box.h))));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.w * safeScale)); canvas.height = Math.max(1, Math.round(box.h * safeScale));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('이미지 내보내기를 시작할 수 없습니다.');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(safeScale, safeScale); ctx.translate(-box.x, -box.y);
  const nodeIndex = new Map(doc.nodes.map(node => [node.id, node])); prepareRoutes(doc, nodeIndex);
  for (const node of doc.nodes) if (node.kind === 'frame') drawNode(ctx, { ...node, locked: false });
  ctx.font=`12px ${FONT}`;
  const paths=new Map(doc.edges.map(e=>[e.id,edgePoints(e,doc,nodeIndex)]));
  const labels=layoutEdgeLabels(doc,paths,t=>ctx.measureText(t).width);
  for (const edge of doc.edges) drawEdge(ctx, edge, paths.get(edge.id)!, false, 1, labels.get(edge.id), '#fff');
  for (const node of doc.nodes) {
    if (node.kind === 'frame') continue;
    let bitmap: Bitmap | undefined;
    if (node.kind === 'image' && node.assetId && doc.assets[node.assetId]) {
      bitmap = await decodeImage(doc.assets[node.assetId], Math.min(8192, Math.max(node.w, node.h) * safeScale / Math.max(.01,Math.min(node.crop?.w??1,node.crop?.h??1))));
    }
    drawNode(ctx, { ...node, locked: false }, bitmap);
    closeImage(bitmap);
  }
  const data = canvas.toDataURL('image/png');
  canvas.width = canvas.height = 1;
  return data;
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function svgColor(value: string): string { return escape(value === 'transparent' ? 'none' : value); }
function n(value: number): string { return String(Math.round(value * 100) / 100); }

function svgArrow(tip: Point, from: Point, size: number, color: string): string {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const p1 = { x: tip.x - size * Math.cos(a - Math.PI / 6), y: tip.y - size * Math.sin(a - Math.PI / 6) };
  const p2 = { x: tip.x - size * Math.cos(a + Math.PI / 6), y: tip.y - size * Math.sin(a + Math.PI / 6) };
  return `<path d="M${n(tip.x)},${n(tip.y)} L${n(p1.x)},${n(p1.y)} L${n(p2.x)},${n(p2.y)} Z" fill="${svgColor(color)}"/>`;
}

function svgText(node: FlowNode, measure?: CanvasRenderingContext2D | null): string {
  const box = textBox(node), fs = node.kind === 'frame' ? Math.min(18, node.fontSize) : node.fontSize;
  const rich=svgRichContent(node,box,FONT,measure);if(rich!==null)return rich;
  if (!node.text) return '';
  if (measure) measure.font = `${node.bold ? 600 : 400} ${fs}px ${FONT}`;
  const lines = lineSegments(node.text, Math.max(1, box.w), text => measure?.measureText(text).width ?? [...text].reduce((sum, char) => sum + fs * (char.charCodeAt(0) > 255 ? 1 : .55), 0));
  const lh = fs * 1.45, align = node.kind === 'frame' ? 'left' : node.align;
  const top = node.kind === 'note' || node.kind === 'text' || node.kind === 'frame';
  const start = box.y + (top ? lh / 2 : Math.max(lh / 2, (box.h - lines.length * lh) / 2 + lh / 2));
  const tx = box.x + (align === 'center' ? box.w / 2 : align === 'right' ? box.w : 0);
  const visible = lines.filter((_, i) => start + i * lh - fs / 2 <= box.y + box.h);
  return `<text font-family="${escape(FONT)}" font-size="${n(fs)}" font-weight="${node.bold ? 600 : 400}" text-anchor="${align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'}" dominant-baseline="central" fill="${svgColor(node.color)}">${visible.map((line, i) => `<tspan x="${n(tx)}" y="${n(start + i * lh)}">${escape(line)}</tspan>`).join('')}</text>`;
}

export function renderSVG(doc: FlowDocument): string {
  const box = documentBounds(doc), parts: string[] = [];
  const frameParts: string[] = [];
  const nodeIndex = new Map(doc.nodes.map(node => [node.id, node])); prepareRoutes(doc, nodeIndex);
  const measure = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if(measure)measure.font=`12px ${FONT}`;
  const paths=new Map(doc.edges.map(e=>[e.id,edgePoints(e,doc,nodeIndex)]));
  const labels=layoutEdgeLabels(doc,paths,measure?t=>measure.measureText(t).width:undefined);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${n(box.x)} ${n(box.y)} ${n(box.w)} ${n(box.h)}" width="${n(box.w)}" height="${n(box.h)}" role="img"><title>${escape(doc.title)}</title><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" fill="white"/>`);
  for (const edge of doc.edges) {
    const points = edgePoints(edge, doc, nodeIndex);
    if (points.length < 2) continue;
    parts.push(`<polyline points="${points.map(p=>`${n(p.x)},${n(p.y)}`).join(' ')}" fill="none" stroke="white" stroke-width="${n(edge.width+4)}" stroke-linejoin="miter"/>`);
    parts.push(`<polyline points="${points.map(p => `${n(p.x)},${n(p.y)}`).join(' ')}" fill="none" stroke="${svgColor(edge.color)}" stroke-width="${n(edge.width)}" stroke-linejoin="${edge.style === 'elbow' ? 'miter' : 'round'}" stroke-linecap="${edge.style === 'elbow' ? 'butt' : 'round'}" stroke-miterlimit="2"${edge.dashed ? ' stroke-dasharray="7 5"' : ''}/>`);
    const size = Math.max(9, edge.width * 4);
    if (edge.arrow === 'end' || edge.arrow === 'both') parts.push(svgArrow(points[points.length - 1], points[points.length - 2], size, edge.color));
    if (edge.arrow === 'both') parts.push(svgArrow(points[0], points[1], size, edge.color));
    const label=labels.get(edge.id);
    if(label){const {center,lines,leader,angle,textWidth,textHeight}=label;
      if(leader.length)parts.push(`<polyline points="${leader.map(p=>`${n(p.x)},${n(p.y)}`).join(' ')}" fill="none" stroke="${svgColor(edge.color)}" stroke-width=".8"/>`);
      parts.push(`<g transform="translate(${n(center.x)} ${n(center.y)}) rotate(${angle})"><rect x="${n(-textWidth/2)}" y="${n(-textHeight/2)}" width="${n(textWidth)}" height="${n(textHeight)}" rx="4" fill="${svgColor(edge.labelBackground??'#ffffff')}"/><text text-anchor="middle" dominant-baseline="central" font-family="${escape(FONT)}" font-size="12" fill="${svgColor(edge.color)}">${lines.map((line,i)=>`<tspan x="0" y="${n(-textHeight/2+12+i*16)}">${escape(line)}</tspan>`).join('')}</text></g>`);
    }
  }
  for (const node of doc.nodes) {
    const start = parts.length;
    const { x, y, w, h } = node;
    const attrs = `fill="${node.kind === 'draw' ? 'none' : svgColor(node.fill)}" stroke="${svgColor(node.stroke)}" stroke-width="${n(node.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"${node.dashed ? ' stroke-dasharray="8 5"' : ''}`;
    parts.push(`<g opacity="${n(node.opacity ?? 1)}">`);
    if (node.kind === 'ellipse') parts.push(`<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" ${attrs}/>`);
    else if (node.kind === 'diamond') parts.push(`<polygon points="${n(x + w / 2)},${n(y)} ${n(x + w)},${n(y + h / 2)} ${n(x + w / 2)},${n(y + h)} ${n(x)},${n(y + h / 2)}" ${attrs}/>`);
    else if (node.kind === 'draw') parts.push(`<polyline points="${(node.points ?? []).map(p => `${n(x + p.x)},${n(y + p.y)}`).join(' ')}" ${attrs}/>`);
    else parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${node.kind === 'round' ? 15 : node.kind === 'frame' || node.kind === 'image' ? 8 : 0}" ${attrs}/>`);
    if (node.kind === 'note') parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="7" fill="black" opacity=".045"/>`);
    if (node.kind === 'frame') parts.push(`<path d="M${n(x)} ${n(y + 43)}H${n(x + w)}" stroke="${svgColor(node.stroke)}" stroke-width=".8"/>`);
    if (node.kind === 'image' && node.assetId) {
      const asset = doc.assets[node.assetId];
      if (asset && rasterData(asset.data)) {
        const crop=node.crop??{x:0,y:0,w:1,h:1},clipId=`crop-${node.id}`;
        parts.push(`<defs><clipPath id="${escape(clipId)}"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="8"/></clipPath></defs><g clip-path="url(#${escape(clipId)})"><g transform="rotate(${n(node.rotation??0)} ${n(x+w/2)} ${n(y+h/2)})"><svg x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" viewBox="${n(crop.x*asset.width)} ${n(crop.y*asset.height)} ${n(crop.w*asset.width)} ${n(crop.h*asset.height)}" preserveAspectRatio="none"><image width="${asset.width}" height="${asset.height}" preserveAspectRatio="none" xlink:href="${escape(asset.data)}"/></svg></g></g>`);
      }
      if (node.text) parts.push(`<rect x="${n(x)}" y="${n(y + h - 40)}" width="${n(w)}" height="40" fill="white" opacity=".93"/>`);
    }
    if (node.kind !== 'draw') parts.push(svgText(node, measure));
    parts.push('</g>');
    if (node.kind === 'frame') frameParts.push(...parts.splice(start));
  }
  parts.push('</svg>');
  return parts[0] + frameParts.join('') + parts.slice(1).join('');
}

export function drawMinimap(canvas: HTMLCanvasElement, doc: FlowDocument, viewportWidth: number, viewportHeight: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.clientWidth || 184, height = canvas.clientHeight || 114;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, width, height);
  const box = inflate(bounds(doc.nodes), 80), scale = Math.min((width - 14) / box.w, (height - 14) / box.h);
  const ox = (width - box.w * scale) / 2 - box.x * scale, oy = (height - box.h * scale) / 2 - box.y * scale;
  const nodeIndex = new Map(doc.nodes.map(node => [node.id, node])); prepareRoutes(doc, nodeIndex);
  ctx.translate(ox, oy); ctx.scale(scale, scale);
  for (const node of doc.nodes) if (node.kind === 'frame') {
    ctx.fillStyle = node.fill === 'transparent' ? '#FFFFFF' : node.fill; ctx.strokeStyle = node.stroke;
    ctx.lineWidth = .65 / scale; pathNode(ctx, node); ctx.fill(); ctx.stroke();
  }
  for (const edge of doc.edges) {
    const points = edgePoints(edge, doc, nodeIndex); if (!points.length) continue;
    ctx.strokeStyle = edge.color; ctx.lineWidth = 1 / scale;
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); for (const p of points.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  for (const node of doc.nodes) {
    if (node.kind === 'frame') continue;
    ctx.fillStyle = node.fill === 'transparent' ? '#B5C1D1' : node.fill; ctx.strokeStyle = node.stroke === 'transparent' ? '#98A6B9' : node.stroke;
    ctx.lineWidth = .65 / scale; pathNode(ctx, node);
    if (node.kind !== 'draw') ctx.fill(); ctx.stroke();
  }
  const v = doc.viewport;
  ctx.strokeStyle = ACCENT; ctx.fillStyle = 'rgba(247,107,21,.08)'; ctx.lineWidth = 1.5 / scale;
  ctx.fillRect(-v.x / v.zoom, -v.y / v.zoom, viewportWidth / v.zoom, viewportHeight / v.zoom);
  ctx.strokeRect(-v.x / v.zoom, -v.y / v.zoom, viewportWidth / v.zoom, viewportHeight / v.zoom);
}
