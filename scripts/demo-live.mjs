// Real-time recording of live authoring by an AI agent.
// A fresh isolated AgentSketch instance draws the document over the real live
// bridge (ai/runtime.mjs live()), and its own compositor frames are captured
// through CDP and encoded at true wall-clock timing: no speed change, no replay.
//
// Camera work uses session.fit with the elements drawn so far, so every frame is
// the app's own viewport computed by the app — no external framing math.
//
// The debug port exists only for this throwaway profile (AGENTSKETCH_BROWSER_ARGUMENTS),
// never for the normal app, per AGENTS.md.
//
// Usage: node scripts/demo-live.mjs
// Output: output/record/live/{frames,concat.txt,timeline.json,*.agentsketch,AgentSketch_실시간.mp4}
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';

const root = path.resolve('.');
const out = path.join(root, 'output/record/live');
const framesDir = path.join(out, 'frames');
const profile = path.join(out, 'profile');
const exe = path.join(root, 'build/bin/AgentSketch.exe');
const FF = 'C:/Users/BINS/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe';
const PORT = 9333;
const W = 1600, H = 1000;

await fs.rm(out, {recursive: true, force: true});
await fs.mkdir(framesDir, {recursive: true});
await fs.mkdir(profile, {recursive: true});
process.env.APPDATA = profile;
const {live} = await import('../ai/runtime.mjs');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const clock = ms => `${(ms / 1000).toFixed(2)}s`;

// Reap only our own --automation instances (never a normal app the user is editing in).
const reap = async () => {
  const ps = `Get-CimInstance Win32_Process -Filter \"Name='AgentSketch.exe'\" | Where-Object { $_.CommandLine -like '*--automation*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
  await new Promise(r => spawn('powershell', ['-NoProfile', '-Command', ps], {stdio: 'ignore'}).on('exit', r)).catch(() => {});
  for (let i = 0; i < 40; i++) {
    const busy = await fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true).catch(() => false);
    if (!busy) return;
    await sleep(250);
  }
};
await reap();

const child = spawn(exe, ['--automation'], {
  cwd: root,
  env: {...process.env, APPDATA: profile, AGENTSKETCH_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT} --remote-debugging-address=127.0.0.1`},
  stdio: 'ignore'
});

let browser, cdp;
const frames = [], marks = [];
const startedAt = Date.now();
const mark = (name, label) => { marks.push({since: Date.now() - startedAt, name, label}); log('·', label ?? name); };

const read = () => live({command: 'document.read'});
const revision = async () => (await read()).revision;
const docNow = async () => (await read()).results[0].result;

async function batch(commands, note) {
  const t0 = Date.now();
  const result = await live({commands, expectedRevision: await revision()});
  log(`  ${clock(Date.now() - t0)} ${commands.length}cmd${note ? ' — ' + note : ''}`);
  return result;
}
const run = (command, args) => batch([{command, args}]);
const soft = async fn => { try { return await fn(); } catch (e) { log('  skipped:', e.message); return null; } };

const idsOf = doc => Array.isArray(doc.nodes) ? doc.nodes.map(n => n.id) : Object.keys(doc.nodes ?? {});
// Real state check: what we asked for is actually in the document now.
async function verify(id, label) {
  if (!idsOf(await docNow()).includes(id)) throw new Error(`missing ${id} (${label})`);
}

// The app's own camera: fit exactly the elements drawn so far.
const drawn = [];
const frame = async (ids = drawn) => soft(async () => live({command: 'session.fit', args: ids.length ? {ids} : {}, expectedRevision: await revision()}));

