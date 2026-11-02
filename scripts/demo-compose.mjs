// Composes output/demo (from demo-record.mjs) into a split-screen video:
// the agent's terminal on the left, the AgentSketch app on the right, one shared clock.
// The thinking phase before the first edit is condensed to THINK seconds, drawing runs at DRAW×.
// The on-screen clock always shows real elapsed session time and the current speed.
// Usage: FFMPEG=<path> node scripts/demo-compose.mjs
//   →  output/demo/demo.mp4 (with intro/end cards), output/demo/session.mp4, output/demo/demo.gif
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const FPS = 30, W = 1920, H = 1080, INTRO = 2.4, OUTRO = 3.4, TAIL = 8, THINK = 10, DRAW = 2;
// The terminal capture starts before its window is placed; skip what was on the screen behind it.
const SCREEN_CUT = Number(process.env.DEMO_SCREEN_CUT ?? 1.5);
const dir = path.resolve('output/demo'), work = path.join(dir, 'compose');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const ff = (...args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {stdio: 'inherit'});
const tl = JSON.parse(await fs.readFile(path.join(dir, 'timeline.json'), 'utf8'));
const start = tl.terminal.start + SCREEN_CUT, end = Math.min(tl.end, (tl.events.at(-1)?.t ?? tl.end) + TAIL), session = end - start;
const think = Math.max(0, tl.events[0].t - 2 - start), thinkSpeed = Math.max(1, think / THINK), out = THINK + (session - think) / DRAW;
await fs.rm(work, {recursive: true, force: true});
await fs.mkdir(work, {recursive: true});

// Layout: header, then terminal and app scaled to the same height.
const top = 72, panelH = H - top - 16;
// Inner terminal window only: the outer pixels of the capture show whatever is behind the window.
const TERM_CROP = {x: 9, y: 0, w: 948, h: 1031};
const term = {w: Math.round(TERM_CROP.w * panelH / TERM_CROP.h), h: panelH}, appSrc = await (async () => {
  // The window is placed after launch, so size the panel from the last frame.
  const probe = await fs.readFile(path.join(dir, tl.frames.at(-1).file));
  for (let i = 2; i < probe.length;) { const m = probe[i + 1]; if (m === 0xC0 || m === 0xC2) return {w: probe.readUInt16BE(i + 7), h: probe.readUInt16BE(i + 5)}; i += 2 + probe.readUInt16BE(i + 2); }
})();
const app = {w: Math.round(appSrc.w * panelH / appSrc.h), h: panelH};
const gap = 24, left = Math.round((W - term.w - app.w - gap) / 2);
term.x = left; term.y = top; app.x = left + term.w + gap; app.y = top;

const fonts = pathToFileURL(path.resolve('public/fonts')).href;
const logo = await fs.readFile(path.resolve('site/assets/favicon.svg'), 'utf8');
const css = `@font-face{font-family:K;src:url(${fonts}/AgentSketchExport-Regular.ttf);font-weight:400}
@font-face{font-family:K;src:url(${fonts}/AgentSketchExport-Semibold.ttf);font-weight:700}
*{box-sizing:border-box;margin:0}html,body{width:${W}px;height:${H}px;overflow:hidden;font-family:K}`;
const browser = await chromium.launch({channel: 'msedge', headless: true, args: ['--disable-features=AutofillAiWalletPrivatePasses', '--allow-file-access-from-files']});
const page = await browser.newPage({viewport: {width: W, height: H}, deviceScaleFactor: 1});
const shot = async (html, file) => { await page.setContent(html, {waitUntil: 'load'}); await page.evaluate(() => document.fonts.ready); await page.screenshot({path: file}); };

