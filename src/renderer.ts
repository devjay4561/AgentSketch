import type { Asset, Box, FlowDocument, FlowEdge, FlowNode, Point, RenderState } from './types.ts';
import { bounds, edgePoints, portPoint, prepareRoutes, routeHandles } from './geometry.ts';
import { PALETTE, boardFont } from './theme.ts';
import { loadBoardFont, boardFontId, useBoardFont } from './fonts.ts';
import { renderRichContent, svgRichContent, WRAP_TOKENS } from './rich-render.ts';
import { edgeLabelFont, EDGE_LABEL_LINE, EDGE_LABEL_SIZE, layoutEdgeLabels, type EdgeLabel } from './edge-labels.ts';
import { graphicsProfile } from './graphics.ts';
import { t } from './i18n.ts';

const PAPER = PALETTE.paper;
const ACCENT = PALETTE.accent;
const REMOTE = '#2F6FED';
const IMAGE_COUNT = 64;
const PAD = 40;

type Bitmap = ImageBitmap | HTMLImageElement | HTMLCanvasElement;
type CachedImage = { data: string; bitmap?: Bitmap; loading: boolean; failed: number | null; pixels: number; maximum: number };

export function quantizeImageSide(wanted: number, limit: number): number {
  const step = Math.ceil(Math.log(Math.max(32, wanted) / 32) / Math.log(1.25));
  return Math.min(limit, Math.ceil(32 * 1.25 ** step));
}

function intersects(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function inflate(b: Box, amount: number): Box {
  return { x: b.x - amount, y: b.y - amount, w: b.w + amount * 2, h: b.h + amount * 2 };
}

function rasterData(data: string): boolean {
  return /^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=\r\n]+$/.test(data);
}

function decodedImageSize(asset: Asset, maximum: number) {
  const ratio = Math.min(1, maximum / Math.max(asset.width, asset.height));
  return { width: Math.max(1, Math.round(asset.width * ratio)), height: Math.max(1, Math.round(asset.height * ratio)) };
}

async function decodeImage(asset: Asset, maximum: number): Promise<Bitmap> {
  if (!rasterData(asset.data)) throw new Error('지원하지 않는 이미지입니다.');
  const { width, height } = decodedImageSize(asset, maximum);
  if (typeof createImageBitmap === 'function') {
    const raw = atob(asset.data.substring(asset.data.indexOf(',') + 1));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const type = asset.data.substring(5, asset.data.indexOf(';'));
    return createImageBitmap(new Blob([bytes], { type }), {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    });
  }
  const image = new Image();
  image.src = asset.data;
  await image.decode();
  if (image.width === width && image.height === height) return image;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('이미지를 준비할 수 없습니다. 앱을 다시 열어주세요.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    image.src = '';
  }
}

