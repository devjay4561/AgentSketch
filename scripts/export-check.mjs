import {chromium} from 'playwright';
import {writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {PDFDocument} from 'pdf-lib';
import {emptyDocument,createNode} from '../src/model.ts';
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-features=AutofillAiWalletPrivatePasses']});
const checks=[],errors=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:940}});page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(process.env.AGENTSKETCH_TEST_URL || 'http://127.0.0.1:18440');await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('자동 복구 저장됨'));
 const fixture=emptyDocument();fixture.nodes=[createNode('rect',10,20),createNode('rect',400,20),createNode('image',10,250),createNode('note',400,250)];
 const fixtureDoc=await page.evaluate(async(doc)=>{
  doc.title='호환 내보내기 검증';
  const a=doc.nodes[0];a.text='자료 검토 완료';a.textRuns=[{text:'자료 ',bold:true,color:'#c2410c',fontSize:24},{text:'검토 완료',fontSize:16}];a.details={role:'resource',status:'verified',source:'C:\\자료\\매출.xlsx',checkedBy:'검토자',checkedAt:'2026-10-30T00:00:00Z',notes:'내부용 메모'};
  const b=doc.nodes[1];b.contentMode='table';b.table={columns:['항목','상태'],rows:[['매출','확인 완료'],['판매량','검토 중']]};b.w=300;b.h=170;
  const img=doc.nodes[2];img.assetId='test-image';img.crop={x:.25,y:0,w:.5,h:1};img.rotation=90;img.w=220;img.h=100;
  const c=document.createElement('canvas');c.width=200;c.height=100;const ctx=c.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,100,100);ctx.fillStyle='#00ff00';ctx.fillRect(100,0,100,100);doc.assets['test-image']={id:'test-image',name:'색상.png',data:c.toDataURL(),width:200,height:100};
  const note=doc.nodes[3];note.text='비공개 메모 요소';doc.nodes=[a,b,img,note];doc.edges=[{id:'e',from:a.id,to:b.id,fromPort:'right',toPort:'left',style:'elbow',label:'자료 충족 시',labelAngle:90,labelBackground:'#FFF0E5',color:'#667788',width:2,dashed:false,arrow:'both'}];
  return doc;
 },fixture);
 await page.getByRole('button',{name:'업무 도구',exact:true}).click();await page.locator('[data-panel=interchange]').click();await page.locator('[data-exchange-action=pptx]').waitFor();
 await page.locator('[data-exchange=file]').setInputFiles({name:'export-fixture.agentsketch',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixtureDoc))});await page.locator('[data-exchange-action=import]').click({timeout:3000});
 const discard=page.getByRole('button',{name:'저장하지 않고 계속'});if(await discard.isVisible())await discard.click();
 await page.waitForFunction(()=>document.querySelector('#document-title')?.value==='호환 내보내기 검증');
 for(const [kind,extension] of [['pptx','pptx'],['pdf-vector','pdf'],['html','html'],['csv','csv'],['drawio','drawio']]){
  const download=page.waitForEvent('download');await page.locator(`[data-exchange-action="${kind}"]`).click();await (await download).saveAs(`output/browser-export-check.${extension}`);await page.waitForFunction(()=>document.querySelector('.interchange-panel')?.getAttribute('aria-busy')==='false');checks.push(kind+' UI download');
 }
 await page.locator('[data-exchange=print-mode]').selectOption('tile');await page.locator('[data-exchange=margin]').fill('20');await page.locator('[data-exchange=margin]').dispatchEvent('change');await page.locator('[data-exchange=scale]').fill('200');await page.locator('[data-exchange=scale]').dispatchEvent('change');
 const expectedPages=Number((await page.locator('.exchange-count').textContent()).match(/PDF (\d+)페이지/)[1]);assert.ok(expectedPages>1);
 const tiledDownload=page.waitForEvent('download');await page.locator('[data-exchange-action=pdf-vector]').click();await (await tiledDownload).saveAs('output/browser-export-tiled.pdf');await page.waitForFunction(()=>document.querySelector('.interchange-panel')?.getAttribute('aria-busy')==='false');
 const tiledPDF=await PDFDocument.load(await readFile('output/browser-export-tiled.pdf'));assert.equal(tiledPDF.getPageCount(),expectedPages);checks.push(`PDF margin and tile settings match ${expectedPages}-page preview`);
 const pptx=await JSZip.loadAsync(await readFile('output/browser-export-check.pptx'));const xml=await pptx.file('ppt/slides/slide1.xml').async('text');assert.ok(xml.includes('<a:tbl>'),'editable table');assert.ok(xml.includes('자료 '));assert.ok(xml.includes('val="C2410C"'));assert.ok(xml.includes('<p:pic>'));checks.push('PPTX editable rich text, table and image');
 const media=Object.keys(pptx.files).find(p=>p.startsWith('ppt/media/')&&!pptx.files[p].dir);const mediaBytes=await pptx.file(media).async('base64');
 const pixels=await page.evaluate(async data=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);return {w:img.width,h:img.height,corner:x.getImageData(1,1,1,1).data[3],center:x.getImageData(img.width/2,img.height/2,1,1).data[3]};},mediaBytes);
 assert.ok(pixels.w>pixels.h&&pixels.corner===0&&pixels.center===255);checks.push('crop rotation remains inside fixed image box');
 const html=await readFile('output/browser-export-check.html','utf8');assert.ok(!html.includes('내부용 메모'));assert.ok(!html.includes('비공개 메모 요소'));checks.push('report hides internal notes and note shapes by default');
 await page.screenshot({path:'output/playwright/export-panel.png'});assert.equal(errors.length,0);checks.push('no browser runtime errors');
 await writeFile('output/export-browser-check.json',JSON.stringify({checks,errors,pixels},null,2));console.log(JSON.stringify({checks,errors,pixels},null,2));
}finally{await browser.close();}



