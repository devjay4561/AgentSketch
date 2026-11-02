import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {t, translateText} from './i18n.ts';
import {EN, EN_CONTENT} from './locales/en.ts';

test('outside a browser the UI language stays Korean', () => {
  assert.equal(t('새 단계'), '새 단계');
  assert.equal(t('“{0}”의 미저장 변경을 닫고 탭 복구 사본을 삭제할까요?', '보고서'), '“보고서”의 미저장 변경을 닫고 탭 복구 사본을 삭제할까요?');
});

test('English text fills slots, and nested Korean messages are translated too', () => {
  assert.equal(translateText('새 단계'), EN['새 단계']);
  assert.equal(translateText('  새\n단계 '), EN['새 단계']);
  const counted = Object.keys(EN).find(k => /^\{0\}개 요소 · \{1\}개 연결$/.test(k));
  if (counted) assert.equal(translateText('16개 요소 · 9개 연결'), EN[counted].replace('{0}', '16').replace('{1}', '9'));
  const wrapped = Object.keys(EN).find(k => k.endsWith(': {0}') && /[가-힣]/.test(k));
  if (wrapped) assert.ok(!/[가-힣]/.test(translateText(wrapped.replace('{0}', '새 단계'))!));
  assert.equal(translateText('사용자가 직접 쓴 임의의 문장'), undefined);
});

test('every English entry keeps the same value slots as its Korean key', () => {
  const slots = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();
  for (const [ko, en] of Object.entries({...EN, ...EN_CONTENT})) assert.equal(slots(en), slots(ko), ko);
});

test('every Korean UI string has an English entry', () => {
  const missing = JSON.parse(execFileSync(process.execPath, ['scripts/i18n-extract.mjs'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}));
  assert.deepEqual(missing, [], 'run: node scripts/i18n-extract.mjs, then add the strings to src/locales/en.ts');
});