function closeImage(bitmap?: Bitmap): void {
  if (bitmap && 'close' in bitmap) bitmap.close();
  else if (bitmap && 'src' in bitmap) bitmap.src = '';
  else if (bitmap) bitmap.width = bitmap.height = 1;
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

function exportTextBox(node: FlowNode): Box {
  const box = textBox(node);
  return box.w > 0 && box.h > 0 ? box : {x:node.x,y:node.y,w:node.w,h:node.h};
}

function plainTextScale(lines: string[], box: Box, fontSize: number, measure: (text: string) => number): number {
  const longest = lines.reduce((width,line) => Math.max(width,measure(line)),1);
  return Math.min(1, box.w/longest, box.h/(lines.length*fontSize*1.45));
}

export function shapeRadius(node: Pick<FlowNode, 'kind' | 'w' | 'h'>): number {
  const radius = node.kind === 'round' ? 14 : node.kind === 'frame' ? 12 : node.kind === 'image' || node.kind === 'note' ? 8 : 6;
  return Math.min(radius, node.w / 2, node.h / 2);
}

function diamondVertices(x: number, y: number, w: number, h: number): Point[] {
  return [{x:x+w/2,y}, {x:x+w,y:y+h/2}, {x:x+w/2,y:y+h}, {x,y:y+h/2}];
}

function diamondCut(w: number, h: number): number {
  return Math.min(8, Math.min(w, h) / 4);
}

function pathNode(ctx: CanvasRenderingContext2D, node: FlowNode, simplified = false): void {
  const { x, y, w, h, kind } = node;
  ctx.beginPath();
  if (kind === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, Math.max(.5, w / 2), Math.max(.5, h / 2), 0, 0, Math.PI * 2);
  else if (kind === 'diamond') {
    if (simplified) {
      ctx.moveTo(x+w/2,y);ctx.lineTo(x+w,y+h/2);ctx.lineTo(x+w/2,y+h);ctx.lineTo(x,y+h/2);ctx.closePath();
      return;
    }
    const points = diamondVertices(x, y, w, h), cut = diamondCut(w, h);
    ctx.moveTo(x + w / 4, y + h / 4);
    for (const [i, p] of points.entries()) {
      const next = points[(i + 1) % 4];
      ctx.arcTo(p.x, p.y, next.x, next.y, cut * (i % 2 ? h / w : w / h));
    }
    ctx.closePath();
  } else if (kind === 'draw') {
    const points = node.points ?? [];
    if (points.length) {
      ctx.moveTo(x + points[0].x, y + points[0].y);
      for (const p of points.slice(1)) ctx.lineTo(x + p.x, y + p.y);
    }
  } else if (kind === 'text' || simplified) ctx.rect(x, y, w, h);
  else ctx.roundRect(x, y, w, h, shapeRadius(node));
}

function drawText(ctx: CanvasRenderingContext2D, node: FlowNode, fit: boolean): void {
  const box = fit ? exportTextBox(node) : textBox(node);
  if (renderRichContent(ctx,node,box,boardFont(),fit)) return;
  if (!node.text) return;
  if (!fit && (box.w < 4 || box.h < 4)) return;
  let fontSize = node.kind === 'frame' ? Math.min(18, node.fontSize) : node.fontSize;
  const weight = node.bold ? 600 : 500;
  ctx.save();
  ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  ctx.font = `${weight} ${fontSize}px ${boardFont()}`;
  ctx.fillStyle = node.color;
  ctx.textBaseline = 'alphabetic';
  ctx.fontKerning = 'normal';
  const align = node.kind === 'frame' ? 'left' : node.align;
  ctx.textAlign = align;
  const measure = (text: string) => ctx.measureText(text).width;
  const lines = lineSegments(node.text, box.w, measure);
  if (fit) {
    fontSize *= plainTextScale(lines,box,fontSize,measure);
    ctx.font = `${weight} ${fontSize}px ${boardFont()}`;
  }
  const lh = fontSize * 1.45;
  const top = node.kind === 'note' || node.kind === 'text' || node.kind === 'frame';
  const start = box.y + (top ? lh / 2 : Math.max(lh / 2, (box.h - lines.length * lh) / 2 + lh / 2));
  const tx = box.x + (align === 'center' ? box.w / 2 : align === 'right' ? box.w : 0);
  // 'middle' puts the baseline at a fractional device pixel; Hangul's many horizontal
  // strokes then smear across two rows. Place the baseline ourselves and snap it.
  // Font-level box metrics are the same for any probe text; fall back to Pretendard's ratio.
  const metrics = ctx.measureText('Ag');
  const shift = Number.isFinite(metrics.fontBoundingBoxAscent) ? (metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2 : fontSize * .35;
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : undefined;
  const snap = (y: number) => fit || !m?.d ? y : (Math.round(m.d * y + m.f) - m.f) / m.d;
  lines.forEach((line, i) => ctx.fillText(line, tx, snap(start + i * lh + shift)));
  ctx.restore();
}

function hasDepth(node: FlowNode): boolean {
  return node.kind !== 'text' && node.kind !== 'draw' && (node.opacity ?? 1) === 1 &&
    node.fill !== 'transparent' && (node.fill.length !== 9 || node.fill.slice(7).toLowerCase() === 'ff');
}

type ShapeEffects = 'flat' | 'low' | 'rich';

function drawNode(ctx: CanvasRenderingContext2D, node: FlowNode, bitmap?: Bitmap, imageFailed = false, textVisible = true, effects: ShapeEffects = 'flat', pixelScale = 1, fitText = false, simplified = false): void {
  ctx.save();
  ctx.globalAlpha *= node.opacity ?? 1;
  ctx.lineWidth = node.strokeWidth;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = node.stroke; ctx.fillStyle = node.fill;
  ctx.setLineDash(node.dashed ? [8, 5] : []);
  pathNode(ctx, node, simplified);
  if (node.kind === 'draw') ctx.stroke();
  else {
    if (node.fill !== 'transparent') {
      const depth = effects !== 'flat' && hasDepth(node);
      if (depth && effects === 'rich') {
        ctx.shadowColor = 'rgba(16,24,40,.08)'; ctx.shadowOffsetY = pixelScale; ctx.shadowBlur = 2 * pixelScale;
        ctx.fill();
        ctx.shadowColor = 'rgba(16,24,40,.13)'; ctx.shadowOffsetY = 5 * pixelScale; ctx.shadowBlur = 16 * pixelScale;
        ctx.fill();
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.save(); ctx.clip();
        const highlight = ctx.createLinearGradient(0, node.y, 0, node.y + node.h);
        highlight.addColorStop(0, 'rgba(255,255,255,.07)');
        highlight.addColorStop(.08, 'rgba(255,255,255,.025)');
        highlight.addColorStop(1, 'rgba(16,24,40,.025)');
        ctx.fillStyle = highlight; ctx.fillRect(node.x, node.y, node.w, node.h);
        ctx.fillStyle = 'rgba(255,255,255,.20)'; ctx.fillRect(node.x, node.y, node.w, 1);
        ctx.restore();
      } else {
        if (depth) {
          ctx.save(); ctx.translate(0, 2); pathNode(ctx, node); ctx.fillStyle = 'rgba(16,24,40,.12)'; ctx.fill(); ctx.restore();
          pathNode(ctx, node);
        }
        ctx.fill();
      }
    }
    if (node.strokeWidth > 0 && node.stroke !== 'transparent') ctx.stroke();
  }
  if (node.kind === 'note') {
    ctx.save(); ctx.clip(); ctx.fillStyle = node.stroke;
    ctx.fillRect(node.x, node.y, node.w, 3); ctx.restore();
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
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = graphicsProfile().smoothing;
      ctx.drawImage(bitmap,crop.x*bitmap.width,crop.y*bitmap.height,crop.w*bitmap.width,crop.h*bitmap.height,node.x,node.y,node.w,node.h);
      ctx.restore();
      if (node.text) { ctx.fillStyle = 'rgba(255,255,255,.93)'; ctx.fillRect(node.x, node.y + node.h - 40, node.w, 40); }
    } else {
      ctx.fillStyle = '#EFF2F6'; ctx.fillRect(node.x, node.y, node.w, node.h);
      const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
      ctx.strokeStyle = '#98A3B2'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
      ctx.strokeRect(cx - 18, cy - 24, 36, 30);
      ctx.beginPath(); ctx.moveTo(cx - 15, cy + 2); ctx.lineTo(cx - 4, cy - 9); ctx.lineTo(cx + 4, cy - 2); ctx.lineTo(cx + 10, cy - 8); ctx.lineTo(cx + 16, cy + 2); ctx.stroke();
      ctx.fillStyle = PALETTE.muted; ctx.font = `12px ${boardFont()}`; ctx.textAlign = 'center';
      if (textVisible) ctx.fillText(imageFailed ? t('이미지를 읽을 수 없습니다') : t('이미지'), cx, cy + 27, node.w - 12);
    }
    ctx.restore();
  }
  if (node.kind !== 'draw' && textVisible) drawText(ctx, node, fitText);
  if (node.locked) {
    const x = node.x + node.w - 13, y = node.y + 12;
    ctx.strokeStyle = PALETTE.muted; ctx.fillStyle = PAPER; ctx.lineWidth = 1.3; ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y - 2, 3, Math.PI, 0); ctx.stroke();
    ctx.fillRect(x - 4, y - 2, 8, 7); ctx.strokeRect(x - 4, y - 2, 8, 7);
  }
  ctx.restore();
}

