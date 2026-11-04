(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const span = (p, a, b) => clamp((p - a) / (b - a));
  const ease = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------- i18n ---------------- */
  const EN = {
    platform: 'Download OS', skip: 'Skip to content', navLabel: 'Page', navProof: 'How it works', navFeatures: 'Features', navAgent: 'AI agents', navDownload: 'Download',
    heroTitle: 'Scattered screenshots,<br />one clear flow.',
    heroLede: 'Paste your captures and hand them to an AI agent. Claude or Codex connects to the AgentSketch app and draws the shapes, routes the connectors and tidies the layout.',
    ctaSource: 'View source', metaFree: 'MIT open source', scrollHint: 'Scroll and the agent tidies up',
    stageAria: 'Example scene: an AI agent turns scattered screenshots into a flowchart', winTitle: 'Launch prep.agentsketch', winPill: 'External control',
    capDesignCh: 'design', capDesignWho: 'Mina', capDesignMsg: 'Final mockups v3 are up', capDesignWho2: 'Joon', capDesignMsg2: 'Contrast checked!',
    nodeDesign: 'Design mockups', capDevDone: 'Done', capDevTitle: 'Fix checkout bug and improve alerts', nodeDev: 'Feature build',
    capQaTitle: 'QA checklist.xlsx', capQaCol1: 'Item', capQaCol2: 'Result', capQa1: 'Sign-in', capQa2: 'Checkout', capQa3: 'Alerts', capPass: 'Pass', capRetest: 'Retest', nodeQa: 'QA pass',
    capNoticeTitle: 'Launch notice (draft)', nodeNotice: 'Launch notice', capFaq: 'FAQ doc<br />due when?', nodeFaq: 'FAQ ready',
    capCalMonth: 'November', capCalEvent: 'Nov 20 · Launch', nodeCal: 'Launch date 11/20', nodeLaunch: 'Ready to launch',
    promptWho: 'To your AI agent', exampleLabel: 'Example scene',
    tidyTitle: 'Scattered captures, one sheet — by AI.',
    tidySub: 'Paste chat, checklist and calendar screenshots and ask: the agent turns them into nodes and joins them with orthogonal connectors. Changed elements get a blue AI tag, and one Ctrl+Z undoes it all. Scroll to watch.',
    proofTitle: 'Ask in words. It draws in the app.',
    proofSub: 'This is a real recording. An AI agent attached to the running app with <code>agentsketch connect</code> and drew how a bill becomes law, step by step. Changed elements get a blue AI tag, and one Ctrl+Z undoes a whole batch.',
    videoAria: 'Real screen recording of an AI agent in a terminal drawing a flowchart in AgentSketch over MCP', play: 'Play', videoCap: 'Unscripted real session · gjc (DeepSeek V4.1) terminal left, AgentSketch app right · thinking 13×, drawing 2×',
    featTitle: 'A light editor<br />for exact relationships.',
    f1t: 'Orthogonal connectors that route around shapes', f1d: 'Move an element and the line finds a new path. Pin up to 32 waypoints yourself.',
    f2t: 'Screenshots in one Ctrl+V', f2d: 'Images are stored inside the document, so one file carries everything.',
    f3t: 'Auto layout you preview first', f3d: 'Left→right, top→down, tree, radial or by owner. Locked elements and hand-placed routes stay put.',
    f4t: 'Sources and prerequisites', f4d: 'Attach source, version, owner and checks to elements, then see what is missing and what a change affects.',
    f5t: 'Export straight to reports', f5d: 'PNG, SVG, PDF with real text, PPTX with editable shapes, HTML, CSV and draw.io.',
    toyA: 'Collect data', toyBlock: 'Another shape', toyB: 'Write report', toyCap: 'Drag the right box. With a keyboard, Tab to it and use the arrow keys.',
    agentTitle: 'AI agents drive the app directly.',
    agentSub: '104 commands through a CLI and an MCP server. No AI key required: the agent you already use writes the commands and AgentSketch runs them.',
    code1: '#&nbsp;Discover commands', code2: '#&nbsp;Attach to the running app',
    g1t: 'Applied together, undone together', g1d: 'Changes land as one batch and one Ctrl+Z in the app reverts them. dryRun returns the plan only.',
    g2t: 'Connected only on this PC', g2d: 'A random 127.0.0.1 port with a session token; requests from websites are rejected.',
    g3t: 'Work you can see', g3d: 'While connected, the app shows “External control” at the top. Click it to disconnect.',
    localTitle: 'No account, no cloud. Work locally with a Windows executable or a macOS app.',
    localSub: 'Documents and recovery files stay on your PC. No telemetry or update pings; OCR, external AI and LAN collaboration use the network only when you turn them on.',
    closeTitle: 'Download it and draw your first flow.', ctaStar: 'Star on GitHub',
    reqOs: 'Requirements', reqOsD: 'Windows 10/11 x64 or macOS 12+', reqAi: 'AI agents', reqAiD: 'Node.js 24+, Edge on Windows or Chrome/Edge on macOS',
    reqSign: 'Signing', reqSignD: 'Windows may show SmartScreen warnings. macOS uses an ad-hoc signature without Developer ID signing or notarization; Gatekeeper may block first launch.', reqSha: 'Verify with SHA256',
    footLabel: 'Footer', footReleases: 'Releases', footGuide: 'User guide (KO)', footSecurity: 'Security', footLicense: 'MIT License · Font based on Pretendard (SIL OFL)',
  };
  const META = {
    ko: { title: document.title, desc: $('meta[name="description"]').content, typed: '흩어진 캡처들, 출시 흐름으로 정리해줘', count: (n, e) => `${n}개 요소 · ${e}개 연결`, toggle: 'EN', toggleAria: 'Switch to English' },
    en: { title: 'AgentSketch · Scattered screenshots, one clear flow', desc: 'An offline flowchart editor for Windows and macOS that AI agents can control.', typed: 'Turn these screenshots into a launch flow', count: (n, e) => `${n} elements · ${e} connectors`, toggle: '한국어', toggleAria: '한국어로 보기' },
  };
  const KO = new Map();
  $$('[data-k]').forEach(el => KO.set(el, el.innerHTML));
  const KO_ARIA = new Map();
  $$('[data-k-aria]').forEach(el => KO_ARIA.set(el, el.getAttribute('aria-label')));
  let lang = document.documentElement.lang === 'en' ? 'en' : 'ko';

  function applyLang(next) {
    lang = next;
    document.documentElement.lang = lang;
    $$('[data-k]').forEach(el => { const k = el.dataset.k; el.innerHTML = lang === 'en' && EN[k] ? EN[k] : KO.get(el); });
    $$('[data-k-aria]').forEach(el => { const k = el.dataset.kAria; el.setAttribute('aria-label', lang === 'en' && EN[k] ? EN[k] : KO_ARIA.get(el)); });
    const m = META[lang];
    document.title = m.title;
    $('meta[name="description"]').content = m.desc;
    const t = $('[data-lang-toggle]');
    $('[data-lang-label]', t).textContent = m.toggle;
    t.setAttribute('aria-label', m.toggleAria);
    renderDownload();
    try { localStorage.setItem('fp-lang', lang); } catch (e) {}
    lastP = -1; schedule();
    if (typeof typePrompt === 'function') typePrompt();
  }
  $('[data-lang-toggle]').addEventListener('click', () => applyLang(lang === 'en' ? 'ko' : 'en'));

  /* ---------------- latest release ---------------- */
  const releasesURL = 'https://github.com/devjay4561/AgentSketch/releases';
  // Pinned published assets keep both downloads working when the API is unavailable.
  const downloads = {
    windows: { tag: 'v0.1.2', name: 'AgentSketch-Windows.zip', size: 19516686,
      browser_download_url: `${releasesURL}/download/v0.1.2/AgentSketch-Windows.zip` },
    macos: { tag: 'v0.1.2', name: 'AgentSketch-macOS-universal.zip', size: 28639511,
      browser_download_url: `${releasesURL}/download/v0.1.2/AgentSketch-macOS-universal.zip` },
  };
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  const mobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let selectedOS = mobile ? '' : /Win/i.test(platform) ? 'windows' : /Mac/i.test(platform) ? 'macos' : '';

  function renderDownload() {
    const asset = downloads[selectedOS];
    $$('[data-platform]').forEach(el => { el.value = selectedOS; });
    const label = !selectedOS ? (lang === 'en' ? 'Choose an OS' : 'OS를 선택하세요') : !asset
      ? (lang === 'en' ? 'View available releases' : '게시된 릴리스 보기')
      : `${selectedOS === 'macos' ? 'macOS' : 'Windows'} ZIP · ${(asset.size / 1048576).toFixed(1)} MB`;
    $$('[data-download-label]').forEach(el => { el.textContent = label; });
    $$('[data-download]').forEach(el => { el.href = asset?.browser_download_url || (selectedOS ? releasesURL : '#download'); });
    $$('[data-release]').forEach(el => { el.textContent = asset?.tag || '—'; });
    const info = !selectedOS ? (lang === 'en' ? 'Choose Windows or macOS. Other platforms are not supported.' : 'Windows 또는 macOS를 선택하세요. 다른 OS는 지원하지 않습니다.')
      : !asset ? (lang === 'en' ? 'No verified download is available here. Check GitHub Releases.' : '여기서 확인된 다운로드가 없습니다. GitHub Releases를 확인하세요.')
      : selectedOS === 'macos' ? (lang === 'en' ? 'macOS 12+ · Apple Silicon and Intel. Extract the ZIP and move AgentSketch.app to Applications. Not notarized: if blocked, verify the download and use Privacy & Security → Open Anyway.' : 'macOS 12+ · Apple Silicon 및 Intel. ZIP을 풀고 AgentSketch.app을 응용 프로그램으로 옮기세요. 공증되지 않은 앱입니다. 차단되면 파일을 확인한 뒤 개인정보 보호 및 보안 → 그래도 열기를 사용하세요.')
      : (lang === 'en' ? 'Windows 10/11 x64 · WebView2 required. Extract the ZIP and run AgentSketch.exe. SmartScreen may warn.' : 'Windows 10/11 x64 · WebView2 필요. ZIP을 풀고 AgentSketch.exe를 실행하세요. SmartScreen 경고가 표시될 수 있습니다.');
    $$('[data-download-info]').forEach(el => { el.textContent = info; });
    const checksum = $('[data-k="reqSha"]');
    checksum.href = asset ? `${releasesURL}/download/${asset.tag}/SHA256SUMS.txt` : releasesURL;
  }
  $$('[data-platform]').forEach(el => el.addEventListener('change', () => { selectedOS = el.value; renderDownload(); }));
  renderDownload();
  fetch('https://api.github.com/repos/devjay4561/AgentSketch/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(data => {
      if (data.draft || data.prerelease || !data.tag_name) return;
      // Only universal Mac builds can be offered to both Intel and Apple Silicon.
      for (const [os, name] of Object.entries({ windows: 'AgentSketch-Windows.zip', macos: 'AgentSketch-macOS-universal.zip' })) {
        const asset = (data.assets || []).find(a => a.name === name && a.state === 'uploaded' && a.size > 0);
        if (asset && asset.browser_download_url === `${releasesURL}/download/${data.tag_name}/${name}`) downloads[os] = { ...asset, tag: data.tag_name };
      }
      renderDownload();
    })
    .catch(() => { /* Keep only previously verified downloads and the releases fallback. */ });

  /* ---------------- hero: scroll-scrubbed tidy ---------------- */
  const stage = $('[data-stage]');
  const board = $('[data-board]');
  const caps = $$('[data-cap]');
  const wires = $$('[data-wires] > path');
  const scribbles = $('[data-scribbles]');
  const result = $('[data-result]');
  const prompt = $('[data-prompt]');
  const typed = $('[data-typed]');
  const pill = $('[data-pill]');
  const count = $('[data-count]');

  // Two compositions of the same scene: wide board for desktop, tall board for phones.
  const LAYOUTS = {
    wide: {
      w: 1000, h: 640,
      messy: { design: [60, 60, 280, 170, -5], dev: [380, 236, 290, 150, -3], qa: [520, 64, 300, 182, 4], notice: [116, 300, 250, 220, 3], faq: [440, 430, 200, 140, -7], cal: [706, 330, 230, 196, 6] },
      tidy: { design: [48, 120, 168, 60], dev: [276, 120, 168, 60], qa: [504, 120, 168, 60], notice: [276, 360, 168, 60], faq: [504, 360, 168, 60], cal: [760, 470, 200, 60] },
      result: [760, 230, 200, 96], prompt: [290, 562, 420],
      wires: ['M216 150 H276', 'M444 150 H504', 'M444 390 H504', 'M672 150 H860 V230', 'M672 390 H716 V294 H760', 'M860 470 V326'],
      scribbles: ['M322 168 C 392 150, 410 214, 452 252', 'M640 236 C 700 268, 690 318, 742 344', 'M352 432 C 392 470, 410 488, 452 486', 'M560 380 C 590 300, 600 286, 612 266', 'M226 290 C 214 262, 236 246, 244 226', 'M846 300 c 30 -14 52 6 40 26 c -10 18 -40 16 -46 -2'],
    },
    tall: {
      w: 520, h: 780,
      messy: { design: [20, 30, 250, 160, -5], dev: [40, 236, 262, 140, -3], qa: [252, 44, 250, 172, 5], notice: [262, 244, 232, 210, 4], faq: [50, 428, 200, 140, -6], cal: [272, 476, 220, 186, 5] },
      tidy: { design: [40, 50, 200, 60], dev: [40, 160, 200, 60], qa: [40, 270, 200, 60], notice: [280, 160, 200, 60], faq: [280, 270, 200, 60], cal: [150, 590, 220, 60] },
      result: [150, 420, 220, 96], prompt: [40, 690, 440],
      wires: ['M140 110 V160', 'M140 220 V270', 'M380 220 V270', 'M140 330 V375 H220 V420', 'M380 330 V375 H300 V420', 'M260 590 V516'],
      scribbles: ['M196 192 C 214 214, 188 228, 172 238', 'M300 214 C 318 226, 300 238, 316 250', 'M150 378 C 162 398, 140 408, 128 424', 'M262 520 C 280 520, 288 532, 300 544', 'M420 228 C 440 238, 430 246, 424 256', 'M470 470 c 22 -10 38 4 30 20 c -8 14 -30 12 -34 -2'],
    },
  };
  let L = null;

  function sizeBoard() {
    const next = board.clientWidth < 560 && innerWidth < 760 ? LAYOUTS.tall : LAYOUTS.wide;
    if (next !== L) {
      L = next;
      const inner = $('[data-board-in]');
      board.style.setProperty('--ar', `${L.w} / ${L.h}`);
      inner.style.width = `${L.w}px`; inner.style.height = `${L.h}px`;
      for (const svg of [scribbles, $('[data-wires]')]) svg.setAttribute('viewBox', `0 0 ${L.w} ${L.h}`);
      wires.forEach((p, i) => p.setAttribute('d', L.wires[i]));
      $$(':scope > path', scribbles).forEach((p, i) => { p.setAttribute('d', L.scribbles[i]); p.setAttribute('marker-end', p.classList.contains('loop') ? '' : 'url(#hand)'); });
      const [rx, ry, rw, rh] = L.result;
      Object.assign(result.style, { left: `${rx}px`, top: `${ry}px`, width: `${rw}px`, height: `${rh}px` });
      const [px, py, pw] = L.prompt;
      Object.assign(prompt.style, { left: `${px}px`, top: `${py}px`, width: `${pw}px` });
    }
    board.style.setProperty('--s', (board.clientWidth / L.w).toFixed(4));
  }

  let lastP = -1;
  function render(p) {
    if (Math.abs(p - lastP) < 0.0005) return;
    lastP = p;
    // Agent prompt types itself first.
    pill.classList.toggle('working', p > .15 && p < .9);
    scribbles.style.opacity = 1 - span(p, .15, .3);

    caps.forEach((el, i) => {
      const id = el.dataset.cap, a = L.messy[id], b = L.tidy[id];
      const start = .17 + i * .035, t = ease(span(p, start, start + .3));
      const x = lerp(a[0], b[0], t), y = lerp(a[1], b[1], t), w = lerp(a[2], b[2], t), h = lerp(a[3], b[3], t), r = lerp(a[4], 0, t);
      el.style.width = `${w}px`; el.style.height = `${h}px`;
      el.style.transform = `translate(${x}px, ${y}px) rotate(${r}deg)`;
      el.style.setProperty('--lift', (1 - t).toFixed(3));
      el.children[0].style.opacity = 1 - span(t, .55, .9);
      el.children[1].style.opacity = span(t, .62, .98);
      el.classList.toggle('ai', p > start + .22);
    });

    let drawn = 0;
    wires.forEach((path, j) => {
      const k = span(p, .62 + j * .04, .7 + j * .04);
      if (path.classList.contains('dash')) path.style.setProperty('--o', k.toFixed(3));
      else path.style.setProperty('--d', (1 - k).toFixed(4));
      path.classList.toggle('done', k >= 1);
      if (k >= 1) drawn++;
    });
    const r = ease(span(p, .72, .8));
    result.style.opacity = r;
    result.style.transform = `scale(${lerp(.7, 1, r)})`;
    result.classList.toggle('ai', p > .76);
    count.textContent = META[lang].count(6 + (r > .5 ? 1 : 0), drawn);
  }

  let ticking = false;
  function frame() {
    ticking = false;
    if (reduced.matches || !stage.offsetParent) { render(1); return; }
    const top = stage.getBoundingClientRect().top;
    const pinTop = parseFloat(getComputedStyle(stage.firstElementChild).top) || 0;
    const travel = stage.offsetHeight - stage.firstElementChild.offsetHeight;
    render(clamp((pinTop - top) / Math.max(1, travel)));
  }
  function schedule() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', () => { sizeBoard(); lastP = -1; schedule(); });
  reduced.addEventListener?.('change', () => { lastP = -1; schedule(); });
  sizeBoard();
  frame();

  // The request types itself once on arrival (time-based, independent of scroll).
  let typeTimer = 0;
  function typePrompt() {
    clearInterval(typeTimer);
    const text = META[lang].typed;
    if (reduced.matches) { typed.textContent = text; return; }
    let i = 0; typed.textContent = '';
    typeTimer = setInterval(() => { typed.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(typeTimer); }, 55);
  }
  setTimeout(typePrompt, 500);

  /* ---------------- real recording ---------------- */
  const video = $('[data-demo]');
  const frameEl = video.closest('.video-frame');
  const playBtn = $('[data-play]');
  const play = () => video.play().then(() => frameEl.classList.add('playing')).catch(() => {});
  playBtn.addEventListener('click', () => { video.controls = true; play(); });
  video.addEventListener('playing', () => frameEl.classList.add('playing'));
  video.addEventListener('pause', () => { if (!video.controls) frameEl.classList.remove('playing'); });
  if (reduced.matches) video.pause();
  else frameEl.classList.add('playing');
  if (!reduced.matches && 'IntersectionObserver' in window) {
    // Plays on arrival (hero); pauses only while scrolled away to save CPU.
    new IntersectionObserver(([e]) => { if (e.isIntersecting) play(); else video.pause(); }, { threshold: .2 }).observe(video);
  }

  /* ---------------- connector toy ---------------- */
  const toy = $('[data-toy]');
  const A = $('[data-toy-a]'), B = $('[data-toy-b]'), BLOCK = $('[data-toy-block]');
  const wire = $('[data-toy-path]');
  let NW = 150, NH = 64;
  const PAD = 18;
  const pos = { a: { x: 24, y: 40 }, blk: { x: 0, y: 0, w: 120, h: 150 }, b: null };
  let narrow = null;

  function place() {
    const W = toy.clientWidth, H = toy.clientHeight;
    NW = A.offsetWidth || NW; NH = A.offsetHeight || NH;
    const isNarrow = W < 480;
    if (isNarrow !== narrow) { narrow = isNarrow; pos.b = null; }
    // Narrow canvases put the obstacle in the middle column so the first route already detours.
    Object.assign(pos.blk, narrow ? { w: 96, h: 110 } : { w: 120, h: 150 });
    pos.a = narrow ? { x: 16, y: 24 } : { x: 24, y: 40 };
    pos.blk.x = Math.round((W - pos.blk.w) / 2); pos.blk.y = Math.round(H / 2 - pos.blk.h / 2);
    BLOCK.style.width = `${pos.blk.w}px`; BLOCK.style.height = `${pos.blk.h}px`;
    if (!pos.b) pos.b = narrow ? { x: W - NW - 16, y: H - NH - 24 } : { x: W - NW - 24, y: H - NH - 40 };
    pos.b.x = clamp(pos.b.x, 8, W - NW - 8); pos.b.y = clamp(pos.b.y, 8, H - NH - 8);
    A.style.transform = `translate(${pos.a.x}px, ${pos.a.y}px)`;
    BLOCK.style.transform = `translate(${pos.blk.x}px, ${pos.blk.y}px)`;
    B.style.transform = `translate(${pos.b.x}px, ${pos.b.y}px)`;
    route();
  }

  const rect = (x, y, w, h, pad = 0) => ({ l: x - pad, t: y - pad, r: x + w + pad, b: y + h + pad });
  function hits(p, q, rc) {
    if (p.y === q.y) { const [x1, x2] = p.x < q.x ? [p.x, q.x] : [q.x, p.x]; return p.y > rc.t && p.y < rc.b && x2 > rc.l && x1 < rc.r; }
    const [y1, y2] = p.y < q.y ? [p.y, q.y] : [q.y, p.y]; return p.x > rc.l && p.x < rc.r && y2 > rc.t && y1 < rc.b;
  }
  function route() {
    const P = { x: pos.a.x + NW, y: pos.a.y + NH / 2 }, Q = { x: pos.b.x, y: pos.b.y + NH / 2 };
    const obstacles = [rect(pos.blk.x, pos.blk.y, pos.blk.w, pos.blk.h, 12), rect(pos.a.x, pos.a.y, NW, NH, 6), rect(pos.b.x, pos.b.y, NW, NH, 6)];
    const x1 = P.x + PAD, x2 = Q.x - PAD, o = obstacles[0];
    const xs = [(P.x + Q.x) / 2, o.l - 6, o.r + 6, x1, x2];
    const ys = [o.t - 6, o.b + 6, pos.a.y - PAD, pos.a.y + NH + PAD, pos.b.y - PAD, pos.b.y + NH + PAD, (P.y + Q.y) / 2];
    const cands = [];
    for (const x of xs) if (x >= x1 - .5 && x <= x2 + .5) cands.push([P, { x, y: P.y }, { x, y: Q.y }, Q]);
    for (const y of ys) for (const ax of [x1, ...xs.filter(v => v > x1)]) for (const bx of [x2, ...xs.filter(v => v < x2)])
      cands.push([P, { x: ax, y: P.y }, { x: ax, y }, { x: bx, y }, { x: bx, y: Q.y }, Q]);
    let best = null, bestCost = Infinity;
    for (const pts of cands) {
      let len = 0, ok = true;
      for (let i = 0; i < pts.length - 1 && ok; i++) {
        const p = pts[i], q = pts[i + 1];
        len += Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
        if (i > 0 && i < pts.length - 2 && (hits(p, q, obstacles[1]) || hits(p, q, obstacles[2]))) ok = false;
        if (hits(p, q, obstacles[0])) ok = false;
      }
      const cost = len + (pts.length - 2) * 24;
      if (ok && cost < bestCost) { best = pts; bestCost = cost; }
    }
    best ||= [P, { x: x1, y: P.y }, { x: x1, y: Q.y }, Q];
    const clean = best.filter((p, i, a) => i === 0 || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
    wire.setAttribute('d', clean.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '));
  }

  let drag = null;
  B.addEventListener('pointerdown', e => {
    B.setPointerCapture(e.pointerId); B.classList.add('grabbing');
    drag = { dx: e.clientX - pos.b.x, dy: e.clientY - pos.b.y };
  });
  B.addEventListener('pointermove', e => {
    if (!drag) return;
    pos.b.x = e.clientX - drag.dx; pos.b.y = e.clientY - drag.dy;
    requestAnimationFrame(place);
  });
  const end = () => { drag = null; B.classList.remove('grabbing'); };
  B.addEventListener('pointerup', end);
  B.addEventListener('pointercancel', end);
  B.addEventListener('keydown', e => {
    const step = e.shiftKey ? 40 : 12, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault(); pos.b.x += d[0]; pos.b.y += d[1]; place();
  });
  new ResizeObserver(place).observe(toy);

  if (lang === 'en') applyLang('en');
})();
