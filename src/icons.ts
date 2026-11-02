/** Small, consistent SVG icons. No font or runtime icon dependency. */
const paths: Record<string, string> = {
  file: '<path d="M14 3H5v18h14V8Z"/><path d="M14 3v5h5M8 12h8m-8 4h5"/>',
  select: '<path d="m5 3 14 10-7 1-3 7Z"/>',
  hand: '<path d="M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v8c0 5-3 8-7 8h-1c-2 0-3-1-4-3l-4-6a2 2 0 0 1 3-2l2 2"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
  round: '<rect x="4" y="5" width="16" height="14" rx="5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  diamond: '<path d="m12 3 9 9-9 9-9-9Z"/>',
  text: '<path d="M4 5h16M12 5v15M8 20h8M4 5v3m16-3v3"/>',
  note: '<path d="M4 4h16v11l-5 5H4Z"/><path d="M15 20v-5h5M8 9h8M8 12h5"/>',
  connect: '<path d="M5 5h6v14h8m-4-4 4 4-4 4"/><circle cx="5" cy="5" r="2"/>',
  draw: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15Z"/>',
  frame: '<path d="M3 8V3h5m8 0h5v5m0 8v5h-5m-8 0H3v-5M8 8h8v8H8Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="2"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  undo: '<path d="M3 10h11a6 6 0 0 1 0 12M7 6l-4 4 4 4" transform="translate(0 -3)"/>',
  redo: '<path d="M21 10H10a6 6 0 0 0 0 12m7-16 4 4-4 4" transform="translate(0 -3)"/>',
  'auto-layout': '<rect x="3" y="3" width="6" height="5" rx="1"/><rect x="15" y="3" width="6" height="5" rx="1"/><rect x="9" y="16" width="6" height="5" rx="1"/><path d="M6 8v4h12V8m-6 4v4"/>',
  export: '<path d="M12 16V3m-4 4 4-4 4 4M4 14v6h16v-6"/>',
  new: '<path d="M14 3H5v18h14V8Z"/><path d="M14 3v5h5m-7 3v6m-3-3h6"/>',
  open: '<path d="M3 8V5h7l2 3h9v12H3Z"/><path d="M3 11h18"/>',
  save: '<path d="M4 3h13l4 4v14H3V3Zm3 0v6h10V3M7 21v-8h10v8"/>',
  'save-as': '<path d="M11 21H3V3h14l4 4v4M7 3v6h10V3M7 21v-8h5m3 7 5-5 2 2-5 5h-2Z"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 1-2 3m0 3h.01"/>',
  fit: '<path d="M3 8V3h5m8 0h5v5m0 8v5h-5m-8 0H3v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  grid: '<path d="M8 3v18m8-18v18M3 8h18M3 16h18"/>',
  snap: '<path d="M5 5v8a7 7 0 0 0 14 0V5h-5v8a2 2 0 0 1-4 0V5ZM5 9h5m4 0h5"/>',
  group: '<path d="M5 3H3v2m0 4v6m0 4v2h2m4 0h6m4 0h2v-2m0-4V9m0-4V3h-2m-4 0H9"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
  ungroup: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="m14 8 5-5m-3 0h3v3M5 16l-2 3m0-3v3h3"/>',
  front: '<rect x="8" y="3" width="13" height="13" rx="1"/><path d="M16 19v2H3V8h2"/>',
  back: '<rect x="3" y="8" width="13" height="13" rx="1"/><path d="M8 5V3h13v13h-2"/>',
  duplicate: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 5V3H3v13h2"/>',
  delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-3m-3 11v2"/>',
  'align-left': '<path d="M3 3v18M7 5h13v5H7Zm0 9h8v5H7Z"/>',
  'align-center': '<path d="M12 2v20M4 5h16v5H4Zm3 9h10v5H7Z"/>',
  'align-right': '<path d="M21 3v18M4 5h13v5H4Zm5 9h8v5H9Z"/>',
  'align-top': '<path d="M3 3h18M5 7h5v13H5Zm9 0h5v8h-5Z"/>',
  'align-middle': '<path d="M2 12h20M5 4h5v16H5Zm9 3h5v10h-5Z"/>',
  'align-bottom': '<path d="M3 21h18M5 4h5v13H5Zm9 5h5v8h-5Z"/>',
  'distribute-horizontal': '<path d="M3 3v18m18-18v18M8 6h8v12H8Z"/>',
  'distribute-vertical': '<path d="M3 3h18M3 21h18M6 8h12v8H6Z"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  properties: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="8" cy="18" r="2" fill="currentColor"/>',
  focus: '<path d="M8 3H3v5m13-5h5v5m0 8v5h-5M3 16v5h5M8 8l-5-5m13 5 5-5M8 16l-5 5m13-5 5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M4 12h16m-5-5 5 5-5 5"/>',
  evidence: '<path d="M9 4H5v17h14V4h-4"/><rect x="9" y="2.5" width="6" height="4" rx="1"/><path d="m8.5 13.5 2.5 2.5 4.5-5"/>',
  attach: '<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
  scan: '<path d="M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4M8 9h8m-8 3h8m-8 3h5"/>',
  review: '<path d="M4 4h16v12H9l-5 4Z"/><path d="M8 9h8m-8 3h5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0m1-15.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3 6"/>',
  pages: '<rect x="7" y="3" width="13" height="15" rx="1.5"/><path d="M4 7v13a1 1 0 0 0 1 1h11"/>',
};

export function icon(name: string, size = 20): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.rect}</svg>`;
}

export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach(el => {
    el.innerHTML = icon(el.dataset.icon || 'rect', Number(el.dataset.size) || 20);
  });
}

hydrateIcons();
