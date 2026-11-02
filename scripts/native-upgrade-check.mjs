import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const dir=path.resolve('output/native-upgrade-data'),checks=[];let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:18442/json')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 browser=await chromium.connectOverCDP('http://127.0.0.1:18442');const page=browser.contexts()[0].pages()[0];const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('자동 복구 저장됨'));
 assert.equal(await page.locator('#document-title').inputValue(),'네이티브 통합 검사');checks.push('command-line document loaded into actual native editor');
 const raw=await page.evaluate(()=>window.go.main.App.LoadAutosave());const doc=JSON.parse(raw);assert.equal(doc.nodes[0].details.owner,'운영팀');assert.equal(doc.edges[0].waypoints.length,1);assert.equal(doc.edges[0].condition.value,'정기');assert.equal(doc.workspace.groups[0].description,'보존 검사');assert.equal(Buffer.from(doc.workspace.attachments[0].data,'base64').toString('utf8'),'검증용 첨부');checks.push('extended document fields, conditions, groups and attachment restored');
 const source=await page.evaluate(source=>window.go.main.App.CheckSource(source),path.join(dir,'source.txt'));assert.equal(source.exists,true);checks.push('native file source exists and fingerprint read');
 const saved=await page.evaluate(async out=>window.go.main.App.SaveDocument(await window.go.main.App.LoadAutosave(),out,false),path.join(dir,'roundtrip.agentsketch'));assert.deepEqual(JSON.parse(await readFile(saved,'utf8')),doc);checks.push('native extended document save roundtrip');
 await page.evaluate(async raw=>window.go.main.App.SaveSnapshot(raw),raw);const recent=await page.evaluate(()=>window.go.main.App.ListRecentDocuments());assert.ok(recent.length>0);checks.push('native recent document and version APIs');
 const image=await readFile('output/ocr-korean.png');const ocr=await page.evaluate(data=>window.go.main.App.ExtractImageText(data),'data:image/png;base64,'+image.toString('base64'));assert.match(ocr,/월간보고/);checks.push('native Windows OCR recognizes Korean');
 await page.getByRole('button',{name:'업무 도구',exact:true}).click();
 for(const name of ['자료와 준비 상태','자동 배치','페이지와 그룹','편집 도구','문서 보관함','첨부와 경로','보고와 호환','검토와 발표','이미지 글자 읽기','공동 작업']){await page.locator('.wb-nav').getByRole('button',{name,exact:true}).click();await page.waitForTimeout(180);assert.ok(!await page.locator('.wb-panels').innerText().then(s=>s.includes('도구를 열지 못했습니다')));}
 checks.push('all ten native workspace panels load');await page.locator('.wb-nav').getByRole('button',{name:'자료와 준비 상태',exact:true}).click();await page.screenshot({path:'output/playwright/native-upgrade.png'});
 await page.getByRole('button',{name:'업무 도구 닫기'}).click();await page.locator('#board').focus();await page.keyboard.press('Control+s');await page.waitForTimeout(700);
 execFileSync(path.resolve('build/bin/AgentSketch.exe'),[path.join(dir,'second.agentsketch')],{env:{...process.env,APPDATA:dir},windowsHide:true,timeout:15000});
 await page.waitForFunction(()=>document.querySelector('#document-title').value==='두 번째 실행으로 연 문서');checks.push('second process file association opens document in existing instance');
 assert.deepEqual(errors,[]);checks.push('no native runtime errors');await writeFile('output/native-upgrade-check.json',JSON.stringify({checks,errors,source},null,2));console.log(JSON.stringify({checks,errors},null,2));
 await page.evaluate(()=>window.runtime.WindowShow());
}finally{if(browser)await browser.close();}
