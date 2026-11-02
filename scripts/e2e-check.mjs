import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

await mkdir('output/playwright', { recursive: true });
const check = (0, eval)(`(${await readFile('scripts/ui-check.cjs', 'utf8')})`);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-features=AutofillAiWalletPrivatePasses'] });
try {
  const page = await browser.newPage({locale:'ko-KR',viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(process.env.AGENTSKETCH_TEST_URL || 'http://127.0.0.1:18440');
  const result = await check(page);
  await writeFile('output/ui-tests.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