// ---- content (authored now, drawn live by the app) ----
const ZONES = [
  {id: 'Z1', text: '① 정부 — 입법예고에서 국회 제출까지', x: 40, y: 150, w: 460, h: 560, fill: '#f5f8ff', stroke: '#c3d2ea'},
  {id: 'Z2', text: '② 국회 — 회부에서 의결까지', x: 535, y: 150, w: 410, h: 560, fill: '#fdf7f1', stroke: '#e5cdb4'},
  {id: 'Z3', text: '③ 공포·시행', x: 980, y: 150, w: 390, h: 560, fill: '#f4fbf6', stroke: '#bfe0cb'}
];
const STEPS = [
  ['S01', '입법 기획·입안', 'Z1'], ['S02', '관계 기관 협의', 'Z1'], ['S03', '입법예고 (40일)', 'Z1'],
  ['S04', '규제심사', 'Z1'], ['S05', '법제처 심사', 'Z1'], ['S06', '차관·국무회의', 'Z1'], ['S07', '국회 제출', 'Z1'],
  ['S08', '국회 회부', 'Z2'], ['S09', '위원회 입법예고', 'Z2'], ['S10', '상임위 심사', 'Z2'],
  ['S11', '체계·자구 심사', 'Z2'], ['S12', '본회의 의결', 'Z2'],
  ['S13', '정부 이송', 'Z3'], ['S14', '공포·재의요구 (15일)', 'Z3'], ['S15', '관보 게재·시행', 'Z3']
];
const BRANCHES = [
  ['B1', '당정협의', 60, 760], ['B2', '의원 발의', 420, 760], ['B3', '재의요구 → 재의결', 900, 760]
];
const pos = {};
for (const zone of ZONES) {
  STEPS.filter(s => s[2] === zone.id).forEach((s, i) => {
    pos[s[0]] = {x: zone.x + 16, y: zone.y + 60 + i * 69, w: zone.w - 32, h: 50};
  });
}
const node = (id, kind, x, y, props) => ({command: 'node.add', args: {id, kind, x, y, props}});
const edge = (from, to, props = {}) => ({command: 'edge.add', args: {from, to, props}});
const textNode = (id, x, y, p) => node(id, 'text', x, y, {w: 1200, h: 40, fontSize: 18, color: '#64748b', align: 'left', ...p});
const step = (id, text, zone) => node(id, 'rect', pos[id].x, pos[id].y, {
  text: `${id.slice(1)} · ${text}`, ...pos[id],
  fill: id === 'S15' ? '#fff7ed' : '#ffffff',
  stroke: zone === 'Z1' ? '#8fa6c4' : zone === 'Z2' ? '#c9a87c' : id === 'S15' ? '#d97706' : '#86b894',
  strokeWidth: id === 'S15' ? 2.5 : 1.5, color: '#1e2937', fontSize: 15, align: 'left'
});

try {
  for (let i = 0; i < 160; i++) { try { await live({command: 'session.read'}); break; } catch { await sleep(250); } }
  let cdpReady = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) { cdpReady = true; break; } } catch {}
    await sleep(250);
  }
  if (!cdpReady) throw new Error(`DevTools endpoint did not open on ${PORT}`);

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('wails.localhost')) ?? ctx.pages()[0];
  cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {width: W, height: H, deviceScaleFactor: 1, mobile: false});
  await sleep(1500);

  cdp.on('Page.screencastFrame', async ({data, sessionId}) => {
    const file = `frame-${String(frames.length).padStart(5, '0')}.jpg`;
    frames.push({t: Date.now(), file});
    await fs.writeFile(path.join(framesDir, file), Buffer.from(data, 'base64'));
    await cdp.send('Page.screencastFrameAck', {sessionId}).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1});
  await sleep(600);

  mark('blank', '빈 문서에서 시작');
  await run('document.new', {title: '입법절차 구조도', template: 'blank'});
  await sleep(400);

  mark('title', '제목');
  await batch([
    node('T1', 'text', 40, 40, {text: '법률이 만들어지는 과정', w: 900, h: 60, fontSize: 30, bold: true, color: '#0f172a', align: 'left'}),
    textNode('T2', 40, 100, {text: '정부 제출 → 국회 심사 → 공포·시행 (설명용 예시)'})
  ], '제목');
  drawn.push('T1', 'T2');
  await frame(drawn);
  await sleep(900);

  mark('zones', '구역 3개');
  for (const z of ZONES) {
    await batch([node(z.id, 'frame', z.x, z.y, {text: z.text, w: z.w, h: z.h, fill: z.fill, stroke: z.stroke, strokeWidth: 2, color: '#334155', fontSize: 15, align: 'left'})], z.id);
    drawn.push(z.id);
    await frame(drawn);
    await sleep(600);
  }

  mark('gov', '정부 단계 7개');
  for (const [id, text, zone] of STEPS.filter(s => s[2] === 'Z1')) {
    await batch([step(id, text, zone)], id);
    await verify(id, text);
    drawn.push(id);
    await frame(drawn);
    await sleep(380);
  }
  const gov = STEPS.filter(s => s[2] === 'Z1').map(s => s[0]);
  await batch(gov.slice(0, -1).map((id, i) => edge(id, gov[i + 1])), '정부 흐름');
  await sleep(250);

  mark('assembly', '국회 단계 5개');
  for (const [id, text, zone] of STEPS.filter(s => s[2] === 'Z2')) {
    await batch([step(id, text, zone)], id);
    await verify(id, text);
    drawn.push(id);
    await frame(drawn);
    await sleep(380);
  }
  const asm = STEPS.filter(s => s[2] === 'Z2').map(s => s[0]);
  await batch([edge('S07', 'S08', {label: '제출', color: '#64748b', width: 2}), ...asm.slice(0, -1).map((id, i) => edge(id, asm[i + 1]))], '국회 흐름');
  await sleep(250);

  mark('promulgation', '공포·시행 3개');
  for (const [id, text, zone] of STEPS.filter(s => s[2] === 'Z3')) {
    await batch([step(id, text, zone)], id);
    await verify(id, text);
    drawn.push(id);
    await frame(drawn);
    await sleep(380);
  }
  await batch([edge('S12', 'S13', {label: '이송', color: '#64748b', width: 2}), edge('S13', 'S14'), edge('S14', 'S15')], '공포 흐름');
  await sleep(300);

  mark('branches', '분기·생략 경로');
  await batch(BRANCHES.map(([id, text, x, y]) => node(id, 'note', x, y, {text, w: 320, h: 46, fill: '#fffdf5', stroke: '#d9c8a0', dashed: true, color: '#7c5a1e', fontSize: 14})), '분기 5개');
  await batch([
    edge('S03', 'B1', {dashed: true, color: '#b08968', width: 1.5}), edge('B1', 'S06', {dashed: true, color: '#b08968', width: 1.5}),
    edge('B2', 'S08', {dashed: true, color: '#b08968', width: 1.5}),
    edge('S14', 'B3', {dashed: true, color: '#b08968', width: 1.5}), edge('B3', 'S11', {dashed: true, color: '#b08968', width: 1.5})
  ], '분기 연결');
  drawn.push(...BRANCHES.map(b => b[0]));
  await frame(drawn);
  await sleep(500);

  mark('evidence', '근거 확인');
  await soft(() => run('session.select', {ids: ['S10']}));
  await sleep(600);
  await batch([{command: 'node.update', args: {ids: ['S10'], props: {details: {owner: '법제처', source: '국회법 제85조', notes: '설명용 예시 값입니다.'}}}}], 'S10 근거');
  await frame(['S10', 'S11']);
  await sleep(1400);

  mark('legend', '범례');
  await batch([
    node('L1', 'note', 40, 920, {text: '실선 = 일반 절차 · 점선 = 분기·생략 경로', w: 380, h: 44, fill: '#f8fafc', stroke: '#cbd5e1', color: '#475569', fontSize: 13}),
    node('L2', 'note', 440, 920, {text: '단계 번호와 기한은 설명용 예시이며 법정 기한 검증이 아닙니다', w: 620, h: 44, fill: '#f8fafc', stroke: '#cbd5e1', color: '#475569', fontSize: 13})
  ], '범례');
  drawn.push('L1', 'L2');
  await frame(drawn);
  await sleep(900);

  mark('reveal', '전체 보기');
  await soft(() => run('session.select', {ids: []}));
  await frame(drawn);
  await sleep(3200);

  const saved = await soft(() => run('document.save', {path: path.join(out, '입법절차_구조도.agentsketch')}));
  const doc = await docNow();
  log(`  saved=${!!saved} nodes=${idsOf(doc).length} edges=${Array.isArray(doc.edges) ? doc.edges.length : Object.keys(doc.edges ?? {}).length} title=${JSON.stringify(doc.title)}`);
  mark('end');

  await cdp.send('Page.stopScreencast').catch(() => {});
  await sleep(300);
} finally {
  await browser?.close().catch(() => {});
  child.kill();
  await reap();
}

