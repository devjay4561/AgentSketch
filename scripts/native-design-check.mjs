import { chromium } from 'playwright';
import fs from 'node:fs/promises';
let ready = false;
for (let i = 0; i < 50; i++) {
  try { const response = await fetch('http://127.0.0.1:9227/json'); if (response.ok) { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 200));
}
if (!ready) throw new Error('Native test instance did not open its local debug port');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9227');
try {
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page');
  if (!page) throw new Error('Native AgentSketch page not found');
  await page.waitForURL('http://wails.localhost/**', {timeout: 20000});
  await page.waitForFunction(() => document.fonts.check('500 13px "Pretendard Variable"') && document.querySelector('#save-status')?.textContent.includes('자동 복구 저장됨'));
  const state = await page.evaluate(async () => {
    const doc = JSON.parse(await window.go.main.App.LoadAutosave());
    return {
      native: Boolean(window.go.main.App),
      font: getComputedStyle(document.body).fontFamily,
      loaded: document.fonts.check('500 13px "Pretendard Variable"'),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      fontResources: performance.getEntriesByType('resource').filter(r => /woff2/.test(r.name)).map(r => r.name),
      nodes: doc.nodes.length, edges: doc.edges.length,
      title: doc.title,
    };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const {root} = await cdp.send('DOM.getDocument');
  const {nodeId} = await cdp.send('DOM.querySelector', {nodeId: root.nodeId, selector: '#empty-inspector h2'});
  const {fonts} = await cdp.send('CSS.getPlatformFontsForNode', {nodeId});
  state.actualFonts = fonts;
  if (!state.native || !state.loaded || state.accent !== '#f76b15' || !fonts.some(f => /Pretendard/.test(f.familyName) && f.isCustomFont && f.glyphCount > 0)) throw new Error(JSON.stringify(state));
  if (state.fontResources.some(url => !url.startsWith('http://wails.localhost/'))) throw new Error('Remote font dependency');
  await fs.mkdir('output/design', {recursive:true});
  await page.screenshot({path:'output/design/native-redesign.png'});
  await fs.writeFile('output/design/native-design-check.json', JSON.stringify(state,null,2));
  console.log(JSON.stringify(state,null,2));
} finally { await browser.close(); }
