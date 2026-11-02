import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
await fs.mkdir('output/playwright',{recursive:true});
await fs.writeFile('output/collab-test.html', '<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="/src/style.css"><body style="padding:24px;overflow:auto;background:white"><main id="test"></main></body></html>');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-features=AutofillAiWalletPrivatePasses']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto((process.env.AGENTSKETCH_TEST_URL||'http://127.0.0.1:18440')+'/output/collab-test.html');
 await page.evaluate(async()=>{
  const {mountCollaborationPanel}=await import('/src/collaboration-panel.ts');
  const {emptyDocument}=await import('/src/model.ts');let doc=emptyDocument(),remote='',version=0,polls=0,pushes=0,stops=0,mutations=0;
  window.go={main:{App:{StartLANShare:async text=>{remote=text;version=1;return {url:'http://127.0.0.1:18000',addresses:['http://127.0.0.1:18000'],token:'a'.repeat(64),version,lan:false};},StopShare:async()=>{stops++;},PollShare:async(a,t,v)=>{polls++;return {version,document:v===version?undefined:remote};},PushShare:async(a,t,v,d)=>{if(v!==version)throw new Error('충돌');pushes++;remote=d;return {version:++version};}}}};
  const host={getDocument:()=>doc,getSelection:()=>new Set(),getSelectedEdge:()=>null,mutate:fn=>{mutations++;fn();},select:()=>{},fit:()=>{},invalidate:()=>{},toast:()=>{},replaceDocument:d=>doc=d};
  const mounted=mountCollaborationPanel(host,document.querySelector('#test'));window.test={setTitle:title=>doc.title=title,remoteTitle:title=>{const d=JSON.parse(remote);d.title=title;remote=JSON.stringify(d);version++;},get:()=>({doc,version,polls,pushes,stops,mutations}),dispose:mounted.dispose,replaceReference:()=>{doc={...doc,title:"다른 문서"};mounted.update();}};
 });
 assert.equal((await page.evaluate(()=>window.test.get())).polls,0);
 await page.locator('[data-share=start]').click();await page.waitForFunction(()=>document.querySelector('[data-share=status]').textContent.includes('공유 중'));
 assert.equal(await page.locator('[data-share=address]').inputValue(),'http://127.0.0.1:18000');
 await page.evaluate(()=>window.test.setTitle('내 변경'));await page.locator('[data-share=sync]').click();await page.waitForFunction(()=>document.querySelector('[data-share=status]').textContent.includes('내 변경을 공유'));
 assert.equal((await page.evaluate(()=>window.test.get())).pushes,1);
 await page.evaluate(()=>window.test.remoteTitle('동료 변경'));await page.locator('[data-share=sync]').click();await page.waitForFunction(()=>window.test.get().doc.title==='동료 변경');
 await page.evaluate(()=>{window.test.setTitle('미저장 로컬');window.test.remoteTitle('충돌 원격');});await page.locator('[data-share=sync]').click();await page.locator('[data-share=conflict]').waitFor({state:'visible'});
 assert.equal((await page.evaluate(()=>window.test.get())).doc.title,'미저장 로컬');
 await page.locator('[data-share=apply]').click();assert.equal((await page.evaluate(()=>window.test.get())).doc.title,'충돌 원격');
 await page.locator('[data-share=stop]').click();await page.waitForFunction(()=>document.querySelector('[data-share=status]').textContent.includes('연결을 종료'));
 assert.equal((await page.evaluate(()=>window.test.get())).stops,1);
 await page.locator('[data-share=start]').click();await page.waitForFunction(()=>document.querySelector('[data-share=status]').textContent.includes('공유 중'));
 await page.evaluate(()=>window.test.replaceReference());await page.waitForFunction(()=>window.test.get().stops===2);
 assert.ok((await page.locator('[data-share=status]').textContent()).includes('문서가 변경'));
 await page.screenshot({path:'output/playwright/collaboration-panel.png'});
 await page.evaluate(()=>window.test.dispose());assert.equal((await page.locator('#test').textContent()).trim(),'');assert.equal(errors.length,0);
 const checks=['no background polling by default','explicit sharing exposes connection details','local edits push with version','remote edits apply through undo mutation','conflict preserves local edits until explicit apply','disconnect stops host room','changing document stops sharing before unrelated data can be sent','dispose releases panel','no runtime errors'];
 await fs.writeFile('output/collaboration-ui-check.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
