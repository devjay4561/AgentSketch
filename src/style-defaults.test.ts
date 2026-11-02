import test from 'node:test';
import assert from 'node:assert/strict';
import {createNode} from './model.ts';
import type { FlowEdge } from './types.ts';
import {STYLE_DEFAULTS_KEY,readStyleDefaults,saveNodeDefaults,saveEdgeDefaults,applyNodeDefaults,applyEdgeDefaults,resetStyleDefaults,type StyleStorage} from './style-defaults.ts';
function memory():StyleStorage{const values=new Map<string,string>();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);},removeItem:key=>{values.delete(key);}};}
const edge=():FlowEdge=>({id:'e',from:'a',to:'b',fromPort:'right',toPort:'left',color:'#123456',width:3,style:'elbow',dashed:true,arrow:'both',label:'private label',labelBackground:'#ffffff',labelAngle:90});
test('default styles persist independently and only apply appearance',()=>{
 const store=memory(),source=createNode('rect',0,0),target=createNode('note',90,80);source.fill='#ff9900';source.text='private text';source.details={source:'C:\\private.xlsx',status:'verified'};
 assert.ok(saveNodeDefaults(source,store));assert.ok(saveEdgeDefaults(edge(),store));const persisted=store.getItem(STYLE_DEFAULTS_KEY)!;assert.ok(!persisted.includes('private'));assert.ok(!persisted.includes('verified'));
 assert.ok(applyNodeDefaults(target,store));assert.equal(target.fill,source.fill);assert.equal(target.x,90);assert.equal(target.kind,'note');assert.notEqual(target.text,source.text);assert.equal(target.details,undefined);
 const other={...edge(),id:'other',label:'preserve',from:'x'};other.width=1;assert.ok(applyEdgeDefaults(other,store));assert.equal(other.width,3);assert.equal(other.id,'other');assert.equal(other.label,'preserve');assert.equal(other.from,'x');assert.equal(other.labelAngle,90);
 assert.ok(resetStyleDefaults(store));assert.equal(applyNodeDefaults(target,store),false);
});
test('oversized and malicious stored styles are bounded and sanitized',()=>{
 const store=memory();store.setItem(STYLE_DEFAULTS_KEY,'x'.repeat(4097));assert.deepEqual(readStyleDefaults(store),{version:1});
 store.setItem(STYLE_DEFAULTS_KEY,'{"version":1,"node":{"__proto__":{"polluted":true},"fill":"url(javascript:x)","fontSize":9000,"text":"secret","bold":true},"edge":{"from":"secret","width":-1,"labelAngle":45}}');
 const value=readStyleDefaults(store);assert.deepEqual(value.node,{bold:true});assert.equal(value.edge,undefined);assert.equal(({} as Record<string,unknown>).polluted,undefined);
});
test('blocked browser storage never prevents editing',()=>{
 const broken:StyleStorage={getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('quota');},removeItem:()=>{throw new Error('blocked');}};
 const node=createNode('rect',0,0);assert.equal(saveNodeDefaults(node,broken),false);assert.equal(applyNodeDefaults(node,broken),false);assert.equal(resetStyleDefaults(broken),false);
});
