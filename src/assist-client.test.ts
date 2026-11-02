import test from 'node:test';
import assert from 'node:assert/strict';
import {assistPayload,validateAssistEndpoint,parseAssistantDraft,requestAssistant} from './assist-client.ts';
import {createNode,emptyDocument} from './model.ts';
test('assistant payload excludes images and evidence paths and limits selected scope',()=>{
 const d=emptyDocument(),a=createNode('rect',0,0),b=createNode('rect',100,0);a.details={source:'C:/secret/file',owner:'owner',notes:'private-note'};a.assetId='image';d.assets.image={id:'image',data:'private-image-data',width:1,height:1,name:'private.png'};d.nodes=[a,b];const text=JSON.stringify(assistPayload(d,new Set([a.id]),'검토','model','review'));assert.ok(!text.includes('private'));assert.ok(!text.includes('secret'));assert.ok(!text.includes('owner'));assert.ok(!text.includes(b.id));
});
test('assistant endpoints require HTTPS except loopback and reject credentials',()=>{
 assert.equal(validateAssistEndpoint('http://localhost:1234/v1/chat/completions'),'http://localhost:1234/v1/chat/completions');assert.throws(()=>validateAssistEndpoint('http://example.com/api'));assert.throws(()=>validateAssistEndpoint('https://key@example.com/api'));assert.throws(()=>validateAssistEndpoint('javascript:alert(1)'));
});
test('assistant draft maps model identifiers and rejects dangling references',()=>{
 const d=parseAssistantDraft('```json\n{"title":"초안","nodes":[{"id":"a","text":"자료"},{"id":"b","text":"보고"}],"edges":[{"from":"a","to":"b"}]}\n```');assert.equal(d.nodes.length,2);assert.equal(d.edges[0].from,d.nodes[0].id);assert.throws(()=>parseAssistantDraft('{"nodes":[{"id":"a","text":"A"}],"edges":[{"from":"a","to":"bad"}]}'));
});
test('assistant request does not forward cookies or follow redirects and returns text',async()=>{
 const original=globalThis.fetch;let request:RequestInit|undefined;
 try{globalThis.fetch=async(_url,init)=>{request=init;return new Response(JSON.stringify({choices:[{message:{content:'검토 결과'}}]}),{status:200});};assert.equal(await requestAssistant('https://example.com/v1/chat/completions','temporary-key',JSON.stringify({model:'m',messages:[]}),new AbortController().signal),'검토 결과');assert.equal(request?.credentials,'omit');assert.equal(request?.redirect,'error');assert.equal((request?.headers as Record<string,string>).Authorization,'Bearer temporary-key');}finally{globalThis.fetch=original;}
});
