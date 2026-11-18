import type { FlowNode } from './types.ts';

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