// ---- encode at real timing: each frame lasts its actual on-screen interval ----
if (frames.length < 10) { console.error('too few frames'); process.exit(1); }
const t0 = frames[0].t, tEnd = frames.at(-1).t;
const lines = frames.map((f, i) => {
  const next = frames[i + 1]?.t ?? tEnd + 800;
  return `file 'frames/${f.file}'\nduration ${Math.max(0.02, (next - f.t) / 1000).toFixed(3)}`;
});
lines.push(`file 'frames/${frames.at(-1).file}'`);
await fs.writeFile(path.join(out, 'concat.txt'), lines.join('\n') + '\n');

const mp4 = path.join(out, 'AgentSketch_실시간.mp4');
const ffBin = await fs.access(FF).then(() => FF).catch(() => 'ffmpeg');
log('encoding', frames.length, 'frames over', ((tEnd - t0) / 1000).toFixed(1), 's');
await new Promise((resolve, reject) => {
  const ff = spawn(ffBin, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(out, 'concat.txt'),
    '-vf', 'fps=30,pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
    '-movflags', '+faststart', mp4], {stdio: 'inherit'});
  ff.on('exit', code => code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code)));
});

await fs.writeFile(path.join(out, 'timeline.json'), JSON.stringify({
  recordedAt: new Date(startedAt).toISOString(),
  realSeconds: (tEnd - t0) / 1000,
  playbackRate: 1,
  frames: frames.length,
  marks: marks.map(m => ({name: m.name, label: m.label ?? null, atSeconds: m.since / 1000}))
}, null, 2));
const st = await fs.stat(mp4);
log(`done: ${mp4} ${(st.size / 1048576).toFixed(1)}MiB`);
