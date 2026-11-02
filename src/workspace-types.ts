import type { FlowDocument, FlowNode, Point } from './types.ts';
export interface NodeDetails {
  documentPath?:string;
  role?: 'step'|'resource'; owner?:string; status?:'missing'|'collected'|'reviewing'|'verified'|'stale';
  source?:string; sourceSystem?:string; version?:string; verifiedVersion?:string; checkedBy?:string; checkedAt?:string; dueAt?:string;
  sourceFingerprint?:string; verifiedSourceFingerprint?:string;
  reviewIntervalDays?:number;
  attachmentIds?:string[];
  customFields?:Record<string,string>;
  notes?:string; requirement?:'all'|'any'; pageId?:string; layerId?:string;
  checklist?:{id:string;text:string;done:boolean}[];
}
export interface WorkspaceGroup {id:string;name:string;description?:string;parentId?:string;collapsed?:boolean}
export interface WorkspaceLayer {id:string;name:string;hidden?:boolean;locked?:boolean}
export interface WorkspacePage {id:string;name:string}
export interface WorkspaceComment {id:string;nodeId?:string;author:string;text:string;createdAt:string;resolved?:boolean}
export interface WorkspaceBookmark {id:string;name:string;nodeId?:string;viewport:{x:number;y:number;zoom:number}}
export interface WorkspaceAttachment {id:string;name:string;mime:string;size:number;data:string}
export interface WorkspaceData {pages?:WorkspacePage[];activePageId?:string;layers?:WorkspaceLayer[];groups?:WorkspaceGroup[];comments?:WorkspaceComment[];bookmarks?:WorkspaceBookmark[];attachments?:WorkspaceAttachment[]}
export interface WorkbenchHost {
 getDocument():FlowDocument; getSelection():Set<string>; getSelectedEdge():string|null;
 mutate(action:()=>void,message?:string):void; select(ids:Iterable<string>,edge?:string|null):void;
 fit(nodes?:FlowNode[]):void; invalidate():void; toast(message:string,error?:boolean):void;
 replaceDocument(doc:FlowDocument,path?:string):Promise<boolean>|void; getFilePath?():string;getDirty?():boolean;
}
export type CropRegion = {x:number;y:number;w:number;h:number};
export type CustomPort = {id:string;point:Point};