type Arrow = [tip: Point, wing: Point, notch: Point, otherWing: Point];

function arrow(tip: Point, from: Point, size: number, fraction: number): Arrow | undefined {
  const dx = tip.x - from.x, dy = tip.y - from.y, length = Math.hypot(dx, dy);
  if (!length) return;
  const ratio = Math.min(size / length, fraction), x = dx * ratio, y = dy * ratio;
  return [tip,
    {x:tip.x-x+y*.34, y:tip.y-y-x*.34},
    {x:tip.x-x*.74, y:tip.y-y*.74},
    {x:tip.x-x-y*.34, y:tip.y-y+x*.34}];
}

function drawArrow(ctx: CanvasRenderingContext2D, points: Arrow | undefined): void {
  if (!points) return;
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath(); ctx.fill();
}

export function edgeArrows(points: Point[], edge: Pick<FlowEdge, 'arrow' | 'width'>) {
  if (points.length < 2) return {};
  const size = 8 + edge.width * 2, fraction = points.length === 2 && edge.arrow === 'both' ? .48 : .85;
  const start = edge.arrow === 'both' ? arrow(points[0], points[1], size, fraction) : undefined;
  const end = edge.arrow !== 'none' ? arrow(points[points.length - 1], points[points.length - 2], size, fraction) : undefined;
  return { start, end };
}

export function visualEdgePoints(points: Point[], edge: FlowEdge, nodes: ReadonlyMap<string, FlowNode>): Point[] {
  if (points.length < 2) return points;
  const first = nodes.get(edge.from), last = nodes.get(edge.to);
  const startDiamond = first?.kind === 'diamond' && !edge.fromAnchor;
  const endDiamond = last?.kind === 'diamond' && !edge.toAnchor;
  if (!startDiamond && !endDiamond) return points;
  const adjust = (p: Point, node: FlowNode, port: FlowEdge['fromPort']): Point => {
    const {w,h}=node, cut=diamondCut(w,h), diagonal=Math.hypot(w,h);
    const x=cut*w/(diagonal+h), y=cut*h/(diagonal+w);
    return {x:p.x+(port==='left'?x:port==='right'?-x:0),y:p.y+(port==='top'?y:port==='bottom'?-y:0)};
  };
  return [
    startDiamond ? adjust(points[0],first,edge.fromPort) : points[0],
    ...points.slice(1,-1),
    endDiamond ? adjust(points[points.length-1],last,edge.toPort) : points[points.length-1],
  ];
}

function elbowRadius(a: Point, b: Point, c: Point): number {
  if (a.x === b.x && b.y === c.y) return Math.min(8, Math.abs(b.y-a.y)/2, Math.abs(c.x-b.x)/2);
  if (a.y === b.y && b.x === c.x) return Math.min(8, Math.abs(b.x-a.x)/2, Math.abs(c.y-b.y)/2);
  return 0;
}

function traceEdge(ctx: CanvasRenderingContext2D, points: Point[], first: Point, last: Point, round: boolean): void {
  ctx.beginPath(); ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], next = i === points.length - 2 ? last : points[i+1];
    const radius = round ? elbowRadius(i === 1 ? first : points[i-1], p, next) : 0;
    if (radius) ctx.arcTo(p.x, p.y, next.x, next.y, radius);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.lineTo(last.x, last.y);
}

