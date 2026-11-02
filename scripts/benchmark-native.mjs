// Run against a local test instance only. It alternates zoom events, restoring
// the original scale, and measures the editor's actual animation callbacks.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve(process.argv[2] || 'output/native-canvas.json');
const pages = await (await fetch('http://127.0.0.1:9227/json')).json();
const page = pages.find(p => p.type === 'page' && p.url === 'http://wails.localhost/');
if (!page) throw new Error('Local AgentSketch test page was not found');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((accept, reject) => { socket.addEventListener('open', accept, {once:true}); socket.addEventListener('error', reject, {once:true}); });
let nextID = 0;
const requests = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const pending = requests.get(message.id);
  if (!pending) return;
  requests.delete(message.id);
  clearTimeout(pending.timer);
  if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
  else pending.accept(message.result);
});
function call(method, params) {
  return new Promise((accept, reject) => {
    const id = ++nextID;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`${method} timed out`)); }, 30_000);
    requests.set(id,{accept,reject,timer});
    socket.send(JSON.stringify({id,method,params}));
  });
}
try {
  await call('Runtime.evaluate', {expression:'window.runtime.WindowShow(); window.runtime.WindowUnminimise();', returnByValue:true});
  await new Promise(accept => setTimeout(accept, 1000));
  const result = await call('Runtime.evaluate', {
    expression: `(${async function () {
      const board = document.querySelector('#board');
      if (!(board instanceof HTMLCanvasElement)) throw new Error('Canvas is not ready');
      if (document.visibilityState !== 'visible') throw new Error('Benchmark requires a visible window');
      const rect = board.getBoundingClientRect();
      const originalRAF = window.requestAnimationFrame.bind(window);
      const samples = [], frames = [];
      const nextFrame = () => new Promise(resolve => originalRAF(resolve));
      window.requestAnimationFrame = callback => originalRAF(timestamp => {
        const started = performance.now();
        try { callback(timestamp); } finally { samples.push(performance.now()-started); }
      });
      try {
        for (let warmup=0; warmup<12; warmup++) {
          board.dispatchEvent(new WheelEvent('wheel', {deltaY:warmup%2===0?40:-40,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2,bubbles:true,cancelable:true}));
          await nextFrame();
        }
        samples.length = 0;
        const started = performance.now();
        let last = await nextFrame();
        for (let step=0; step<120; step++) {
          board.dispatchEvent(new WheelEvent('wheel', {deltaY:step%2===0?40:-40,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2,bubbles:true,cancelable:true}));
          const now = await nextFrame();
          frames.push(now-last); last = now;
        }
        await nextFrame();
        const elapsed = performance.now()-started;
        const stats = values => {
          const sorted = [...values].sort((a,b)=>a-b);
          return {count:sorted.length,mean:values.reduce((a,b)=>a+b,0)/values.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],max:sorted.at(-1)};
        };
        return {title:document.querySelector('#document-title').value,viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},canvas:{width:board.width,height:board.height},steps:120,elapsedMS:elapsed,callbackMS:stats(samples),frameIntervalMS:stats(frames),note:'Actual zoom redraw callbacks; callback times are CPU submission, not GPU completion. Frame intervals include display scheduling.'};
      } finally { window.requestAnimationFrame = originalRAF; }
    }.toString()})()`,
    awaitPromise:true, returnByValue:true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  const record = {measuredAt:new Date().toISOString(), ...result.result.value};
  await writeFile(output, JSON.stringify(record,null,2), 'utf8');
  console.log(JSON.stringify(record,null,2));
} finally { socket.close(); }
