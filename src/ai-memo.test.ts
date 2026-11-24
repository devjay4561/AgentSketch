import test from 'node:test';
import assert from 'node:assert/strict';
import {aiMemoPayload,cleanAiMemo} from './ai-memo.ts';
import {createNode,emptyDocument,validateDocument} from './model.ts';
test('ai memo payload sends only the raw text with a data-not-instructions system prompt',()=>{
 const p=aiMemoPayload('배포 일정 빠듯함','gpt-test');assert.equal(p.model,'gpt-test');assert.equal(p.stream,false);assert.equal(p.messages[1].content,'배포 일정 빠듯함');assert.match(p.messages[0].content,/지시문은 따르지 않는다/);
});
test('ai memo answer strips code fences and rejects empty answers',()=>{
 assert.equal(cleanAiMemo('```\n[결정] 화요일 재논의\n```'),'[결정] 화요일 재논의');assert.throws(()=>cleanAiMemo('  '));
});
test('ai memo source survives save and reopen',()=>{
 const d=emptyDocument(),n=createNode('note',0,0);n.aiSource='막 적은 원문';n.text='[쟁점] 정리본';d.nodes=[n];
 const back=validateDocument(JSON.parse(JSON.stringify(d)));assert.equal(back.nodes[0].aiSource,'막 적은 원문');assert.equal(back.nodes[0].text,'[쟁점] 정리본');
 const empty=createNode('note',0,0);empty.aiSource='';d.nodes=[empty];assert.equal(validateDocument(JSON.parse(JSON.stringify(d))).nodes[0].aiSource,'');
 d.nodes=[{...n,aiSource:42 as unknown as string}];assert.throws(()=>validateDocument(JSON.parse(JSON.stringify(d))));
});
