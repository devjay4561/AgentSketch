// Records the real AgentSketch.exe while an external AI agent edits it through MCP.
// Nothing here draws: it launches an isolated app, writes an MCP config for the agent,
// and captures the screen until the agent goes quiet or output/demo/STOP appears.
// Usage: node scripts/demo-record.mjs  →  output/demo/{frames/,timeline.json,mcp.json}
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';

const out = path.resolve('output/demo'), frames = path.join(out, 'frames'), profile = path.join(out, 'profile'), root = path.join(out, 'root');
const IDLE_STOP = Number(process.env.DEMO_IDLE_STOP ?? 90), MAX = Number(process.env.DEMO_MAX ?? 1200);
await fs.rm(out, {recursive: true, force: true});
for (const d of [frames, profile, root]) await fs.mkdir(d, {recursive: true});
process.env.APPDATA = profile;
const {live} = await import('../ai/runtime.mjs');

// The agent's MCP server must find this isolated app instance, so it gets the same APPDATA.
await fs.writeFile(path.join(out, 'mcp-server.mjs'),
  `process.env.APPDATA=${JSON.stringify(profile)};process.argv=[process.argv[0],'cli.mjs','mcp','--root',${JSON.stringify(root)}];await import(${JSON.stringify(new URL('../ai/cli.mjs', import.meta.url).href)});\n`);
await fs.writeFile(path.join(out, 'mcp.json'), JSON.stringify({mcpServers: {agentsketch: {type: 'stdio', command: 'node', args: [path.join(out, 'mcp-server.mjs')], cwd: root, timeout: 120000}}}, null, 2));

const debugArgs = '--remote-debugging-port=9227 --remote-debugging-address=127.0.0.1';
const appLog = await fs.open(path.join(out, 'app.log'), 'a');
const app = spawn(path.resolve('build/bin/AgentSketch.exe'), ['--automation'], {
  env: {...process.env, APPDATA: profile, AGENTSKETCH_BROWSER_ARGUMENTS: debugArgs},
  stdio: ['ignore', appLog.fd, appLog.fd],
});
const log = (...a) => { const line = new Date().toISOString() + ' ' + a.join(' '); console.log(line); fs.appendFile(path.join(out, 'recorder.log'), line + '\n'); };
app.on('exit', (code, signal) => log('app exit', code, signal));
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; ; i++) {
  try { await live({command: 'session.read'}); await fetch('http://127.0.0.1:9227/json'); break; }
  catch (e) { if (i > 120) throw e; await sleep(250); }
}
// Attach to whichever app instance owns the debug port; if the agent relaunches the app, reattach.
let browser, cdp, onFrame;
async function attach() {
  for (let i = 0; ; i++) {
    try { await fetch('http://127.0.0.1:9227/json'); browser = await chromium.connectOverCDP('http://127.0.0.1:9227'); break; }
    catch (e) { if (i > 600) throw e; await sleep(500); }
  }
  let page;
  for (let i = 0; !(page = browser.contexts()[0]?.pages().find(p => p.url().includes('wails.localhost'))); i++) { if (i > 100) throw new Error('no app page'); await sleep(200); }
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
  if (onFrame) { cdp.on('Page.screencastFrame', onFrame); await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 92}); }
  browser.on('disconnected', () => { log('debug connection lost; waiting for app'); if (!stopping) attach().then(() => log('reattached')).catch(e => log('reattach failed', e.message)); });
}
let stopping = false;
await attach();
// Stage setup only: blank board and the wide canvas. The agent decides everything it draws.
const rev = async () => (await live({command: 'document.read'})).revision;
await live({command: 'document.new', args: {title: '새 보드'}, expectedRevision: await rev()});
await live({command: 'session.settings', args: {focus: true}, expectedRevision: await rev()});
await sleep(800);

const shots = [], events = [];
const t0 = Date.now() / 1000;
onFrame = async f => {
  const file = path.join(frames, String(shots.length).padStart(5, '0') + '.jpg');
  shots.push({file: path.relative(out, file), t: f.metadata.timestamp - t0});
  await fs.writeFile(file, Buffer.from(f.data, 'base64'));
  await cdp.send('Page.screencastFrameAck', {sessionId: f.sessionId}).catch(() => {});
};
cdp.on('Page.screencastFrame', onFrame);
await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 92});

