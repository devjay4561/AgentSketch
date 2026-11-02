import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-features=AutofillAiWalletPrivatePasses']});
const checks=[],failures=[],errors=[];
try{
 await mkdir('output/workspace',{recursive:true});
 for(const width of [1440,960]){
  const page=await browser.newPage({locale:'ko-KR',viewport:{width,height:width===960?640:980}});page.on('pageerror',e=>errors.push(String(e)));await page.goto(process.env.AGENTSKETCH_TEST_URL||'http://127.0.0.1:18440');await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('자동 복구 저장됨'));await page.getByRole('button',{name:'업무 도구',exact:true}).click();await page.locator('[data-evidence-list] [data-locate]').first().click();
  const panels=await page.locator('.wb-nav [data-panel]').evaluateAll(buttons=>buttons.map(b=>b.dataset.panel));
  for(const name of panels){
   await page.locator(`.wb-nav [data-panel=${name}]`).click();await page.waitForFunction(name=>{const p=document.querySelector(`[data-workspace-panel=${name}]`);return p&&!p.hidden&&p.children.length>0&&!p.textContent.includes('도구를 열지 못했습니다.');},name);
   const state=await page.evaluate(name=>{const panel=document.querySelector(`[data-workspace-panel=${name}]`),main=document.querySelector('.wb-main'),dialog=document.querySelector('dialog.workbench');return {panel:panel.scrollWidth-panel.clientWidth,main:main.scrollWidth-main.clientWidth,document:document.documentElement.scrollWidth-innerWidth,dialog:dialog.getBoundingClientRect().width<=innerWidth,loading:panel.textContent.includes('도구를 여는 중…')};},name);
   const ok=state.panel<=1&&state.main<=1&&state.document<=1&&state.dialog&&!state.loading;if(ok)checks.push(`${width}px ${name}: loaded without horizontal overflow`);else failures.push({width,panel:name,state});
   if(width===1440&&name==='evidence'||width===960&&name==='organization'){await page.locator('.wb-main').evaluate(el=>el.scrollTop=0);await page.screenshot({path:`output/workspace/panels-${width}.png`});}
  }
  await page.close();
 }
}finally{await browser.close();await writeFile('output/workspace/panel-layouts.json',JSON.stringify({checks,failures,errors},null,2));console.log(JSON.stringify({checks,failures,errors},null,2));if(failures.length||errors.length)process.exitCode=1;}
