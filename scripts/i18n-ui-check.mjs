// English UI coverage: opens menus, panels and the property inspector in English and lists
// any Korean UI text left untranslated. User content (canvas, inputs, textareas) is ignored.
// Usage (dev server on 18440): node scripts/i18n-ui-check.mjs  →  exit 1 when Korean remains
import {chromium} from 'playwright';
import fs from 'node:fs/promises';

const url = (process.env.AGENTSKETCH_TEST_URL || 'http://127.0.0.1:18440') + '/?lang=en';
const browser = await chromium.launch({channel: 'msedge', headless: true, args: ['--disable-features=AutofillAiWalletPrivatePasses']});
const page = await browser.newPage({locale: 'en-US', viewport: {width: 1440, height: 900}});
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url);
await page.waitForTimeout(800);
await fs.mkdir('output/i18n', {recursive: true});

const found = new Map();
async function scan(where) {
  const items = await page.evaluate(() => {
    const out = [], H = /[가-힣]/;
    const skip = el => el.closest('[data-no-i18n],textarea,[contenteditable="true"],canvas,#document-title');
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) { const el = n.parentElement; if (el && H.test(n.nodeValue) && !skip(el) && visible(el)) out.push(n.nodeValue.trim()); }
    for (const el of document.querySelectorAll('[aria-label],[title],[placeholder],[data-tooltip]')) {
      if (skip(el)) continue;
      for (const a of ['aria-label', 'title', 'placeholder', 'data-tooltip']) { const v = el.getAttribute(a); if (v && H.test(v)) out.push(`@${a}: ${v}`); }
    }
    return out;
  });
  for (const s of items) if (!found.has(s)) found.set(s, where);
}
const click = async sel => { const el = page.locator(sel).first(); if (await el.count()) { await el.click({timeout: 2000}).catch(() => {}); await page.waitForTimeout(250); } };

await scan('initial');
await page.screenshot({path: 'output/i18n/main.png'});
await click('summary[aria-label]'); await scan('file menu'); await page.keyboard.press('Escape');
await click('[data-action="help"]'); await scan('help'); await page.screenshot({path: 'output/i18n/help.png'}); await page.keyboard.press('Escape');
await page.mouse.click(400, 380); await scan('node selected'); await page.screenshot({path: 'output/i18n/selected.png'});
await click('[data-tab="layers"]'); await scan('layers'); await click('[data-tab="properties"]');
for (const tool of ['connect', 'text', 'note', 'frame', 'draw', 'hand']) { await click(`[data-tool="${tool}"]`); await scan(`tool ${tool}`); }
await click('[data-tool="select"]');
await click('[data-action="workbench"]');
const panels = await page.locator('.wb-nav button[data-panel]').evaluateAll(bs => bs.map(b => b.dataset.panel));
for (const id of panels) { await click(`.wb-nav button[data-panel="${id}"]`); await page.waitForTimeout(300); await scan(`workbench ${id}`); await page.screenshot({path: `output/i18n/wb-${id}.png`}); }
await page.keyboard.press('Escape');
await browser.close();

const list = [...found].map(([text, where]) => ({where, text}));
await fs.writeFile('output/i18n/untranslated.json', JSON.stringify(list, null, 2));
console.log(JSON.stringify({untranslated: list.length, panels: panels.length, errors}, null, 1));
for (const {where, text} of list.slice(0, 60)) console.log(`${where} | ${text}`);
process.exit(list.length || errors.length ? 1 : 0);
