import { FONT_FAMILY, setBoardFontFamily } from './theme.ts';
import type { FlowDocument } from './types.ts';

/**
 * Board fonts bundled with the app (SIL OFL, see public/fonts/README.txt). The same
 * TTF files draw the canvas and are embedded in vector PDF export, so every PC shows
 * and exports the same letters. Pretendard stays the UI font and the fallback.
 */
export const BOARD_FONTS = {
  pretendard: { label: 'Pretendard', face: '', files: ['AgentSketchExport-Regular.ttf', 'AgentSketchExport-Semibold.ttf'], office: 'Pretendard' },
  suit: { label: 'SUIT', face: 'AgentSketch SUIT', files: ['SUIT-Regular.ttf', 'SUIT-SemiBold.ttf'], office: 'SUIT' },
  'nanum-square-neo': { label: '나눔스퀘어 네오', face: 'AgentSketch NanumSquare Neo', files: ['NanumSquareNeo-bRg.ttf', 'NanumSquareNeo-cBd.ttf'], office: 'NanumSquare Neo' },
  'ibm-plex-kr': { label: 'IBM Plex Sans KR', face: 'AgentSketch IBM Plex Sans KR', files: ['IBMPlexSansKR-Regular.ttf', 'IBMPlexSansKR-SemiBold.ttf'], office: 'IBM Plex Sans KR' },
  'maru-buri': { label: '마루 부리', face: 'AgentSketch MaruBuri', files: ['MaruBuri-Regular.ttf', 'MaruBuri-SemiBold.ttf'], office: 'MaruBuri' },
} as const;
export type BoardFontId = keyof typeof BOARD_FONTS;
export const BOARD_FONT_IDS = Object.keys(BOARD_FONTS) as BoardFontId[];

export function boardFontId(doc: Pick<FlowDocument, 'font'>): BoardFontId {
  return doc.font && doc.font in BOARD_FONTS ? doc.font : 'pretendard';
}
export function boardFontFamily(id: BoardFontId): string {
  const face = BOARD_FONTS[id].face;
  return face ? `"${face}", ${FONT_FAMILY}` : FONT_FAMILY;
}
/** Regular and semibold TTF URLs for vector PDF export. */
export function pdfFontUrls(doc: Pick<FlowDocument, 'font'>): [string, string] {
  const [regular, bold] = BOARD_FONTS[boardFontId(doc)].files;
  return [`/fonts/${regular}`, `/fonts/${bold}`];
}

const loads = new Map<BoardFontId, Promise<void>>();
/** Loads a board font once; resolves immediately outside a browser or for Pretendard. */
export function loadBoardFont(id: BoardFontId): Promise<void> {
  const font = BOARD_FONTS[id];
  if (!font.face || typeof FontFace === 'undefined' || typeof document === 'undefined') return Promise.resolve();
  let load = loads.get(id);
  if (!load) {
    // Static faces cover weight ranges so 400/500 use Regular and 600+ the bold file without synthesis.
    const faces = [new FontFace(font.face, `url(/fonts/${font.files[0]})`, { weight: '100 549' }), new FontFace(font.face, `url(/fonts/${font.files[1]})`, { weight: '550 900' })];
    load = Promise.all(faces.map(face => face.load().then(loaded => { document.fonts.add(loaded); }))).then(() => {});
    load.catch(() => loads.delete(id));
    loads.set(id, load);
  }
  return load;
}
/** Points canvas text at the document's font; calls back once a not-yet-loaded font is ready. */
export function useBoardFont(doc: Pick<FlowDocument, 'font'>, ready?: () => void): void {
  const id = boardFontId(doc);
  setBoardFontFamily(boardFontFamily(id));
  if (BOARD_FONTS[id].face && ready) void loadBoardFont(id).then(ready, () => {});
}
