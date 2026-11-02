import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({channel:'msedge',headless:true,args:['--disable-features=AutofillAiWalletPrivatePasses']});
const checks=[];
try {
  const page=await browser.newPage({locale:'ko-KR',viewport:{width:1440,height:900}}), errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:18440');
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('자동 복구 저장됨'));
  const key=async k=>{await page.locator('#board').focus();await page.keyboard.press(k);};
  const drag=async(a,b)=>{await page.mouse.move(...a);await page.mouse.down();await page.mouse.move(...b,{steps:10});await page.mouse.up();};
  const read=async()=>{await new Promise(r=>setTimeout(r,800));return page.evaluate(()=>new Promise((resolve,reject)=>{const q=indexedDB.open('agentsketch',1);q.onerror=reject;q.onsuccess=()=>{const db=q.result,r=db.transaction('documents').objectStore('documents').get('recovery');r.onsuccess=()=>{resolve(JSON.parse(r.result));db.close();};};}));};
  const check=(v,m)=>{if(!v)throw new Error(m);checks.push(m);};
  await key('Control+n');
  await page.locator('[data-tool=rect]').click();await drag([220,230],[430,340]);
  await page.mouse.dblclick(320,280);await page.locator('#text-editor').fill('입력 중 Ctrl+S 저장');
  const download=page.waitForEvent('download');await page.locator('#text-editor').press('Control+s');await (await download).saveAs('output/playwright/editor-save.agentsketch');
  let doc=await read();check(doc.nodes[0].text==='입력 중 Ctrl+S 저장','Ctrl+S commits active text editor and saves');
  const width=doc.nodes[0].w;
  await drag([430,340],[500,390]);doc=await read();check(doc.nodes[0].w>width,'corner resize changes dimensions');
  await key('Control+z');doc=await read();check(doc.nodes[0].w===width,'resize undo restores dimensions');
  await page.mouse.click(320,280);await page.locator('[data-tool=connect]').click();await page.mouse.click(320,280);await key('Delete');
  doc=await read();check(doc.nodes.length===0 && errors.length===0,'deleting connection source cancels preview safely');
  for(const [tool,a,b] of [['ellipse',[250,240],[420,350]],['diamond',[600,240],[770,370]],['frame',[200,190],[830,430]]]){
    await page.locator(`[data-tool=${tool}]`).click();await drag(a,b);
  }
  await page.locator('[data-tool=draw]').click();await drag([700,600],[440,500]);
  doc=await read();check(['ellipse','diamond','frame','draw'].every(k=>doc.nodes.some(n=>n.kind===k)),'ellipse decision frame and reverse-direction freehand creation');
  const freehand=doc.nodes.find(n=>n.kind==='draw');check(freehand.w>0&&freehand.points.every(p=>p.x>=0&&p.y>=0),'freehand bounds normalized without losing stroke');
  await page.locator('[data-tool=select]').click();await key('Control+f');
  check(await page.locator('#search-input').evaluate(el=>document.activeElement===el),'Ctrl+F opens layers and focuses search');
  await page.locator('[data-tab=properties]').click();await key('Tab');check(await page.locator('#app').evaluate(el=>el.classList.contains('focus-mode')),'canvas Tab expands workspace');
  await key('Tab');await key('Control+n');await page.getByRole('button',{name:'저장하지 않고 계속'}).click();
  await page.waitForFunction(()=>document.querySelector('#node-count').textContent.startsWith('0개'));
  check(await page.locator('[data-action=undo]').isDisabled(),'new document clears undo across file boundary');
  check(errors.length===0,'regressions have no runtime errors');
  await writeFile('output/editor-regressions.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