function drawEdge(ctx: CanvasRenderingContext2D, edge: FlowEdge, points: Point[], selected = false, zoom = 1, label?: EdgeLabel, background: string = PAPER): void {
  if (points.length < 2) return;
  const { start, end } = selected || (8 + edge.width * 2) * zoom >= 1 ? edgeArrows(points, edge) : {};
  const elbow = edge.style === 'elbow';
  ctx.save(); ctx.lineJoin = elbow ? 'miter' : 'round'; ctx.lineCap = elbow || start || end ? 'butt' : 'round';
  ctx.miterLimit = 2;
  traceEdge(ctx, points, start?.[2] ?? points[0], end?.[2] ?? points[points.length - 1], elbow && zoom >= .125);
  // A narrow paper casing makes a crossing visibly different from a junction.
  ctx.lineWidth=edge.width+4/zoom;ctx.strokeStyle=background;ctx.stroke();
  if (selected) { ctx.lineWidth = edge.width + 7 / zoom; ctx.strokeStyle = PALETTE.accentSoft; ctx.stroke(); }
  ctx.strokeStyle = edge.color; ctx.fillStyle = edge.color; ctx.lineWidth = edge.width;
  ctx.setLineDash(edge.dashed ? [7, 5] : []); ctx.stroke(); ctx.setLineDash([]);
  drawArrow(ctx, end); drawArrow(ctx, start);
  if (label) {
    const {center,lines,leader,angle,textWidth,textHeight}=label;
    if(leader.length){ctx.strokeStyle=edge.color;ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(leader[0].x,leader[0].y);for(const p of leader.slice(1))ctx.lineTo(p.x,p.y);ctx.stroke();}
    ctx.save();ctx.translate(center.x,center.y);ctx.rotate(angle*Math.PI/180);
    ctx.fillStyle=edge.labelBackground??'#fff';ctx.beginPath();ctx.roundRect(-textWidth/2,-textHeight/2,textWidth,textHeight,textHeight/2);ctx.fill();
    const alpha=ctx.globalAlpha;ctx.globalAlpha=alpha*.25;ctx.strokeStyle=edge.color;ctx.lineWidth=1;ctx.stroke();ctx.globalAlpha=alpha;
    ctx.fillStyle=edge.color;ctx.font=edgeLabelFont();ctx.textAlign='center';ctx.textBaseline='middle';
    lines.forEach((line,i)=>ctx.fillText(line,0,(i-(lines.length-1)/2)*EDGE_LABEL_LINE));ctx.restore();
  }
  ctx.restore();
}

function focusRing(ctx: CanvasRenderingContext2D, node: FlowNode, zoom: number, rich: boolean, pixelScale: number, strength: number, primary: boolean): void {
  const gap = (primary ? 3 : 2) / zoom, box = inflate(node, gap);
  ctx.save(); ctx.setLineDash([]);
  ctx.beginPath();
  if (node.kind === 'ellipse') ctx.ellipse(node.x + node.w / 2, node.y + node.h / 2, node.w / 2 + gap, node.h / 2 + gap, 0, 0, Math.PI * 2);
  else ctx.roundRect(box.x, box.y, box.w, box.h, Math.min(shapeRadius(node) + gap, box.w / 2, box.h / 2));
  ctx.globalAlpha = primary ? strength : .55 * strength;
  ctx.strokeStyle = ACCENT; ctx.lineWidth = (primary ? 2 : 1.25) / zoom;
  if (rich && primary) { ctx.shadowColor = 'rgba(247,107,21,.45)'; ctx.shadowBlur = 10 * pixelScale; }
  ctx.stroke();
  ctx.restore();
}

