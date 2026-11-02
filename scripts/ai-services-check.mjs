import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
import {live,execute} from '../ai/runtime.mjs';
process.env.APPDATA=path.resolve('output/ai-native-profile-final');const root=path.resolve('output/ai-live-test'),checks=[];
const browser=await chromium.connectOverCDP('http://127.0.0.1:9227');const page=browser.contexts()[0].pages()[0];await page.evaluate(()=>window.go.main.App.EnableAutomation());
const read=()=>live({command:'document.read'}),mutate=async(command,args)=>live({command,args,expectedRevision:(await read()).revision});
try{
 const source=path.join(root,'source.txt');await fs.writeFile(source,'test source');
 const check=(await live({command:'source.check',args:{source}})).result;assert.equal(check.exists,true);assert.ok(check.fingerprint);checks.push('source-fingerprint');
 await mutate('node.update',{ids:['data'],props:{details:{role:'resource',source,sourceFingerprint:check.fingerprint}}});
 const watch=await live({command:'source.watch',args:{ids:['data'],enabled:true}});assert.ok(watch.result.status);await live({command:'source.watch',args:{ids:['data'],enabled:false}});checks.push('source-watch');
 const share=(await live({command:'share.start'})).result;
 try{const polled=(await live({command:'share.poll',args:{address:share.url,token:share.token,since:0}})).result;assert.ok(polled.document);const pushed=(await live({command:'share.push',args:{address:share.url,token:share.token,version:polled.version}})).result;assert.ok(pushed.version>polled.version);checks.push('local-share-roundtrip');}finally{await live({command:'share.stop'});}
 await execute({target:{live:true},command:'image.import',args:{path:path.join(root,'live.png'),at:{x:0,y:300}},expectedRevision:(await read()).revision},{root});
 const image=(await read()).results[0].result.nodes.find(n=>n.kind==='image');const ocr=(await live({command:'ocr.extract',args:{nodeId:image.id}})).result;assert.equal(typeof ocr,'string');assert.ok(ocr.length);checks.push('windows-ocr');
 let arrived;const received=new Promise(r=>arrived=r);const server=http.createServer((req,res)=>{if(req.url==='/wait'){arrived();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'local fixture response'}}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const args={endpoint:`http://127.0.0.1:${server.address().port}`,key:'',payload:JSON.stringify({model:'fixture',messages:[{role:'user',content:'local fixture only'}]}),requestId:'fixture',consent:true};
 try{assert.equal((await live({command:'assistant.request',args})).result,'local fixture response');checks.push('assistant-local-adapter');const pending=live({command:'assistant.request',args:{...args,endpoint:args.endpoint+'/wait'}}).then(()=>false,()=>true);await received;await live({command:'assistant.cancel',args:{requestId:'fixture'}});assert.equal(await pending,true);checks.push('assistant-cancellation');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 await live({command:'session.panel',args:{name:'close'}});
 await fs.writeFile(path.join(root,'services.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
}finally{await browser.close();}
