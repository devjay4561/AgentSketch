import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {live,execute} from '../ai/runtime.mjs';
process.env.APPDATA=path.resolve(process.env.AGENTSKETCH_TEST_PROFILE??'output/ai-native-profile');
const root=path.resolve('output/ai-live-test');await fs.mkdir(root,{recursive:true});const checks=[];
for(let i=0;i<80;i++){try{await live({command:'session.read'});break;}catch(e){if(i===79)throw e;await new Promise(r=>setTimeout(r,250));}}
const read=()=>live({command:'document.read'});
const mutate=async(command,args={})=>live({command,args,expectedRevision:(await read()).revision});
const original=(await read()).revision;
await assert.rejects(live({command:'document.rename',args:{title:'bad'}}),e=>e.code==='REVISION_REQUIRED');checks.push('revision-required');
await live({commands:[{command:'document.new',args:{title:'AI 실시간 검증'}},{command:'node.add',args:{id:'data',kind:'round',x:0,y:0,props:{text:'자료 수집'}}},{command:'node.add',args:{id:'report',kind:'round',x:400,y:0,props:{text:'월간보고',fill:'#FFF1E8'}}},{command:'edge.add',args:{id:'e1',from:'data',to:'report'}}],expectedRevision:original});
assert.equal((await read()).results[0].result.nodes.length,2);checks.push('live-batch');
await assert.rejects(live({command:'document.rename',args:{title:'stale'},expectedRevision:original}),e=>e.code==='REVISION_CONFLICT');checks.push('live-stale');
await mutate('history.undo');assert.equal((await read()).revision,original);await mutate('history.redo');assert.equal((await read()).results[0].result.nodes.length,2);checks.push('single-undo-redo');
const saved=path.join(root,'report.agentsketch');await live({command:'document.save',args:{path:saved}});assert.equal(JSON.parse(await fs.readFile(saved,'utf8')).nodes.length,2);checks.push('live-save');
await new Promise(r=>setTimeout(r,800));await assert.rejects(execute({target:{file:saved},command:'document.rename',args:{title:'offline'}},{root}),e=>e.code==='DOCUMENT_OPEN');checks.push('live-file-protection');
const tabs=(await live({command:'tabs.list'})).result;await live({command:'tabs.new'});await mutate('document.rename',{title:'통합문서'});
await mutate('node.add',{id:'card',kind:'round',x:0,y:0,props:{text:'월간보고 열기',details:{documentPath:saved}}});
await live({command:'document.open',args:{path:saved}});assert.equal((await live({command:'tabs.list'})).result.tabs.length,tabs.tabs.length+1);checks.push('linked-document-tabs');
await live({command:'session.select',args:{ids:['data','report']}});assert.equal((await live({command:'session.read'})).result.selection.length,2);
await mutate('group.create',{ids:['data','report'],name:'보고 단계'});await mutate('text.fit',{ids:['report']});checks.push('group-and-text-fit');
await live({command:'presentation.start',args:{mode:'nodes'}});assert.equal((await live({command:'presentation.next'})).result.active,true);await live({command:'presentation.stop'});checks.push('presentation');
await live({command:'style.defaults.save',args:{nodeId:'report'}});await mutate('style.defaults.apply',{ids:['data']});await live({command:'style.defaults.reset'});checks.push('style-defaults');
await live({command:'library.save',args:{ids:['data','report'],name:'AI 재사용'}});assert.ok((await live({command:'library.list'})).result.length);checks.push('library');
await live({command:'document.snapshot'});assert.ok((await live({command:'document.versions',args:{path:saved}})).result.length);checks.push('versions');
const output=await execute({target:{live:true},command:'document.export',args:{format:'png'},output:path.join(root,'live.png'),overwrite:true},{root});assert.ok(output.bytes>100);checks.push('live-export');
const browser=await chromium.connectOverCDP('http://127.0.0.1:9227');const page=browser.contexts()[0].pages().find(p=>p.url().includes('wails.localhost'));
try{
 await live({command:'session.panel',args:{name:'close'}});await live({command:'session.fit'});
 assert.ok(await page.locator('[data-action="automation"]').isVisible());
 await page.screenshot({path:path.join(root,'native.png')});checks.push('native-screen');
 const idle=await page.evaluate(async()=>{let count=0;const original=requestAnimationFrame;window.requestAnimationFrame=callback=>original(t=>{count++;callback(t);});await new Promise(r=>setTimeout(r,2200));window.requestAnimationFrame=original;return count;});assert.ok(idle<10,`idle rAF ${idle}`);checks.push('idle-no-render-loop');
 await page.evaluate(()=>window.go.main.App.DisableAutomation());await assert.rejects(live({command:'session.read'}),e=>e.code==='NOT_CONNECTED');assert.ok(await page.locator('[data-action="automation"]').isHidden());checks.push('disconnect');
}finally{await browser.close();}
await fs.writeFile(path.join(root,'results.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