function selection(ctx: CanvasRenderingContext2D, node: FlowNode, zoom: number, rich: boolean, pixelScale: number): void {
  const box = inflate(node, 3 / zoom), size = 7 / zoom;
  ctx.save(); ctx.strokeStyle = ACCENT; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5 / zoom; ctx.setLineDash([]);
  ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, Math.min(shapeRadius(node) + 3/zoom, box.w/2, box.h/2));
  if (rich) { ctx.shadowColor = 'rgba(247,107,21,.28)'; ctx.shadowBlur = 5 * pixelScale; }
  ctx.stroke(); ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  if (!node.locked) {
    for (const x of [node.x, node.x + node.w]) for (const y of [node.y, node.y + node.h]) {
      ctx.beginPath(); ctx.roundRect(x - size / 2, y - size / 2, size, size, 2/zoom); ctx.fill(); ctx.stroke();
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
  private reservedImagePixels = 0;
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
    this.ratio = Math.min(graphicsProfile().maxPixelRatio, window.devicePixelRatio || 1);
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

  private requestImage(asset: Asset, maximum: number, limit: number, pixelsBudget: number): void {
    let entry = this.images.get(asset.id);
    if (!entry) {
      entry = { data: asset.data, loading: false, failed: null, pixels: 0, maximum: 0 };
      this.images.set(asset.id, entry);
    }
    if (entry.loading || entry.failed === maximum) return;
    const upgrade = maximum > entry.maximum * graphicsProfile().redecodeFactor || (maximum === limit && limit > entry.maximum);
    if (!upgrade && entry.pixels <= pixelsBudget && entry.maximum <= limit) return;
    const { width, height } = decodedImageSize(asset, maximum);
    const growth = Math.max(0, width * height - entry.pixels);
    // Wait for larger thumbnails to shrink instead of evicting a visible bitmap mid-decode.
    if (growth && this.imagePixels + this.reservedImagePixels + growth > graphicsProfile().imagePixels) return;
    this.reservedImagePixels += growth;
    entry.loading = true;
    const created = entry;
    this.imageQueue.push(async () => {
      try {
        if (this.disposed || this.images.get(asset.id) !== created) return;
        const bitmap = await decodeImage(asset, maximum);
        if (this.disposed || this.images.get(asset.id) !== created) { closeImage(bitmap); return; }
        const pixels = bitmap.width * bitmap.height;
        closeImage(created.bitmap);
        this.imagePixels += pixels - created.pixels;
        Object.assign(created, { bitmap, pixels, maximum, failed: null });
      } catch {
        created.failed = maximum;
      } finally {
        this.reservedImagePixels -= growth;
        created.loading = false;
        if (!this.disposed && (growth || this.images.get(asset.id) === created)) this.invalidate();
      }
    });
    this.pumpImages();
  }

  render(state: RenderState): void {
    if (this.disposed) return;
    const { doc } = state, { x, y, zoom } = doc.viewport, ctx = this.ctx;
    useBoardFont(doc, this.invalidate);
    const nodeIndex = new Map(doc.nodes.map(node => [node.id, node])); prepareRoutes(doc, nodeIndex);
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
    const rich = graphicsProfile().richEffects && visibleNodes.length <= 64, pixelScale = zoom * this.ratio, simplified = zoom < .1;
    const effects = (node: FlowNode): ShapeEffects => visibleNodes.length > 400 || Math.min(node.w, node.h) * zoom < 24 ? 'flat' : rich ? 'rich' : 'low';
    const imageNodes = visibleNodes.filter(node => node.kind === 'image' && node.assetId && doc.assets[node.assetId]);
    imageNodes.sort((a, b) => Math.hypot(a.x + a.w / 2 - (visible.x + visible.w / 2), a.y + a.h / 2 - (visible.y + visible.h / 2)) - Math.hypot(b.x + b.w / 2 - (visible.x + visible.w / 2), b.y + b.h / 2 - (visible.y + visible.h / 2)));
    const activeImages = new Map<string, number>();
    for (const node of imageNodes) {
      const id = node.assetId!, asset = doc.assets[id], previous = activeImages.get(id);
      if (previous === undefined && activeImages.size >= IMAGE_COUNT) continue;
      const scale = Math.max(node.w / (asset.width * (node.crop?.w ?? 1)), node.h / (asset.height * (node.crop?.h ?? 1)));
      activeImages.set(id, Math.max(previous ?? 0, scale * zoom * this.ratio * Math.max(asset.width, asset.height)));
    }
    // A large overview gets smaller decoded thumbnails, not a full-resolution
    // bitmap per photograph. Retain at most the closest 64 visible assets.
    for (const [id] of this.images) if (!activeImages.has(id)) this.evict(id);
    const profile = graphicsProfile();
    const imageBudget = profile.imagePixels / Math.max(1, activeImages.size);
    for (const [id, wanted] of activeImages) {
      const asset = doc.assets[id], side = Math.max(asset.width, asset.height), aspect = side / Math.min(asset.width, asset.height);
      let limit = Math.floor(Math.min(side, profile.imageMaxSide, imageBudget, Math.sqrt(imageBudget * aspect)));
      const shortSide = Math.max(1, Math.round(limit / aspect));
      limit = Math.min(limit, Math.floor(imageBudget / shortSide));
      this.requestImage(asset, quantizeImageSide(wanted, limit), limit, imageBudget);
    }
    // Hover focus: the hovered box and its direct neighbours stay solid, the rest fades.
    const hover = state.hover ? nodeIndex.get(state.hover) : undefined, focus = hover ? Math.max(0, Math.min(1, state.focus ?? 0)) : 0;
    const related = new Set<string>(), relatedEdges = new Set<string>();
    if (hover) for (const edge of doc.edges) if (edge.from === hover.id || edge.to === hover.id) { relatedEdges.add(edge.id); related.add(edge.from); related.add(edge.to); }
    const dim = 1 - .62 * focus, nodeAlpha = (node: FlowNode) => !focus || related.has(node.id) || node.id === hover?.id ? 1 : node.kind === 'frame' ? 1 - .35 * focus : dim;
    const textShown = (node: FlowNode) => node.id !== state.editing && node.fontSize * zoom >= 5;
    const paint = (node: FlowNode, bitmap?: Bitmap, failed = false) => { ctx.save(); ctx.globalAlpha = nodeAlpha(node); drawNode(ctx, node, bitmap, failed, textShown(node), effects(node), pixelScale, false, simplified); ctx.restore(); };
    for (const node of visibleNodes) if (node.kind === 'frame') paint(node);
    const paths=new Map(doc.edges.map(e=>[e.id,edgePoints(e,doc,nodeIndex)]));
    ctx.font=edgeLabelFont();const labels=layoutEdgeLabels(doc,paths,t=>ctx.measureText(t).width);
    this.blockedEdges = [];
    const emphasized: Array<[FlowEdge, Point[], EdgeLabel | undefined]> = [];
    for (const edge of doc.edges) {
      const points = paths.get(edge.id)!;
      if (!points.length) this.blockedEdges.push(edge.id);
      if (points.length) {
        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
        for (const p of points) {
          left = Math.min(left, p.x); right = Math.max(right, p.x);
          top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
        }
        const label = labels.get(edge.id);
        if ((left - 60 <= visible.x + visible.w && right + 60 >= visible.x && top - 60 <= visible.y + visible.h && bottom + 60 >= visible.y) ||
          (label && intersects(label.box, visible))) {
          const near = relatedEdges.has(edge.id);
          if (near && focus) { emphasized.push([edge, points, label]); continue; }
          ctx.save(); ctx.globalAlpha = focus ? dim : 1;
          drawEdge(ctx, edge, simplified ? points : visualEdgePoints(points,edge,nodeIndex), state.edgeSelection === edge.id, zoom, label);
          ctx.restore();
        }
      }
    }
    // Connections of the hovered box are drawn last, slightly heavier, above faded lines.
    for (const [edge, points, label] of emphasized) drawEdge(ctx, { ...edge, width: edge.width + .6 * focus }, simplified ? points : visualEdgePoints(points,edge,nodeIndex), state.edgeSelection === edge.id, zoom, label);
    for (const node of visibleNodes) {
      if (node.kind === 'frame') continue;
      const cached = node.kind === 'image' && node.assetId ? this.images.get(node.assetId) : undefined;
      paint(node, cached?.bitmap, Boolean(cached?.failed));
    }
    if (hover && !state.selection.has(hover.id)) focusRing(ctx, hover, zoom, rich, pixelScale, 1, true);
    if (focus) for (const id of related) { const node = nodeIndex.get(id); if (node && id !== hover?.id && !state.selection.has(id)) focusRing(ctx, node, zoom, rich, pixelScale, focus, false); }
    const activeEdge=doc.edges.find(e=>e.id===state.edgeSelection);
    if(activeEdge?.style==='elbow'){
      const points=edgePoints(activeEdge,doc,nodeIndex);
      const handles=routeHandles(activeEdge,points).map(h=>h.point);
      ctx.fillStyle='#fff';ctx.strokeStyle=ACCENT;ctx.lineWidth=1.5/zoom;
      for(const p of handles){ctx.beginPath();ctx.roundRect(p.x-4/zoom,p.y-4/zoom,8/zoom,8/zoom,2/zoom);ctx.fill();ctx.stroke();}
      for(const p of [points[0],points.at(-1)])if(p){ctx.beginPath();ctx.arc(p.x,p.y,5/zoom,0,Math.PI*2);ctx.fill();ctx.stroke();}
    }
    for (const node of visibleNodes) if (state.selection.has(node.id)) selection(ctx, node, zoom, effects(node) === 'rich', this.ratio);
    if (state.remote?.size) {
      // Recent edits from an external agent: outline plus a name tag, like a co-editor in a shared document.
      ctx.save(); ctx.strokeStyle = REMOTE; ctx.lineWidth = 2.5 / zoom; ctx.setLineDash([]);
      for (const edge of doc.edges) { const points = state.remote.has(edge.id) ? paths.get(edge.id) : undefined; if (points?.length) { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); } }
      ctx.font = `600 ${11 / zoom}px ${boardFont()}`; ctx.textBaseline = 'middle';
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
      drawArrow(ctx, arrow(to, from, 10 / zoom, .85));
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
  if(measure)measure.font=edgeLabelFont();
  const labels=layoutEdgeLabels(doc,new Map(doc.edges.map(e=>[e.id,edgePoints(e,doc,nodeIndex)])),measure?t=>measure.measureText(t).width:undefined);
  for(const {box} of labels.values()){const right=Math.max(all.x+all.w,box.x+box.w),bottom=Math.max(all.y+all.h,box.y+box.h);all.x=Math.min(all.x,box.x);all.y=Math.min(all.y,box.y);all.w=right-all.x;all.h=bottom-all.y;}
  return inflate(all, PAD);
}

export async function renderPNG(doc: FlowDocument, scale = 2): Promise<string> {
  await loadBoardFont(boardFontId(doc)).catch(() => {}); useBoardFont(doc);
  const box = documentBounds(doc);
  const safeScale = Math.max(Number.EPSILON, Math.min(scale, 8192 / Math.max(box.w, box.h), Math.sqrt(32_000_000 / (box.w * box.h))));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.w * safeScale)); canvas.height = Math.max(1, Math.round(box.h * safeScale));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('이미지 내보내기를 시작할 수 없습니다.');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(safeScale, safeScale); ctx.translate(-box.x, -box.y);
  const nodeIndex = new Map(doc.nodes.map(node => [node.id, node])); prepareRoutes(doc, nodeIndex);
  for (const node of doc.nodes) if (node.kind === 'frame') drawNode(ctx, { ...node, locked: false }, undefined, false, true, 'rich', safeScale, true);
  ctx.font=edgeLabelFont();
  const paths=new Map(doc.edges.map(e=>[e.id,edgePoints(e,doc,nodeIndex)]));
  const labels=layoutEdgeLabels(doc,paths,t=>ctx.measureText(t).width);
  for (const edge of doc.edges) drawEdge(ctx, edge, visualEdgePoints(paths.get(edge.id)!,edge,nodeIndex), false, 1, labels.get(edge.id), '#fff');
  for (const node of doc.nodes) {
    if (node.kind === 'frame') continue;
    let bitmap: Bitmap | undefined;
    if (node.kind === 'image' && node.assetId && doc.assets[node.assetId]) {
      bitmap = await decodeImage(doc.assets[node.assetId], Math.min(8192, Math.max(node.w, node.h) * safeScale / Math.max(.01,Math.min(node.crop?.w??1,node.crop?.h??1))));
    }
    drawNode(ctx, { ...node, locked: false }, bitmap, false, true, 'rich', safeScale, true);
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

function svgPoint(p: Point): string { return `${n(p.x)} ${n(p.y)}`; }

function svgCorner(a: Point, b: Point, c: Point, radius: number, cut = radius): string {
  const dx=b.x-a.x, dy=b.y-a.y, ex=c.x-b.x, ey=c.y-b.y;
  const back=cut/Math.hypot(dx,dy), ahead=cut/Math.hypot(ex,ey);
  const entry={x:b.x-dx*back,y:b.y-dy*back}, exit={x:b.x+ex*ahead,y:b.y+ey*ahead};
  return `L${svgPoint(entry)} A${n(radius)} ${n(radius)} 0 0 ${dx*ey-dy*ex > 0 ? 1 : 0} ${svgPoint(exit)}`;
}

export function diamondPath(x: number, y: number, w: number, h: number): string {
  const points=diamondVertices(x,y,w,h), cut=diamondCut(w,h);
  const corners=points.map((p,i)=>svgCorner(points[(i+3)%4],p,points[(i+1)%4],cut*(i%2?h/w:w/h),cut));
  return `M${n(x+w/4)} ${n(y+h/4)} ${corners.join(' ')} Z`;
}

export function roundRectPath(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, w/2, h/2);
  return `M${x+r} ${y} H${x+w-r} A${r} ${r} 0 0 1 ${x+w} ${y+r} V${y+h-r} A${r} ${r} 0 0 1 ${x+w-r} ${y+h} H${x+r} A${r} ${r} 0 0 1 ${x} ${y+h-r} V${y+r} A${r} ${r} 0 0 1 ${x+r} ${y} Z`;
}

export function edgeSvgPath(points: Point[], first: Point, last: Point, round: boolean): string {
  const interior = points.slice(1,-1).map((p,i)=>{
    const a=i===0?first:points[i], c=i===points.length-3?last:points[i+2];
    const radius=round?elbowRadius(a,p,c):0;
    return radius?svgCorner(a,p,c,radius):`L${svgPoint(p)}`;
  });
  return `M${svgPoint(first)} ${interior.join(' ')} L${svgPoint(last)}`;
}

function svgShape(node: FlowNode, attrs: string): string {
  const {x,y,w,h,kind}=node;
  if (kind === 'ellipse') return `<ellipse cx="${n(x+w/2)}" cy="${n(y+h/2)}" rx="${n(w/2)}" ry="${n(h/2)}" ${attrs}/>`;
  if (kind === 'diamond') return `<path d="${diamondPath(x,y,w,h)}" ${attrs}/>`;
  if (kind === 'draw') return `<polyline points="${(node.points ?? []).map(p=>`${n(x+p.x)},${n(y+p.y)}`).join(' ')}" ${attrs}/>`;
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${kind === 'text' ? 0 : n(shapeRadius(node))}" ${attrs}/>`;
}

function svgText(node: FlowNode, measure?: CanvasRenderingContext2D | null): string {
  const box = exportTextBox(node), baseSize = node.kind === 'frame' ? Math.min(18, node.fontSize) : node.fontSize;
  const rich=svgRichContent(node,box,boardFont(),measure,true);if(rich!==null)return rich;
  if (!node.text) return '';
  if (measure) measure.font = `${node.bold ? 600 : 500} ${baseSize}px ${boardFont()}`;
  const textWidth = (text: string) => measure?.measureText(text).width ?? [...text].reduce((sum,char) => sum+baseSize*(char.charCodeAt(0)>255?1:.55),0);
  const lines = lineSegments(node.text, box.w, textWidth);
  const fs = baseSize * plainTextScale(lines,box,baseSize,textWidth);
  const lh = fs * 1.45, align = node.kind === 'frame' ? 'left' : node.align;
  const top = node.kind === 'note' || node.kind === 'text' || node.kind === 'frame';
  const start = box.y + (top ? lh / 2 : Math.max(lh / 2, (box.h - lines.length * lh) / 2 + lh / 2));
  const tx = box.x + (align === 'center' ? box.w / 2 : align === 'right' ? box.w : 0);
  return `<text font-family="${escape(boardFont())}" font-size="${fs}" font-weight="${node.bold ? 600 : 500}" text-anchor="${align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'}" dominant-baseline="central" fill="${svgColor(node.color)}">${lines.map((line, i) => `<tspan x="${n(tx)}" y="${n(start + i * lh)}">${escape(line)}</tspan>`).join('')}</text>`;
}

export function renderSVG(doc: FlowDocument): string {
  useBoardFont(doc);
  const box = documentBounds(doc), parts: string[] = [];
  const frameParts: string[] = [];
  const nodeIndex = new Map(doc.nodes.map(node => [node.id, node])); prepareRoutes(doc, nodeIndex);
  const measure = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if(measure)measure.font=edgeLabelFont();
  const paths=new Map(doc.edges.map(e=>[e.id,edgePoints(e,doc,nodeIndex)]));
  const labels=layoutEdgeLabels(doc,paths,measure?t=>measure.measureText(t).width:undefined);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${n(box.x)} ${n(box.y)} ${n(box.w)} ${n(box.h)}" width="${n(box.w)}" height="${n(box.h)}" role="img"><title>${escape(doc.title)}</title><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" fill="white"/>`);
  const defs = `<defs><filter id="shape-depth" x="-30%" y="-30%" width="160%" height="165%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="5" stdDeviation="7" flood-color="#101828" flood-opacity=".16"/></filter><linearGradient id="shape-light" x2="0" y2="1"><stop stop-color="white" stop-opacity=".07"/><stop offset=".08" stop-color="white" stop-opacity=".025"/><stop offset="1" stop-color="#101828" stop-opacity=".025"/></linearGradient></defs>`;
  for (const edge of doc.edges) {
    const points = visualEdgePoints(paths.get(edge.id)!,edge,nodeIndex);
    if (points.length < 2) continue;
    const {start,end}=edgeArrows(points,edge);
    const path=edgeSvgPath(points,start?.[2]??points[0],end?.[2]??points[points.length-1],edge.style==='elbow');
    const line=`d="${path}" fill="none" stroke-linejoin="round" stroke-linecap="${start||end?'butt':'round'}"`;
    parts.push(`<path ${line} stroke="white" stroke-width="${n(edge.width+4)}"/>`);
    parts.push(`<path ${line} stroke="${svgColor(edge.color)}" stroke-width="${n(edge.width)}"${edge.dashed ? ' stroke-dasharray="7 5"' : ''}/>`);
    for(const arrow of [end,start])if(arrow)parts.push(`<polygon points="${arrow.map(svgPoint).join(' ')}" fill="${svgColor(edge.color)}"/>`);
    const label=labels.get(edge.id);
    if(label){const {center,lines,leader,angle,textWidth,textHeight}=label;
      if(leader.length)parts.push(`<polyline points="${leader.map(p=>`${n(p.x)},${n(p.y)}`).join(' ')}" fill="none" stroke="${svgColor(edge.color)}" stroke-width=".8"/>`);
      parts.push(`<g transform="translate(${n(center.x)} ${n(center.y)}) rotate(${angle})"><rect x="${n(-textWidth/2)}" y="${n(-textHeight/2)}" width="${n(textWidth)}" height="${n(textHeight)}" rx="${n(textHeight/2)}" fill="${svgColor(edge.labelBackground??'#ffffff')}" stroke="${svgColor(edge.color)}" stroke-opacity=".25"/><text text-anchor="middle" dominant-baseline="central" font-family="${escape(boardFont())}" font-size="${EDGE_LABEL_SIZE}" font-weight="500" fill="${svgColor(edge.color)}">${lines.map((line,i)=>`<tspan x="0" y="${n((i-(lines.length-1)/2)*EDGE_LABEL_LINE)}">${escape(line)}</tspan>`).join('')}</text></g>`);
    }
  }
  for (const node of doc.nodes) {
    const start = parts.length;
    const { x, y, w, h } = node;
    const fill = node.kind === 'draw' ? 'none' : svgColor(node.fill);
    const stroke = `stroke="${svgColor(node.stroke)}" stroke-width="${n(node.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"${node.dashed ? ' stroke-dasharray="8 5"' : ''}`;
    parts.push(`<g opacity="${n(node.opacity ?? 1)}">`);
    if (hasDepth(node)) {
      parts.push(svgShape(node,`fill="${fill}" filter="url(#shape-depth)"`));
      parts.push(svgShape(node,`fill="url(#shape-light)" ${stroke}`));
    } else parts.push(svgShape(node,`fill="${fill}" ${stroke}`));
    if (node.kind === 'note') {
      const clipId=escape(`note-${node.id}`);
      parts.push(`<clipPath id="${clipId}">${svgShape(node,'')}</clipPath><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="3" fill="${svgColor(node.stroke)}" clip-path="url(#${clipId})"/>`);
    }
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
  return parts[0] + defs + frameParts.join('') + parts.slice(1).join('');
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
    ctx.lineWidth = .65 / scale; pathNode(ctx, node, scale < .1); ctx.fill(); ctx.stroke();
  }
  for (const edge of doc.edges) {
    const points = edgePoints(edge, doc, nodeIndex); if (!points.length) continue;
    ctx.strokeStyle = edge.color; ctx.lineWidth = 1 / scale;
    traceEdge(ctx, points, points[0], points[points.length-1], false); ctx.stroke();
  }
  for (const node of doc.nodes) {
    if (node.kind === 'frame' || node.kind === 'text') continue;
    ctx.fillStyle = node.fill === 'transparent' ? '#B5C1D1' : node.fill; ctx.strokeStyle = node.stroke === 'transparent' ? '#98A6B9' : node.stroke;
    ctx.lineWidth = .65 / scale; pathNode(ctx, node, scale < .1);
    if (node.kind !== 'draw') ctx.fill(); ctx.stroke();
  }
  const v = doc.viewport;
  ctx.strokeStyle = ACCENT; ctx.fillStyle = 'rgba(247,107,21,.08)'; ctx.lineWidth = 1.5 / scale;
  ctx.fillRect(-v.x / v.zoom, -v.y / v.zoom, viewportWidth / v.zoom, viewportHeight / v.zoom);
  ctx.strokeRect(-v.x / v.zoom, -v.y / v.zoom, viewportWidth / v.zoom, viewportHeight / v.zoom);
}