// Static chrome behind the two recordings; the clock is drawn per frame by ffmpeg.
await shot(`<!doctype html><meta charset="utf-8"><style>${css}
body{background:radial-gradient(140% 120% at 50% 0%,#1d1611 0%,#0e0f12 60%)}
header{position:absolute;left:${left}px;right:${left}px;top:0;height:${top}px;display:flex;align-items:center;gap:16px;color:#fff}
header svg{width:34px;height:34px}.name{font-size:24px;font-weight:700;letter-spacing:-.4px}
.flow{margin-left:22px;font-size:17px;color:#c9ccd4;display:flex;gap:10px;align-items:center}
.chip{padding:5px 12px;border-radius:999px;background:#23262d;color:#fff;font-weight:700}
.chip.o{background:#f76b15}.arrow{color:#f76b15;font-weight:700}
.real{margin-left:auto;font-size:16px;color:#c9ccd4;display:flex;align-items:center;gap:10px;padding-right:118px;position:relative}
.dot{width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 4px rgba(239,68,68,.2)}
.panel{position:absolute;border-radius:12px;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 20px 50px rgba(0,0,0,.45);background:#000}
</style><header>${logo}<span class="name">AgentSketch</span>
<span class="flow"><span class="chip">gjc · DeepSeek V4.1 Flash Ultrafast</span><span class="arrow">MCP →</span><span class="chip o">AgentSketch 앱</span></span>
<span class="real"><i class="dot"></i>실제 경과 시간</span></header>
<div class="panel" style="left:${term.x}px;top:${term.y}px;width:${term.w}px;height:${term.h}px"></div>
<div class="panel" style="left:${app.x}px;top:${app.y}px;width:${app.w}px;height:${app.h}px"></div>`, path.join(work, 'bg.png'));

// Intro and end cards as short frame sequences.
const card = (body, bg, color) => `<!doctype html><meta charset="utf-8"><style>${css}
body{background:${bg};color:${color};display:flex;flex-direction:column;align-items:center;justify-content:center}
.logo{width:120px;height:120px;filter:drop-shadow(0 18px 40px rgba(247,107,21,.45))}.logo svg{width:100%;height:100%}
.name{font-size:96px;font-weight:700;letter-spacing:-2px;margin-top:28px}
.tag{font-size:34px;margin-top:16px;opacity:.88}.meta{font-size:26px;margin-top:28px;color:#5b6070}.url{font-size:28px;margin-top:18px;font-weight:700;color:#f76b15}
.beta{display:inline-block;font-size:20px;font-weight:700;color:#f76b15;border:2px solid #f76b15;border-radius:999px;padding:4px 14px;margin-left:16px;vertical-align:middle;letter-spacing:1px}
</style>${body}<script>
const clamp=v=>Math.min(1,Math.max(0,v)),ease=t=>1-Math.pow(1-clamp(t),3),back=t=>{t=clamp(t);return 1+2.7*Math.pow(t-1,3)+1.7*Math.pow(t-1,2)};
window.at=t=>{document.querySelector('.logo').style.transform='scale('+(.45+.55*back(t/.55))+') rotate('+((1-ease(t/.6))*-10)+'deg)';
[...document.body.children].filter(e=>!e.matches('.logo,script')).forEach((e,i)=>{const k=ease((t-.25-i*.15)/.45);e.style.opacity=k;e.style.transform='translateY('+(28*(1-k))+'px)';});};</script>`;
const renderCard = async (html, seconds, name) => {
  await page.setContent(html, {waitUntil: 'load'}); await page.evaluate(() => document.fonts.ready);
  const d = path.join(work, name); await fs.mkdir(d);
  for (let i = 0; i < Math.round(seconds * FPS); i++) { await page.evaluate(t => window.at(t), i / FPS); await page.screenshot({path: path.join(d, String(i).padStart(4, '0') + '.png')}); }
  ff('-framerate', String(FPS), '-i', path.join(d, '%04d.png'), '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', path.join(work, name + '.mp4'));
};
await renderCard(card(`<div class="logo">${logo}</div><div class="name">AgentSketch<span class="beta">BETA</span></div><div class="tag">AI 에이전트가 직접 그리는 흐름도</div><div class="meta" style="color:#9aa0ad">대본 없는 실제 에이전트 세션 · 배속 구간은 화면에 표시</div>`,
  'radial-gradient(120% 90% at 50% 40%,#2a1608 0%,#14100d 55%,#0b0b0d 100%)', '#fff'), INTRO, 'intro');
await renderCard(card(`<div class="logo">${logo}</div><div class="name">AgentSketch</div><div class="tag">자료와 절차의 관계를 한 장에</div><div class="meta">Windows · 오프라인 · CLI &amp; MCP · MIT 오픈소스</div><div class="url">github.com/devjay4561/AgentSketch</div>`,
  'radial-gradient(120% 90% at 50% 45%,#fff 0%,#fff6ef 60%,#ffe9da 100%)', '#16181d'), OUTRO, 'outro');
await browser.close();

