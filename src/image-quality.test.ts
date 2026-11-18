import assert from 'node:assert/strict';
import test from 'node:test';
import { DOCUMENT_LIMITS } from './model.ts';
import { quantizeImageSide } from './renderer.ts';

Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
const { imageWorldSize, canPreserveImage } = await import('./persistence.ts');
Reflect.deleteProperty(globalThis, 'window');

test('image placement preserves physical size or fits both viewport bounds', () => {
  assert.deepEqual(imageWorldSize(1920, 1080, 1), { w: 1920, h: 1080 });
  assert.deepEqual(imageWorldSize(1920, 1080, 1.5), { w: 1280, h: 720 });
  assert.deepEqual(imageWorldSize(1920, 1080, 2), { w: 960, h: 540 });
  assert.deepEqual(imageWorldSize(1920, 1080, 1.5, { w: 850, h: 850 }), { w: 850, h: 478.125 });
  assert.deepEqual(imageWorldSize(1080, 1920, 1.5, { w: 850, h: 850 }), { w: 478.125, h: 850 });
  assert.deepEqual(imageWorldSize(1, 1, 2), { w: 1, h: 1 });
});

test('raw image preservation accounts for the exact encoded byte limit and longest side', () => {
  for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
    const maxBytes = Math.floor((DOCUMENT_LIMITS.assetData - `data:${mime};base64,`.length) / 4) * 3;
    assert.equal(canPreserveImage(3840, 2160, maxBytes, mime), true);
    assert.equal(canPreserveImage(3841, 2160, maxBytes, mime), false);
    assert.equal(canPreserveImage(2160, 3841, maxBytes, mime), false);
    assert.equal(canPreserveImage(3840, 2160, maxBytes + 1, mime), false);
  }
});

test('decode requests round up to a stable step and retain the native or budget limit', () => {
  assert.equal(quantizeImageSide(20, 1920), 32);
  assert.equal(quantizeImageSide(50, 1920), 50);
  assert.equal(quantizeImageSide(51, 1920), 63);
  assert.equal(quantizeImageSide(62, 1920), 63);
  assert.equal(quantizeImageSide(1900, 1920), 1920);
  assert.equal(quantizeImageSide(5000, 2048), 2048);
  assert.equal(quantizeImageSide(20, 9), 9);
});
