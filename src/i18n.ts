// UI language. Korean source text is the key; English comes from locales/en.ts.
// Keys may hold numbered slots ({0}, {1}) for text that embeds values.
// Outside a browser (CLI, MCP, unit tests) the language is always Korean.
import {EN, EN_CONTENT} from './locales/en.ts';

export type Lang = 'ko' | 'en';
const STORE = 'agentsketch.lang';
const HANGUL = /[가-힣]/;
const ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'data-tooltip'];

function detect(): Lang {
  try { const q = new URLSearchParams(location.search).get('lang'); if (q === 'ko' || q === 'en') return q; } catch { /* no location */ }
  try { const s = localStorage.getItem(STORE); if (s === 'ko' || s === 'en') return s; } catch { /* storage blocked */ }
  return (navigator.language || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en';
}
export const lang: Lang = typeof window === 'undefined' || typeof document === 'undefined' ? 'ko' : detect();
export function setLang(next: Lang) { localStorage.setItem(STORE, next); }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const fill = (s: string, vars: readonly unknown[]) => s.replace(/\{(\d+)\}/g, (m, i) => i < vars.length ? String(vars[+i]) : m);
const isMacOS = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const formatShortcutLabel = (text: string) => isMacOS ? text.replace(/\bCtrl\b/g, '⌘') : text;
const patterns: {re: RegExp; en: string}[] = [];
for (const [ko, en] of Object.entries(EN)) {
  if (!/\{\d+\}/.test(ko)) continue;
  const order: number[] = [];
  const src = ko.split(/(\{\d+\})/).map(part => {
    const m = part.match(/^\{(\d+)\}$/);
    if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    order.push(+m[1]);
    return '([\\s\\S]*?)';
  }).join('');
  patterns.push({re: new RegExp('^' + src + '$'), en: en.replace(/\{(\d+)\}/g, (_m, i) => `{@${order.indexOf(+i)}}`)});
}
// Longer fixed text first, so "{0}개 요소 · {1}개 연결" wins over "{0}개".
patterns.sort((a, b) => b.re.source.replace(/\(\[\\s\\S\]\*\?\)/g, '').length - a.re.source.replace(/\(\[\\s\\S\]\*\?\)/g, '').length);

/** Translate a Korean source string. `t('경로 없음 {0}개', n)` */
export function t(ko: string, ...vars: unknown[]): string {
  if (lang !== 'en') return fill(formatShortcutLabel(ko), vars);
  // Keep authored line breaks when every line has its own entry.
  const lines = ko.split('\n');
  const en = (k: string) => EN_CONTENT[norm(k)] ?? EN[norm(k)];
  if (lines.length > 1 && lines.every(l => !l.trim() || en(l) !== undefined)) return fill(formatShortcutLabel(lines.map(l => l.trim() ? en(l) : l).join('\n')), vars);
  return fill(formatShortcutLabel(en(ko) ?? ko), vars);
}

/** English for whole Korean text produced elsewhere (DOM, Go errors). Undefined when unknown. */
export function translateText(text: string, depth = 0): string | undefined {
  const ko = norm(text), exact = EN[ko];
  if (exact !== undefined) return formatShortcutLabel(exact);
  if (depth > 2) return undefined;
  for (const p of patterns) {
    const m = ko.match(p.re);
    // Slots often carry another known message (a Go error after "열 수 없습니다: "), so translate those too.
    if (m) return formatShortcutLabel(p.en).replace(/\{@(\d+)\}/g, (_s, i) => { const part = m[+i + 1] ?? ''; return HANGUL.test(part) ? translateText(part, depth + 1) ?? part : part; });
  }
  return undefined;
}

function translateNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue ?? '';
    if (!HANGUL.test(text) || node.parentElement?.closest('[data-no-i18n],textarea,[contenteditable="true"]')) return;
    const en = translateText(text);
    if (en !== undefined) node.nodeValue = text.replace(text.trim(), en);
    return;
  }
  if (!(node instanceof Element) || node.closest('[data-no-i18n]')) return;
  for (const name of ATTRS) {
    const v = node.getAttribute(name);
    if (v && HANGUL.test(v)) { const en = translateText(v); if (en !== undefined) node.setAttribute(name, en); }
  }
  if (node instanceof HTMLInputElement && (node.type === 'button' || node.type === 'submit') && HANGUL.test(node.value)) {
    const en = translateText(node.value); if (en !== undefined) node.value = en;
  }
  if (node instanceof HTMLOptionElement && HANGUL.test(node.label)) { const en = translateText(node.label); if (en !== undefined) node.label = en; }
  for (const child of node.childNodes) translateNode(child);
}

/** In English, translate the static page and everything the app renders later. */
export function installDomTranslation() {
  if (isMacOS) {
    for (const element of document.querySelectorAll<HTMLElement>('[title],[aria-label],kbd')) {
      if (element.closest('[data-no-i18n],textarea,[contenteditable="true"]')) continue;
      if (element instanceof HTMLElement && element.tagName === 'KBD') element.textContent = formatShortcutLabel(element.textContent ?? '');
      for (const name of ['title', 'aria-label']) {
        const value = element.getAttribute(name);
        if (value) element.setAttribute(name, formatShortcutLabel(value));
      }
    }
  }
  if (lang !== 'en') return;
  document.documentElement.lang = 'en';
  document.title = translateText(document.title) ?? document.title;
  translateNode(document.body);
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(translateNode);
      else translateNode(r.target);
    }
  }).observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS});
}

/** Localize a generated standalone HTML file (reports, viewers) the same way as the live page. */
export function localizeHtml(html: string): string {
  if (lang !== 'en' || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.documentElement.lang = 'en';
  doc.title = translateText(doc.title) ?? doc.title;
  translateNode(doc.body);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}
