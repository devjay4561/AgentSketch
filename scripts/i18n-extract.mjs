// Lists Korean UI strings that still need an English entry in src/locales/en.ts.
// Usage: node scripts/i18n-extract.mjs [--all]  →  JSON array on stdout
// Template slots become {0}, {1}…; HTML templates are split into the text nodes and
// attributes the DOM will actually contain, matching what src/i18n.ts translates.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const HANGUL = /[가-힣]/;
const ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'data-tooltip'];
const keys = new Set(), origins = new Map();
let current = '';
const renumber = s => { let n = 0; const map = new Map(); return s.replace(/\{(\d+)\}/g, (_m, i) => `{${map.has(i) ? map.get(i) : (map.set(i, n), n++)}}`); };
const add = s => { const v = renumber(s.replace(/\s+/g, ' ').trim()); if (HANGUL.test(v)) { keys.add(v); origins.set(v, (origins.get(v) ?? new Set()).add(current)); } };
function addMarkup(text) {
  // Multi-line plain text is also keyed per line, so English keeps the same line breaks.
  if (!/<[a-z!/]/i.test(text)) { if (text.includes('\n')) text.split('\n').forEach(add); return add(text); }
  for (const name of ATTRS) for (const m of text.matchAll(new RegExp(`${name}=["']([^"']*)["']`, 'g'))) add(m[1]);
  for (const seg of text.replace(/<!--[\s\S]*?-->/g, '').split(/<[^>]*>/)) add(seg);
}

for (const file of fs.readdirSync(path.join(root, 'src'))) {
  if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file === 'i18n.ts' || file.startsWith('locales')) continue;
  current = file;
  const src = ts.createSourceFile(file, fs.readFileSync(path.join(root, 'src', file), 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = node => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { if (HANGUL.test(node.text)) addMarkup(node.text); }
    else if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      node.templateSpans.forEach((span, i) => { text += `{${i}}` + span.literal.text; });
      if (HANGUL.test(text)) addMarkup(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}
current = 'index.html';
addMarkup(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
current = 'go';
for (const file of fs.readdirSync(root)) {
  if (!file.endsWith('.go') || file.endsWith('_test.go')) continue;
  for (const m of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
    if (!HANGUL.test(m[1])) continue;
    let i = 0;
    add(m[1].replace(/%[-+# 0]*\d*(?:\.\d+)?[vsdqwxfgt]/g, () => `{${i++}}`).replace(/\\n/g, ' '));
  }
}

const {EN, EN_CONTENT = {}} = await import(new URL('../src/locales/en.ts', import.meta.url).href);
// --content: keys used only as example-board text; they translate documents, never the live UI.
const contentOnly = k => [...origins.get(k)].every(o => o === 'sample.ts');
const out = [...keys].filter(k => process.argv.includes('--content') ? contentOnly(k) : process.argv.includes('--all') || !(k in EN || k in EN_CONTENT)).sort();
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
console.error(`${out.length} ${process.argv.includes('--all') ? 'total' : 'missing'} of ${keys.size}`);
