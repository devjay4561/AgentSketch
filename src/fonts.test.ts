import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { createNode, emptyDocument, validateDocument } from './model.ts';
import { createVectorPDF, createPowerPoint } from './export-binary.ts';
import { BOARD_FONT_IDS, BOARD_FONTS, boardFontId, pdfFontUrls } from './fonts.ts';
import { renderSVG } from './renderer.ts';
import { runCommandInPlace } from './commands.ts';

function board(font?: string) {
  const doc = emptyDocument(); const n = createNode('round', 0, 0);
  Object.assign(n, { text: '③ 자재 입고\n다음날 10시 · 창고 입고일 ①※', bold: true });
  doc.nodes.push(n);
  return validateDocument(JSON.parse(JSON.stringify({ ...doc, ...(font ? { font } : {}) })));
}

test('board font is part of the file format; Pretendard is the absent default', () => {
  assert.equal(board('suit').font, 'suit');
  assert.equal(board('pretendard').font, undefined);
  assert.equal(boardFontId(board()), 'pretendard');
  assert.throws(() => board('comic-sans'));
  const doc = board(); runCommandInPlace(doc, { command: 'document.font', args: { font: 'maru-buri' } });
  assert.equal(doc.font, 'maru-buri');
  assert.match(renderSVG(doc), /AgentSketch MaruBuri/);
});

test('every bundled board font embeds Korean and bold text in vector PDF', async () => {
  for (const id of BOARD_FONT_IDS) {
    const doc = board(id === 'pretendard' ? undefined : id), [regular, bold] = pdfFontUrls(doc);
    const out = await createVectorPDF(doc, new Uint8Array(await readFile('public' + regular)), { boldFontBytes: new Uint8Array(await readFile('public' + bold)) });
    const pdf = await PDFDocument.load(out.bytes);
    assert.equal(pdf.getPageCount(), 1, id);
  }
});

test('PowerPoint export names the board font', async () => {
  const out = await createPowerPoint(board('ibm-plex-kr'));
  assert.ok(out.warnings.some(w => w.includes(BOARD_FONTS['ibm-plex-kr'].office)));
});
