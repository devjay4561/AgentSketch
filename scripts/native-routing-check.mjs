import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:18442/json')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
const browser=await chromium.connectOverCDP('http://127.0.0.1:18442');
try{
 const page=browser.contexts()[0].pages()[0];await page.waitForURL('http://wails.localhost/**');await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('자동 복구 저장됨'));
 const data=await page.evaluate(async()=>JSON.parse(await window.go.main.App.LoadAutosave()));
 assert.equal(data.edges[0].waypoints.length,2);assert.equal(data.nodes[0].groupId,data.nodes[1].groupId);
 const out=path.resolve('output/native-routing-roundtrip.agentsketch');
 await page.evaluate(async out=>window.go.main.App.SaveDocument(await window.go.main.App.LoadAutosave(),out,false),out);
 const restored=JSON.parse(await readFile(out,'utf8'));assert.deepEqual(restored.edges[0].waypoints,data.edges[0].waypoints);assert.deepEqual(restored.nodes,data.nodes);
 const r=await page.locator('#board').boundingBox(),p=data.edges[0].waypoints[0];await page.mouse.click(r.x+data.viewport.x+p.x,r.y+data.viewport.y+p.y);
 await page.locator('#edge-inspector').waitFor({state:'visible'});assert.ok((await page.locator('#route-help').textContent()).includes('주황 손잡이'));
 await page.screenshot({path:'output/playwright/native-routing.png'});
 const result={native:true,nodes:data.nodes.length,edges:data.edges.length,waypoints:data.edges[0].waypoints.length,groupPreserved:true,nativeSaveRoundtrip:true,routeControls:true};
 await writeFile('output/native-routing-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
