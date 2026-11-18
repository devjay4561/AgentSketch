/** Shared canvas/editor typography and application chrome, not document migration. */
export const FONT_FAMILY = '"Pretendard Variable", Pretendard, "Segoe UI", "Malgun Gothic", sans-serif';

// Canvas and export text use the current board's font (src/fonts.ts sets it before drawing).
let boardFamily = FONT_FAMILY;
export function boardFont(): string { return boardFamily; }
export function setBoardFontFamily(family: string): void { boardFamily = family; }

export const PALETTE = {
  accent: '#F76B15',
  accentText: '#C2410C',
  accentSoft: '#FFE7D6',
  paper: '#F6F7F9',
  ink: '#1C2024',
  muted: '#606B78',
  border: '#CBD2DA',
  line: '#627289',
  frame: '#EFF2F6',
  note: '#FFF3EB',
  noteBorder: '#F5A36A',
} as const;
