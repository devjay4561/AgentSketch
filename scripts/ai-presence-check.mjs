// AI live-edit presence check on the dev server (18440) with a mocked native bridge,
// so it can run while a real AgentSketch instance is open.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const root=path.resolve('output/ai-presence');await fs.mkdir(root,{recursive:true});const checks=[];
const browser=await chromium.launch({channel:'msedge',args:['--disable-features=AutofillAiWalletPrivatePasses']});
try{
 const page=await browser.newPage({locale:'ko-KR',viewport:{width:1440,height:900}});
 await page.addInitScript(()=>{
  const handlers={};window.__replies={};
  const emit=(name,...args)=>(handlers[name]??[]).forEach(fn=>fn(...args));window.__emit=emit;
  const app={AutomationReply:async(id,json)=>{window.__replies[id]=JSON.parse(json);},DisableAutomation:async()=>emit('agentsketch:automation-state',false),LoadAutosave:async()=>'',TakeLaunchDocument:async()=>null,ListRecentDocuments:async()=>[]};
  window.go={main:{App:new Proxy(app,{get:(t,k)=>t[k]??(async()=>null)})}};
  window.runtime=new Proxy({EventsOn:(name,fn)=>{(handlers[name]??=[]).push(fn);}},{get:(t,k)=>t[k]??(()=>{})});
 });
 page.on('pageerror',e=>{throw e;});await page.goto(process.env.AGENTSKETCH_TEST_URL||'http://127.0.0.1:18440');await page.waitForTimeout(800);
 const send=async request=>{const id=String(Math.random());await page.evaluate(([id,p])=>window.__emit('agentsketch:automation',id,p),[id,JSON.stringify(request)]);await page.waitForFunction(id=>window.__replies[id],id);const reply=await page.evaluate(id=>window.__replies[id],id);assert.ok(reply.ok,JSON.stringify(reply.error));return reply.result;};
 const indicator=page.locator('[data-action="automation"]'),follow=page.locator('[data-action="ai-follow"]');
 assert.ok(await indicator.isHidden());await page.evaluate(()=>window.__emit('agentsketch:automation-state',true));
 assert.ok(await indicator.isVisible()&&await follow.isVisible());checks.push('indicator-on-connect');
 const blue=()=>page.evaluate(()=>{const c=document.getElementById('board'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]===0x2F&&d[i+1]===0x6F&&d[i+2]===0xED)n++;return n;});
 const before=await send({command:'document.read'});
 const out=await send({commands:[{command:'node.add',args:{id:'ai-far',kind:'round',x:6000,y:5000,props:{text:'AI가 추가'}}}],expectedRevision:before.revision});
 const after=await send({command:'document.read'});
 assert.equal(out.revision,after.revision,'returned revision must match the panned document');checks.push('revision-after-follow');
 const v=after.results[0].result.viewport,size=await page.evaluate(()=>({w:document.getElementById('board').clientWidth,h:document.getElementById('board').clientHeight}));
 const sx=6000*v.zoom+v.x,sy=5000*v.zoom+v.y;assert.ok(sx>=0&&sy>=0&&sx<size.w&&sy<size.h,'view follows the change');checks.push('follow-pan');
 await page.waitForTimeout(150);assert.ok(await blue()>20,'AI highlight drawn');assert.match(await indicator.textContent(),/AI 편집 중/);
 await page.screenshot({path:path.join(root,'highlight.png')});checks.push('highlight-and-working');
 await page.waitForTimeout(2800);assert.equal(await blue(),0,'highlight clears');assert.match(await indicator.textContent(),/외부 제어 중/);checks.push('highlight-clears');
 await follow.click();assert.equal(await follow.getAttribute('aria-pressed'),'false');
 const r=await send({command:'document.read'});const view=r.results[0].result.viewport;
 await send({commands:[{command:'node.add',args:{id:'ai-far2',kind:'round',x:-9000,y:-9000,props:{text:'따라가지 않음'}}}],expectedRevision:r.revision});
 assert.deepEqual((await send({command:'document.read'})).results[0].result.viewport,view);checks.push('follow-off');
 await follow.click();await indicator.click();assert.ok(await indicator.isHidden()&&await follow.isHidden());checks.push('disconnect-hides');
}finally{await browser.close();}
console.log(JSON.stringify({passed:checks.length,checks}));
