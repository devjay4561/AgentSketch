import type { Box, Point } from './types.ts';

export interface PdfPrintOptions {
  paper?: 'a4' | 'a3';
  landscape?: boolean;
  marginMm?: number;
  printMode?: 'fit' | 'tile';
  printScalePercent?: number;
}
export interface PdfPagePlan {
  size: [number, number];
  /** PDF points, shared by every edge of the page. */
  margin: number;
  /** Reserved heading strip, directly above the clipping rectangle. */
  header: number;
  /** PDF points per world unit. */
  scale: number;
  /** World coordinate at the top-left of this page's clipping rectangle. */
  origin: Point;
  /** Printable PDF rectangle in bottom-left coordinates, excluding the heading. */
  clip: Box;
  /** Zero-based row/column, in top-to-bottom / left-to-right reading order. */
  row: number;
  column: number;
  rows: number;
  columns: number;
}

export const MAX_PDF_PAGES = 100;
const POINTS_PER_MM = 72 / 25.4;

function boundedOption(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} 값이 올바르지 않습니다.`);
  return Math.max(min, Math.min(max, value));
}

/**
 * Fit produces one full-diagram page. Tile retains the chosen scale and splits
 * the world rectangle without gaps. At 100%, 96 world pixels equal one inch.
 * Draw a world point p at:
 *   x = clip.x + (p.x - origin.x) * scale
 *   y = clip.y + clip.h - (p.y - origin.y) * scale
 * Clip every page before painting so neighboring tiles cannot overlap margins.
 */
export function planPages(box: Box, options: PdfPrintOptions = {}): PdfPagePlan[] {
  if (![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w <= 0 || box.h <= 0) {
    throw new Error('인쇄할 영역의 위치와 크기가 올바르지 않습니다.');
  }
  if (options.paper !== undefined && options.paper !== 'a4' && options.paper !== 'a3') throw new Error('지원하지 않는 용지 크기입니다.');
  if (options.landscape !== undefined && typeof options.landscape !== 'boolean') throw new Error('용지 방향이 올바르지 않습니다.');
  if (options.printMode !== undefined && options.printMode !== 'fit' && options.printMode !== 'tile') throw new Error('지원하지 않는 인쇄 방식입니다.');
  const margin = boundedOption(options.marginMm, 10, 5, 40, '여백') * POINTS_PER_MM;
  const percent = boundedOption(options.printScalePercent, 100, 25, 200, '인쇄 배율');
  const a3 = options.paper === 'a3';
  const size: [number, number] = options.landscape === false ? (a3 ? [842, 1191] : [595, 842]) : (a3 ? [1191, 842] : [842, 595]);
  const header = 22;
  const clip = { x: margin, y: margin, w: size[0] - margin * 2, h: size[1] - margin * 2 - header };
  const tiled = options.printMode === 'tile';
  const scale = tiled ? .75 * percent / 100 : Math.min(clip.w / box.w, clip.h / box.h);
  // The small tolerance avoids an extra blank column at an exact page boundary.
  const columns = tiled ? Math.max(1, Math.ceil(box.w * scale / clip.w - 1e-10)) : 1;
  const rows = tiled ? Math.max(1, Math.ceil(box.h * scale / clip.h - 1e-10)) : 1;
  if (!Number.isFinite(rows * columns) || rows * columns > MAX_PDF_PAGES) {
    throw new Error(`PDF가 ${MAX_PDF_PAGES}페이지를 넘습니다. 인쇄 배율을 낮추거나 선택 영역을 줄이세요.`);
  }
  const result: PdfPagePlan[] = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    result.push({size: [...size], margin, header, scale,
      origin: { x: box.x + column * clip.w / scale, y: box.y + row * clip.h / scale },
      clip: {...clip}, row, column, rows, columns});
  }
  return result;
}

/** Same bounded calculation as export; suitable for a settings preview. */
export function countPages(box: Box, options: PdfPrintOptions = {}): number {
  return planPages(box, options).length;
}