// App frames arrive only on change: hold each frame until the next one (same clock as the terminal).
const frames = tl.frames, list = [];
let i = Math.max(0, frames.findIndex(f => f.t > start) - 1);
for (; i < frames.length && frames[i].t < end; i++) {
  const from = Math.max(frames[i].t, start), to = Math.min(frames[i + 1]?.t ?? end, end);
  if (to > from) list.push(`file '${path.join(dir, frames[i].file).replaceAll('\\', '/')}'`, `duration ${(to - from).toFixed(4)}`);
}
list.push(list.at(-2));
await fs.writeFile(path.join(work, 'app.txt'), list.join('\n'));

const font = path.resolve('public/fonts/AgentSketchExport-Semibold.ttf').replaceAll('\\', '/').replace(':', '\\:');
// Clock shows real session seconds: output time mapped back through the two speeds.
const k = thinkSpeed.toFixed(4), real = `if(lt(t\\,${THINK})\\,t*${k}\\,${think.toFixed(3)}+(t-${THINK})*${DRAW})`;
const y = Math.round(top / 2 - 14);
const label = (text, enable) => `drawtext=fontfile='${font}':text='${text}':fontsize=20:fontcolor=white:box=1:boxcolor=0xF76B15:boxborderw=10:x=${left + 830}:y=${y + 2}:enable='${enable}'`;
const digits = (expr, x) => `drawtext=fontfile='${font}':text='%{eif\\:${expr}\\:d\\:2}':fontsize=26:fontcolor=white:x=${x}:y=${y}`;
await fs.writeFile(path.join(work, 'session.filter'), [
  `[1:v]trim=start=${SCREEN_CUT}:duration=${session.toFixed(3)},setpts=PTS-STARTPTS,fps=${FPS},crop=${TERM_CROP.w}:${TERM_CROP.h}:${TERM_CROP.x}:${TERM_CROP.y},scale=${term.w}:${term.h}:flags=lanczos[t]`,
  `[2:v]fps=${FPS},scale=${app.w}:${app.h}:flags=lanczos,trim=duration=${session.toFixed(3)},setpts=PTS-STARTPTS[a]`,
  `[0:v][t]overlay=${term.x}:${term.y}:shortest=1[v1]`,
  `[v1][a]overlay=${app.x}:${app.y},split[p1][p2]`,
  `[p1]trim=duration=${think.toFixed(3)},setpts=(PTS-STARTPTS)/${k}[s1]`,
  `[p2]trim=start=${think.toFixed(3)},setpts=(PTS-STARTPTS)/${DRAW}[s2]`,
  `[s1][s2]concat=n=2:v=1,fps=${FPS},` +
    label(`×${Math.round(thinkSpeed)} 배속 · 생각하는 구간`, `lt(t,${THINK})`) + ',' +
    label(`×${DRAW} 배속 · 그리는 구간`, `gte(t,${THINK})`) + ',' +
    digits(`trunc((${real})/60)`, W - left - 100) + ',' +
    `drawtext=fontfile='${font}':text='\\:':fontsize=26:fontcolor=white:x=${W - left - 67}:y=${y - 2},` +
    digits(`mod(trunc(${real})\\,60)`, W - left - 56) + '[v]',
].join(';\n'));
ff('-loop', '1', '-framerate', String(FPS), '-i', path.join(work, 'bg.png'), '-i', path.join(dir, tl.terminal.file),
  '-f', 'concat', '-safe', '0', '-i', path.join(work, 'app.txt'),
  '-/filter_complex', path.join(work, 'session.filter'), '-map', '[v]', '-t', out.toFixed(3),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', path.join(dir, 'session.mp4'));

// README GIF: the session only, like the earlier demo.gif.
ff('-i', path.join(dir, 'session.mp4'), '-vf', 'fps=5,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', path.join(dir, 'demo.gif'));

// Intro → session → end card with short crossfades.
ff('-i', path.join(work, 'intro.mp4'), '-i', path.join(dir, 'session.mp4'), '-i', path.join(work, 'outro.mp4'), '-filter_complex',
  `[0:v][1:v]xfade=transition=fade:duration=0.5:offset=${(INTRO - .5).toFixed(2)}[x];[x][2:v]xfade=transition=fade:duration=0.6:offset=${(INTRO - .5 + out - .6).toFixed(2)}[v]`,
  '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'demo.mp4'));
console.log(JSON.stringify({realSession: session.toFixed(1), think: think.toFixed(1), thinkSpeed: thinkSpeed.toFixed(1), video: out.toFixed(1), total: (INTRO + out + OUTRO - 1.1).toFixed(1)}));
