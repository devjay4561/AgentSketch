import type { CropRegion, CustomPort, NodeDetails, WorkspaceData } from './workspace-types.ts';
export type Point = { x: number; y: number };
export type Box = Point & { w: number; h: number };
export type ShapeKind = 'rect' | 'round' | 'ellipse' | 'diamond' | 'text' | 'note' | 'image' | 'frame' | 'draw';
export type Port = 'top' | 'right' | 'bottom' | 'left';
export interface TextRun {text:string;bold?:boolean;color?:string;fontSize?:number;href?:string}
export interface NodeTable {columns:string[];rows:string[][]}
export interface EdgeCondition {nodeId:string;field:string;operator:'equals'|'notEquals';value:string}
export interface FlowNode extends Box {
  id: string; kind: ShapeKind; text: string;
  fill: string; stroke: string; color: string; fontSize: number;
  bold: boolean; align: 'left' | 'center' | 'right';
  strokeWidth: number; dashed: boolean; locked: boolean;
  groupId?: string; assetId?: string; points?: Point[];
  opacity?: number;
  details?: NodeDetails;
  crop?: CropRegion;
  rotation?: number;
  customPorts?: CustomPort[];
  textRuns?: TextRun[];
  contentMode?: 'text'|'checklist'|'table';
  table?: NodeTable;
}
export interface FlowEdge {
  id: string; from: string; to: string; fromPort: Port; toPort: Port;
  label: string; color: string; width: number;
  style: 'elbow' | 'straight' | 'curve'; dashed: boolean;
  arrow: 'end' | 'both' | 'none';
  waypoints?: Point[];
  relation?: 'required'|'alternative'|'optional'|'reference'|'output';
  labelPosition?: number;
  fromAnchor?: Point;
  toAnchor?: Point;
  condition?: EdgeCondition;
  labelBackground?: string;
  labelAngle?: -90|0|90;
}
export interface Asset { id: string; data: string; name: string; width: number; height: number }
export interface FlowDocument {
  format: 'agentsketch'; version: 1; title: string;
  nodes: FlowNode[]; edges: FlowEdge[]; assets: Record<string, Asset>;
  viewport: { x: number; y: number; zoom: number };
  workspace?: WorkspaceData;
}
export type Tool = 'select' | 'hand' | 'connect' | ShapeKind;
export interface RenderState {
  doc: FlowDocument; selection: Set<string>; edgeSelection: string | null;
  grid: boolean; marquee?: Box; connection?: { from: Point; to: Point };
  guides?: { axis: 'x' | 'y'; value: number }[];
  remote?: Set<string>;
}
