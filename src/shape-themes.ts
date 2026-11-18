import type { FlowDocument, FlowNode } from './types.ts';

type ShapeColors = Readonly<Pick<FlowNode, 'fill' | 'stroke' | 'color'>>;

export const SHAPE_THEMES = [
  { name: 'Slate', soft: {fill:'#F0F3F8', stroke:'#A9B7CA', color:'#344256'}, solid: {fill:'#36465D', stroke:'#27354A', color:'#FFFFFF'} },
  { name: 'Blue', soft: {fill:'#EAF2FF', stroke:'#9BB9E7', color:'#1E4783'}, solid: {fill:'#2358B8', stroke:'#1B4697', color:'#FFFFFF'} },
  { name: 'Teal', soft: {fill:'#E8F6F3', stroke:'#8BBFB5', color:'#18564F'}, solid: {fill:'#17665D', stroke:'#11564F', color:'#FFFFFF'} },
  { name: 'Amber', soft: {fill:'#FFF3E6', stroke:'#E4AB78', color:'#783C16'}, solid: {fill:'#F8A958', stroke:'#C5732C', color:'#1C2024'} },
  { name: 'Violet', soft: {fill:'#F3EDFD', stroke:'#BDA9E5', color:'#563B82'}, solid: {fill:'#6143A0', stroke:'#503586', color:'#FFFFFF'} },
  { name: 'Rose', soft: {fill:'#FCEEF1', stroke:'#DDA5B6', color:'#813751'}, solid: {fill:'#983B59', stroke:'#803049', color:'#FFFFFF'} },
] as const satisfies readonly { name: string; soft: ShapeColors; solid: ShapeColors }[];

export type ShapeTheme = typeof SHAPE_THEMES[number];
export const SHAPE_TONES = ['soft', 'solid'] as const;
export type ShapeTone = typeof SHAPE_TONES[number];

export function isPresetShape(node: FlowNode): boolean {
  return node.kind !== 'text' && node.kind !== 'draw' && node.kind !== 'image';
}

export function boardShapeColors(node: FlowNode, theme: ShapeTheme, fallback: ShapeTone): ShapeColors {
  const fill = node.fill.toUpperCase();
  const tone = SHAPE_TONES.find(tone => SHAPE_THEMES.some(item => item[tone].fill === fill));
  return theme[tone ?? fallback];
}

function rgb(hex: string): [number, number, number] | undefined {
  const m = /^#([\da-f]{6})/i.exec(hex);
  if (!m) return;
  const v = parseInt(m[1], 16);
  return [(v >> 16) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}
function hueSat(hex: string): { hue: number; sat: number; light: number; chroma: number } | undefined {
  const c = rgb(hex); if (!c) return;
  const max = Math.max(...c), min = Math.min(...c), d = max - min, light = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * light - 1));
  let hue = 0;
  if (d) hue = max === c[0] ? ((c[1] - c[2]) / d + 6) % 6 : max === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
  return { hue: hue * 60, sat, light, chroma: d };
}
/** The preset family closest to a node's own colour; low-saturation colours become Slate. */
export function nearestTheme(node: Pick<FlowNode, 'fill' | 'stroke'>): ShapeTheme {
  const fill = node.fill.toUpperCase(), stroke = node.stroke.toUpperCase();
  const preset = SHAPE_THEMES.find(theme => SHAPE_TONES.some(tone => theme[tone].fill === fill && theme[tone].stroke === stroke));
  if (preset) return preset;
  // Chroma, not HSL saturation: pale tinted fills are near-neutral and must not pick a hue.
  const candidates = [node.stroke, node.fill].map(hueSat).filter((c): c is NonNullable<typeof c> => !!c && c.chroma > .16);
  const source = candidates[0];
  if (!source) return SHAPE_THEMES[0];
  // Hue bands rather than nearest swatch, so red-orange accents stay apart from orange.
  const h = source.hue, name = h < 20 || h >= 330 ? 'Rose' : h < 60 ? 'Amber' : h < 195 ? 'Teal' : h < 255 ? 'Blue' : 'Violet';
  return SHAPE_THEMES.find(theme => theme.name === name)!;
}
const TIDY_KINDS = new Set<FlowNode['kind']>(['rect', 'round', 'ellipse', 'diamond']);
/**
 * One-step restyle for older boards: preset colours by nearest family (dark fills stay
 * solid), 1px outlines, card text for multi-line boxes and calmer connector widths.
 * Dashed outlines, text, notes, frames and images keep their meaning and look.
 */
export function tidyBoard(doc: FlowDocument, editable: Set<string>): number {
  let changed = 0;
  for (const node of doc.nodes) {
    if (!TIDY_KINDS.has(node.kind) || !editable.has(node.id) || node.fill === 'transparent') continue;
    const fill = hueSat(node.fill), tone: ShapeTone = fill && fill.light < .55 ? 'solid' : 'soft';
    const colors = nearestTheme(node)[tone];
    const next = { ...colors, strokeWidth: 1, ...(node.text.includes('\n') && !node.textRuns?.length && (!node.contentMode || node.contentMode === 'text') ? { textStyle: 'card' as const } : {}) };
    if (Object.entries(next).some(([key, value]) => node[key as keyof FlowNode] !== value)) { Object.assign(node, next); changed++; }
  }
  for (const edge of doc.edges) if (edge.width > 1.5 && editable.has(edge.from) && editable.has(edge.to)) { edge.width = 1.5; changed++; }
  return changed;
}