// Side-by-side stage on the secondary display: terminal left half, app right half.
const TERM = {x: 1920, y: 0, w: 960, h: 1040}, APPWIN = {x: 2880, y: 0, w: 960, h: 1040};
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
await fs.writeFile(path.join(out, 'window.ps1'), `param([string]$Title,[int]$ProcessId,[int]$X,[int]$Y,[int]$W,[int]$H)
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int ht,bool r); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[W.U]::SetProcessDPIAware() | Out-Null
for ($i = 0; $i -lt 60; $i++) {
  $p = if ($ProcessId) { Get-Process -Id $ProcessId -ErrorAction SilentlyContinue } else { Get-Process | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1 }
  if ($p -and $p.MainWindowHandle -ne 0) { [W.U]::MoveWindow($p.MainWindowHandle,$X,$Y,$W,$H,$true) | Out-Null; [W.U]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; exit 0 }
  Start-Sleep -Milliseconds 250
}
exit 1
`);
const place = (args) => new Promise(r => spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(out, 'window.ps1'), ...args], {stdio: 'ignore'}).on('exit', r));
log('place app window', await place(['-ProcessId', String(app.pid), '-X', APPWIN.x, '-Y', APPWIN.y, '-W', APPWIN.w, '-H', APPWIN.h].map(String)));

const prompt = path.resolve('scripts/demo-prompt.md'), title = 'AgentSketch demo · gjc';
await fs.writeFile(path.join(out, 'agent.ps1'), `$env:APPDATA = '${profile}'
$env:AGENTSKETCH_BROWSER_ARGUMENTS = '${debugArgs}'
Set-Location '${root}'
gjc --tools search_tool_bm25,skill --model opengateway/deepseek/deepseek-v4.1-flash-ultrafast '@${prompt}'
`);
// The terminal is captured from the screen; its start time shares the app recording's clock.
const term = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'gdigrab', '-framerate', '30', '-draw_mouse', '0',
  '-offset_x', String(TERM.x), '-offset_y', String(TERM.y), '-video_size', `${TERM.w}x${TERM.h}`, '-i', 'desktop',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-pix_fmt', 'yuv420p', path.join(out, 'terminal.mp4')], {stdio: ['pipe', 'ignore', 'inherit']});
const termStart = Date.now() / 1000 - t0;
spawn('wt.exe', ['--window', 'new', '--title', title, '--suppressApplicationTitle', 'pwsh', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', path.join(out, 'agent.ps1')], {detached: true, stdio: 'ignore'}).unref();
log('place terminal', await place(['-Title', title, '-X', TERM.x, '-Y', TERM.y, '-W', TERM.w, '-H', TERM.h].map(String)));
await fs.writeFile(path.join(out, 'READY'), 'ok');
log('recording: agent started in terminal');

// Log every document change so captions can describe what the agent actually did.
let last = await rev(), lastChange = Date.now() / 1000;
while (!existsSync(path.join(out, 'STOP'))) {
  await sleep(300);
  const now = Date.now() / 1000;
  try {
    const read = await live({command: 'document.read'});
    if (read.revision !== last) {
      last = read.revision; lastChange = now;
      const doc = read.results?.[0]?.result ?? read.document ?? read;
      events.push({t: now - t0, nodes: doc.nodes?.length, edges: doc.edges?.length, title: doc.title,
        texts: (doc.nodes ?? []).map(n => n.text).filter(Boolean).slice(-3)});
    }
  } catch {}
  if (events.length && now - lastChange > IDLE_STOP) break;
  if (now - t0 > MAX) break;
}
stopping = true;
await cdp.send('Page.stopScreencast').catch(() => {});
const end = Date.now() / 1000 - t0;
term.stdin.write('q');
await new Promise(r => term.on('exit', r));
await fs.writeFile(path.join(out, 'timeline.json'), JSON.stringify({frames: shots, events, end, terminal: {file: 'terminal.mp4', start: termStart}}, null, 2));
await fs.writeFile(path.join(out, 'final.agentsketch.json'), JSON.stringify(await live({command: 'document.read'}), null, 2));
await browser.close().catch(() => {});
app.kill();
for (const p of (await fetch('http://127.0.0.1:9227/json').then(r => r.json()).catch(() => []))) void p; // any agent-launched instance is left to the operator
console.log(JSON.stringify({frames: shots.length, seconds: end.toFixed(1), changes: events.length}));
