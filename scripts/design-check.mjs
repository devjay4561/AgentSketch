import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseURL = process.env.AGENTSKETCH_TEST_URL || 'http://127.0.0.1:18440';
const outputDir = 'output/design';
const sourceFiles = ['index.html', 'src/style.css', 'src/main.ts', 'src/ui-feedback.ts', 'src/theme.ts'];
const hashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
await mkdir(outputDir, { recursive: true });
const report = { startedAt: new Date().toISOString(), url: baseURL, sourceBefore: await hashes(), checks: [], viewports: [], errors: [], screenshots: [] };
function check(name, passed, evidence) {
  report.checks.push({ name, status: passed ? 'pass' : 'fail', evidence });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${passed ? '' : `: ${JSON.stringify(evidence)}`}`);
}
const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  args: ['--disable-features=AutofillAiWalletPrivatePasses'],
});

async function snapshot(page, name) {
  const path = `${outputDir}/${name}.png`;
  await page.screenshot({ path, animations: 'disabled' });
  report.screenshots.push(path);
}

async function overflow(page) {
  return page.evaluate(() => ({
    width: innerWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    appScrollWidth: document.querySelector('#app').scrollWidth,
    containers: ['.app-header', '.header-actions', '.workspace', '.inspector', '.statusbar'].map(selector => {
      const el = document.querySelector(selector), b = el.getBoundingClientRect();
      return { selector, left: b.left, right: b.right, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth };
    }),
  }));
}

async function contrast(page, selectors) {
  return page.evaluate(selectors => {
    const parse = text => {
      const values = text.match(/[\d.]+/g)?.map(Number) || [];
      return { rgb: values.slice(0, 3), alpha: values.length > 3 ? values[3] : 1 };
    };
    const composite = (fg, bg) => fg.rgb.map((value, i) => value * fg.alpha + bg[i] * (1 - fg.alpha));
    const background = el => {
      const chain = []; for (let node = el; node; node = node.parentElement) chain.push(parse(getComputedStyle(node).backgroundColor));
      return chain.reverse().reduce((bg, fg) => composite(fg, bg), [255, 255, 255]);
    };
    const luminance = rgb => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    return selectors.map(selector => {
      const el = document.querySelector(selector), css = getComputedStyle(el), bg = background(el), fg = composite(parse(css.color), bg);
      const a = luminance(fg), b = luminance(bg);
      return { selector, color: css.color, background: bg, fontSize: css.fontSize, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  }, selectors);
}

async function fonts(page, context) {
  const computed = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      root: getComputedStyle(document.documentElement).fontFamily,
      body: getComputedStyle(document.body).fontFamily,
      loaded: document.fonts.check('500 13px "Pretendard Variable"', '월간보고 AgentSketch'),
      faces: [...document.fonts].map(face => ({ family: face.family, status: face.status })),
    };
  });
  const client = await context.newCDPSession(page);
  await client.send('DOM.enable'); await client.send('CSS.enable');
  const { root } = await client.send('DOM.getDocument');
  const rendered = [];
  for (const selector of ['.brand > span', '#selection-summary', '#empty-inspector h2']) {
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const result = await client.send('CSS.getPlatformFontsForNode', { nodeId });
    rendered.push({ selector, fonts: result.fonts });
  }
  await client.detach();
  return { computed, rendered };
}

async function feedbackChecks(page) {
  await page.evaluate(() => {
    window.__designTiming = [];
    document.addEventListener('pointerover', event => {
      const el = event.target instanceof Element ? event.target.closest('[data-tooltip]') : null;
      const old = event.relatedTarget instanceof Element ? event.relatedTarget.closest('[data-tooltip]') : null;
      if (el && el !== old) window.__designTiming.push({ event: 'hover', text: el.dataset.tooltip, time: performance.now() });
    });
    const tip = document.querySelector('#tool-tooltip');
    new MutationObserver(() => window.__designTiming.push({ event: tip.hidden ? 'hide' : 'show', text: tip.textContent, time: performance.now() })).observe(tip, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
  });
  await page.mouse.move(700, 40);
  await page.waitForTimeout(850);
  const rect = await page.locator('[data-tool="rect"]').boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.waitForTimeout(250);
  const hiddenEarly = await page.locator('#tool-tooltip').evaluate(el => el.hidden);
  await page.waitForFunction(() => !document.querySelector('#tool-tooltip').hidden);
  const first = await page.evaluate(() => {
    const events = window.__designTiming, start = events.find(event => event.event === 'hover' && event.text.includes('사각형'));
    const show = events.find(event => event.event === 'show' && event.time >= start.time && event.text.includes('사각형'));
    return { delay: show.time - start.time, text: show.text };
  });
  check('Tooltip first hover waits approximately 450 ms', hiddenEarly && first.delay >= 390 && first.delay <= 800, { hiddenAt250ms: hiddenEarly, ...first });
  const round = await page.locator('[data-tool="round"]').boundingBox();
  await page.mouse.move(round.x + round.width / 2, round.y + round.height / 2);
  await page.waitForFunction(() => !document.querySelector('#tool-tooltip').hidden && document.querySelector('#tool-tooltip').textContent.includes('둥근'));
  const adjacent = await page.evaluate(() => {
    const events = window.__designTiming, start = [...events].reverse().find(event => event.event === 'hover' && event.text.includes('둥근'));
    const show = events.find(event => event.event === 'show' && event.time >= start.time && event.text.includes('둥근'));
    return { delay: show.time - start.time, text: show.text };
  });
  check('Tooltip adjacent hover appears immediately', adjacent.delay < 120, adjacent);
  await snapshot(page, '1440x900-tooltip');
  await page.keyboard.press('v');
  check('Keyboard input hides tooltip', await page.locator('#tool-tooltip').evaluate(el => el.hidden), await page.locator('html').getAttribute('data-input'));

  await page.locator('#board').focus(); await page.keyboard.press('r');
  const keyboard = await page.evaluate(() => ({
    mode: document.documentElement.dataset.input,
    selected: document.querySelector('[data-tool="rect"]').getAttribute('aria-pressed'),
    controls: [...document.querySelectorAll('button, summary')].map(el => ({ duration: getComputedStyle(el).transitionDuration, animation: getComputedStyle(el).animationName })),
  }));
  check('Keyboard tool action has no transition or animation', keyboard.mode === 'keyboard' && keyboard.selected === 'true' && keyboard.controls.every(value => value.duration.split(',').every(duration => parseFloat(duration) === 0) && value.animation === 'none'), keyboard);

  await page.locator('.file-menu summary').focus(); await page.keyboard.press('Enter');
  const keyboardMenu = await page.locator('.file-dropdown').evaluate(el => ({ duration: getComputedStyle(el).transitionDuration, animation: getComputedStyle(el).animationName, transform: getComputedStyle(el).transform }));
  check('Keyboard-opened menu stays instant', keyboardMenu.duration.split(',').every(duration => parseFloat(duration) === 0) && keyboardMenu.animation === 'none' && keyboardMenu.transform === 'none', keyboardMenu);
  await page.keyboard.press('Enter');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const button = await page.locator('[data-tool="select"]').boundingBox();
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2); await page.mouse.down();
  const reduced = await page.locator('[data-tool="select"]').evaluate(el => ({ mode: document.documentElement.dataset.input, transform: getComputedStyle(el).transform, duration: getComputedStyle(el).transitionDuration, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches }));
  await page.mouse.up();
  check('Reduced-motion pointer press has no transform or transition', reduced.mode === 'pointer' && reduced.reduced && reduced.transform === 'none' && reduced.duration.split(',').every(duration => parseFloat(duration) === 0), reduced);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 960, height: 640 }]) {
    const label = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push({ viewport: label, type: 'pageerror', error: String(error) }));
    page.on('requestfailed', request => report.errors.push({ viewport: label, type: 'requestfailed', url: request.url(), failure: request.failure() }));
    await page.goto(baseURL);
    await page.waitForFunction(() => document.querySelector('#save-status')?.textContent.includes('복구 저장됨'));
    const font = await fonts(page, context);
    check(`${label} Pretendard is loaded and inherited`, font.computed.loaded && [font.computed.root, font.computed.body].every(value => value.includes('Pretendard')) && font.computed.faces.some(face => face.family.includes('Pretendard') && face.status === 'loaded'), font.computed);
    check(`${label} CDP confirms actual Korean and Latin Pretendard glyphs`, font.rendered.every(item => item.fonts.some(font => /Pretendard/i.test(font.familyName) && font.isCustomFont && font.glyphCount > 0)), font.rendered);
    const flow = await overflow(page);
    check(`${label} has no horizontal overflow`, flow.rootScrollWidth <= viewport.width && flow.bodyScrollWidth <= viewport.width && flow.appScrollWidth <= viewport.width && flow.containers.every(item => item.left >= -.5 && item.right <= viewport.width + .5 && item.scrollWidth <= item.clientWidth + 1), flow);
    const colors = await contrast(page, ['.export-menu > summary', '#save-status', '.canvas-label', '.statusbar-hint', '.inspector-footnote', '#empty-inspector > p']);
    check(`${label} primary uses orange and ink at 4.5:1 or better`, colors[0].color === 'rgb(28, 32, 36)' && colors[0].background.every((v, i) => Math.abs(v - [247, 107, 21][i]) < 1) && colors[0].ratio >= 4.5, colors[0]);
    check(`${label} visible muted text contrast is at least 4.5:1`, colors.slice(1).every(color => color.ratio >= 4.5), colors.slice(1));
    report.viewports.push({ viewport, font, overflow: flow, contrast: colors });
    await page.mouse.move(700, 40);
    await snapshot(page, `${label}-overview`);

    if (viewport.width === 1440) await feedbackChecks(page);
    await page.locator('[data-tab="layers"]').click();
    await page.locator('#layers-list [data-node-id]').first().click();
    await page.locator('[data-tab="properties"]').click();
    await page.mouse.move(700, 40);
    await snapshot(page, `${label}-selection`);
    check(`${label} selected element has a named inspector`, await page.locator('#selection-summary').textContent().then(text => /· 1개/.test(text)), await page.locator('#selection-summary').textContent());

    await page.locator('#board').focus(); await page.keyboard.press('Control+a');
    const order = await page.evaluate(() => ({
      multi: document.querySelector('#node-inspector').classList.contains('multi-selection'),
      sections: [...document.querySelectorAll('#node-inspector > .inspector-section')].map(el => ({ name: el.querySelector('h2').textContent, top: el.getBoundingClientRect().top, order: getComputedStyle(el).order })).sort((a, b) => a.top - b.top),
    }));
    check(`${label} multi-selection promotes alignment and grouping`, order.multi && order.sections[0].name === '정렬과 간격' && order.sections[1].name === '구성과 순서', order);
    await snapshot(page, `${label}-multi-selection`);

    await page.locator('[data-tab="layers"]').click();
    await snapshot(page, `${label}-layers`);
    await page.locator('.export-menu > summary').click();
    await snapshot(page, `${label}-menu`);
    const menuBounds = await page.locator('.export-dropdown').boundingBox();
    check(`${label} export menu stays inside viewport`, menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= viewport.width + 1 && menuBounds.y + menuBounds.height <= viewport.height + 1, menuBounds);
    await page.locator('.export-menu > summary').click();
    await page.locator('#board').focus(); await page.keyboard.press('?');
    await snapshot(page, `${label}-help`);
    const help = await page.locator('#help-dialog').evaluate(el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: el.clientWidth, scrollWidth: el.scrollWidth }; });
    check(`${label} help dialog fits and scrolls vertically only`, help.left >= 0 && help.right <= viewport.width + 1 && help.top >= 0 && help.bottom <= viewport.height + 1 && help.scrollWidth <= help.width + 1, help);
    await context.close();
  }
  check('No browser runtime or failed-resource errors', report.errors.length === 0, report.errors);
} catch (error) {
  report.errors.push({ type: 'runner', error: String(error), stack: error.stack });
  check('Design check runner completed', false, String(error));
} finally {
  await browser.close();
  report.sourceAfter = await hashes();
  report.sourceChangedDuringRun = sourceFiles.filter(file => report.sourceBefore[file] !== report.sourceAfter[file]);
  report.finishedAt = new Date().toISOString();
  report.totals = { pass: report.checks.filter(item => item.status === 'pass').length, fail: report.checks.filter(item => item.status === 'fail').length };
  await writeFile(`${outputDir}/design-check.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ totals: report.totals, sourceChangedDuringRun: report.sourceChangedDuringRun, screenshots: report.screenshots, report: `${outputDir}/design-check.json` }, null, 2));
  if (report.totals.fail) process.exitCode = 1;
}
