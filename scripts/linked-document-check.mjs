import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {emptyDocument,createNode} from '../src/model.ts';
const dir=path.resolve('output/linked-native');await mkdir(dir,{recursive:true});
const parentPath=path.join(dir,'통합.agentsketch'),childPath=path.join(dir,'월간보고.agentsketch');
if(process.argv.includes('--prepare')){
 const parent=emptyDocument();parent.title='통합 업무';parent.viewport={x:0,y:0,zoom:1};
 const child=emptyDocument();child.title='월간보고';child.nodes=[createNode('rect',100,100)];
 await writeFile(parentPath,JSON.stringify(parent));await writeFile(childPath,JSON.stringify(child));process.exit(0);
}
const browser=await chromium.connectOverCDP('http://127.0.0.1:18442');const checks=[],errors=[];
try{
 const page=browser.contexts()[0].pages()[0];page.on('pageerror',e=>errors.push(String(e)));await page.waitForFunction(()=>document.querySelector('.document-tabs-status')?.textContent==='탭 복구 저장됨');
 const raw=await readFile(childPath,'utf8');
 await page.evaluate(({childPath,raw})=>{window.go.main.App.OpenDocument=async()=>({path:childPath,data:raw});window.linkReads=0;const read=window.go.main.App.ReadLinkedDocument;window.go.main.App.ReadLinkedDocument=async p=>{window.linkReads++;return read(p);};},{childPath,raw});
 await page.getByRole('button',{name:'문서 카드 추가',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#linked-document-path')?.textContent.endsWith('월간보고.agentsketch'));
 await page.locator('#document-title').fill('통합 업무 수정');await page.locator('#document-title').press('Tab');
 const card=JSON.parse(await page.evaluate(()=>window.go.main.App.LoadAutosave()));
 // Wait for debounced recovery then use the actual canvas double-click.
 await page.waitForTimeout(800);const current=JSON.parse(await page.evaluate(()=>window.go.main.App.LoadAutosave()));assert.equal(current.nodes.length,1);assert.equal(current.nodes[0].details.documentPath,childPath);checks.push('card creation persists path without embedding child content');
 const box=await page.locator('#board').boundingBox(),n=current.nodes[0],v=current.viewport;
 await page.mouse.dblclick(box.x+v.x+(n.x+n.w/2)*v.zoom,box.y+v.y+(n.y+n.h/2)*v.zoom);
 await page.waitForFunction(()=>document.querySelector('#document-title').value==='월간보고');assert.equal(await page.locator('.document-tabs').getByRole('tab').count(),2);checks.push('canvas double-click opens child in new tab');
 await page.locator('#document-title').fill('월간보고 수정');await page.locator('#document-title').press('Tab');
 await page.locator('.document-tabs').getByRole('tab',{name:/통합 업무 수정/}).click();await page.waitForFunction(()=>document.querySelector('#document-title').value==='통합 업무 수정');
 await page.mouse.dblclick(box.x+v.x+(n.x+n.w/2)*v.zoom,box.y+v.y+(n.y+n.h/2)*v.zoom);
 await page.waitForFunction(()=>document.querySelector('#document-title').value==='월간보고 수정');assert.equal(await page.evaluate(()=>window.linkReads),1);assert.equal(await page.locator('.document-tabs').getByRole('tab').count(),2);checks.push('existing tab reused without reloading or losing either unsaved document');
 await page.locator('#board').focus();await page.keyboard.press('Control+s');await page.waitForTimeout(700);assert.equal(JSON.parse(await readFile(childPath,'utf8')).title,'월간보고 수정');assert.equal(JSON.parse(await readFile(parentPath,'utf8')).title,'통합 업무');checks.push('child save writes original child file only');
 await page.locator('.document-tabs').getByRole('tab',{name:/통합 업무 수정/}).click();await page.waitForFunction(()=>document.querySelector('#document-title').value==='통합 업무 수정');await page.locator('#board').focus();await page.keyboard.press('Control+s');await page.waitForTimeout(700);assert.equal(JSON.parse(await readFile(parentPath,'utf8')).nodes[0].details.documentPath,childPath);checks.push('parent save and reopen preserves card reference');
 await page.reload();await page.waitForFunction(()=>document.querySelector('.document-tabs-status')?.textContent==='탭 복구 저장됨');assert.equal(await page.locator('.document-tabs').getByRole('tab').count(),2);checks.push('restart restores linked document tabs');
 assert.deepEqual(errors,[]);await writeFile('output/linked-document-check.json',JSON.stringify({checks,errors},null,2));console.log({checks,errors});await page.evaluate(()=>window.runtime.WindowShow());
}finally{await browser.close();}
