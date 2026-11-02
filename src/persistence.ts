import type { Asset, FlowDocument, FlowNode, Point } from './types.ts';
import { createNode, DOCUMENT_LIMITS, uid, validateDocument } from './model.ts';
import { renderPNG, renderSVG } from './renderer.ts';
import { renderViewerHTML } from './viewer-export.ts';

type NativeAPI = {
  OpenDocument(): Promise<{ path: string; data: string } | null>;
  SaveDocument(data: string, path: string, saveAs: boolean): Promise<string>;
  Autosave(data: string): Promise<void>;
  AutosaveForDocument?(data:string,path:string):Promise<void>;
  LoadAutosave(): Promise<string>;
  ExportFile(name: string, kind: string, data: string): Promise<string>;
  SaveArtifact(name: string, kind: string, data: string): Promise<string>;
};
type NativeWindow = Window & { go?: { main?: { App?: NativeAPI } } };
const native = (): NativeAPI | undefined => (window as NativeWindow).go?.main?.App;
export const isNative = !!native();

const MAX_DOCUMENT_BYTES = 80 * 1024 * 1024;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2400;
let recoveryQueue: Promise<void> = Promise.resolve();
let database: Promise<IDBDatabase> | undefined;

function filename(title: string, suffix: string): string {
  const clean = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 100);
  return `${clean || '새 보드'}.${suffix}`;
}

function stringify(doc: FlowDocument): string {
  const data = JSON.stringify(doc);
  if (data.length > MAX_DOCUMENT_BYTES || new Blob([data]).size > MAX_DOCUMENT_BYTES) {
    throw new Error('보드가 80MB를 넘습니다. 큰 이미지나 사용하지 않는 요소를 줄인 뒤 다시 저장하세요.');
  }
  return data;
}

function parse(data: string): FlowDocument {
  if (data.length > MAX_DOCUMENT_BYTES) throw new Error('80MB보다 큰 보드는 열 수 없습니다.');
  let value: unknown;
  try { value = JSON.parse(data); }
  catch { throw new Error('보드 파일을 읽을 수 없습니다. 올바른 .agentsketch 파일을 선택하세요.'); }
  return validateDocument(value);
}

function getDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('이 브라우저에서는 자동 복구를 사용할 수 없습니다. 파일로 저장하세요.'));
      return;
    }
    const request = indexedDB.open('agentsketch', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('documents')) request.result.createObjectStore('documents');
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('자동 복구 저장소를 열 수 없습니다. 파일로 저장하세요.'));
    request.onblocked = () => reject(new Error('다른 AgentSketch 탭이 복구 저장소를 사용하고 있습니다. 탭을 닫고 다시 시도하세요.'));
  });
  database.catch(() => { database = undefined; });
  return database;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function chooseFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.agentsketch,.flowpaper,.json,application/json';
    input.hidden = true;
    let complete = false;
    let focusTimer = 0;
    const finish = (file: File | null) => {
      if (complete) return;
      complete = true;
      clearTimeout(focusTimer);
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(file);
    };
    const onFocus = () => {
      focusTimer = window.setTimeout(() => finish(input.files?.[0] ?? null), 500);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    window.addEventListener('focus', onFocus);
    document.body.append(input);
    input.click();
  });
}

export async function openDocument(): Promise<{ path: string; doc: FlowDocument } | null> {
  const bridge = native();
  if (bridge) {
    const result = await bridge.OpenDocument();
    return result ? { path: result.path, doc: parse(result.data) } : null;
  }
  const file = await chooseFile();
  if (!file) return null;
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('80MB보다 큰 보드는 열 수 없습니다.');
  return { path: file.name, doc: parse(await file.text()) };
}

export async function saveDocument(doc: FlowDocument, path: string, saveAs = false): Promise<string | null> {
  const data = stringify(doc);
  const bridge = native();
  if (bridge) return (await bridge.SaveDocument(data, path, saveAs)) || null;
  const name = filename(doc.title, 'agentsketch');
  download(new Blob([data], { type: 'application/json;charset=utf-8' }), name);
  return name;
}

/** Capture each revision now, then write in call order, even after a failed write. */
export function autosave(doc: FlowDocument, path = ''): Promise<void> {
  let data: string;
  try { data = stringify(doc); }
  catch (error) { return Promise.reject(error); }
  const write = recoveryQueue.then(async () => {
    const bridge = native();
    if (bridge) { if(bridge.AutosaveForDocument)await bridge.AutosaveForDocument(data,path);else await bridge.Autosave(data); return; }
    const db = await getDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('documents', 'readwrite');
      transaction.objectStore('documents').put(data, 'recovery');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('자동 복구 저장에 실패했습니다. 저장 공간을 확인하고 파일로 저장하세요.'));
      transaction.onabort = () => reject(new Error('자동 복구 저장이 중단되었습니다. 파일로 저장하세요.'));
    });
  });
  recoveryQueue = write.catch(() => undefined);
  return write;
}

export async function loadAutosave(): Promise<FlowDocument | null> {
  await recoveryQueue;
  const bridge = native();
  if (bridge) {
    const data = await bridge.LoadAutosave();
    return data ? parse(data) : null;
  }
  const db = await getDatabase();
  const data = await new Promise<unknown>((resolve, reject) => {
    const transaction = db.transaction('documents', 'readonly');
    const request = transaction.objectStore('documents').get('recovery');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('자동 복구 파일을 읽을 수 없습니다. 저장한 파일을 열어주세요.'));
  });
  return typeof data === 'string' && data ? parse(data) : null;
}

function decodeDataURL(data: string): Uint8Array {
  const content = data.slice(data.indexOf(',') + 1);
  const binary = atob(content);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) result[index] = binary.charCodeAt(index);
  return result;
}

async function imageFromURL(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try { await image.decode(); }
  catch { throw new Error('이미지를 읽을 수 없습니다. PNG 또는 JPG 파일로 다시 시도하세요.'); }
  return image;
}

/** One image per page; no print dialog, server, font, or PDF library is required. */
async function makePDF(png: string): Promise<Blob> {
  const image = await imageFromURL(png);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PDF 이미지를 준비할 수 없습니다.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  const width = canvas.width;
  const height = canvas.height;
  const jpeg = decodeDataURL(canvas.toDataURL('image/jpeg', 0.92));
  canvas.width = canvas.height = 1;
  image.src = '';
  const landscape = width >= height;
  const pageWidth = landscape ? 842 : 595;
  const pageHeight = landscape ? 595 : 842;
  const fit = Math.min((pageWidth - 48) / width, (pageHeight - 48) / height);
  const drawWidth = width * fit;
  const drawHeight = height * fit;
  const x = (pageWidth - drawWidth) / 2;
  const y = (pageHeight - drawHeight) / 2;
  const stream = `q\n${drawWidth.toFixed(3)} 0 0 ${drawHeight.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm\n/Im0 Do\nQ\n`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets = [0];
  let byteCount = 0;
  const append = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    byteCount += bytes.byteLength;
  };
  const object = (id: number, body: string) => {
    offsets[id] = byteCount;
    append(`${id} 0 obj\n${body}\nendobj\n`);
  };
  append('%PDF-1.4\n%AgentSketch\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = byteCount;
  append(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  append(jpeg);
  append('\nendstream\nendobj\n');
  object(5, `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}endstream`);
  const crossReference = byteCount;
  append('xref\n0 6\n0000000000 65535 f \n');
  for (let index = 1; index <= 5; index++) append(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
  append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${crossReference}\n%%EOF\n`);
  const bytes = new Uint8Array(byteCount);
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
  return new Blob([bytes.buffer], { type: 'application/pdf' });
}

export async function exportFile(doc: FlowDocument, kind: 'png' | 'svg' | 'pdf' | 'html'): Promise<string | null> {
  const name = filename(doc.title, kind);
  if (kind === 'html') {
    const html = renderViewerHTML(doc), bridge = native();
    if (bridge) return (await bridge.SaveArtifact(name, 'html-viewer', html)) || null;
    download(new Blob([html], { type: 'text/html;charset=utf-8' }), name);
    return name;
  }
  const data = kind === 'svg' ? renderSVG(doc) : await renderPNG(doc, 2);
  const bridge = native();
  if (bridge) return (await bridge.ExportFile(name, kind, data)) || null;
  if (kind === 'svg') download(new Blob([data], { type: 'image/svg+xml;charset=utf-8' }), name);
  else if (kind === 'pdf') download(await makePDF(data), name);
  else download(new Blob([decodeDataURL(data).buffer as ArrayBuffer], { type: 'image/png' }), name);
  return name;
}

type RasterHeader = { mime: string; width: number; height: number };

function rasterHeader(bytes: Uint8Array): RasterHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, count: number) => String.fromCharCode(...bytes.subarray(offset, offset + count));
  if (bytes.length >= 24 && bytes[0] === 137 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') {
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 10 && /^GIF8[79]a$/.test(ascii(0, 6))) {
    return { mime: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') {
      const uint24 = (offset: number) => bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
      return { mime: 'image/webp', width: uint24(24) + 1, height: uint24(27) + 1 };
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { mime: 'image/webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const dimensions = view.getUint32(21, true);
      return { mime: 'image/webp', width: (dimensions & 0x3fff) + 1, height: ((dimensions >>> 14) & 0x3fff) + 1 };
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        return { mime: 'image/jpeg', width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += length;
    }
  }
  throw new Error('PNG, JPG, WebP, GIF 이미지만 추가할 수 있습니다. PPT 화면은 그림으로 복사해 붙여넣으세요.');
}

export async function importImages(files: File[], at: Point): Promise<{ nodes: FlowNode[]; assets: Record<string, Asset> }> {
  if (files.length > 20) throw new Error('이미지는 한 번에 20개까지 추가할 수 있습니다.');
  const nodes: FlowNode[] = [];
  const assets: Record<string, Asset> = {};
  for (const [index, file] of files.entries()) {
    if (file.size > MAX_SOURCE_BYTES) throw new Error(`“${file.name}”이 25MB를 넘습니다. 이미지를 줄여서 다시 추가하세요.`);
    const header = rasterHeader(new Uint8Array(await file.arrayBuffer()));
    if (!header.width || !header.height || header.width * header.height > MAX_IMAGE_PIXELS || header.width > 65535 || header.height > 65535) {
      throw new Error(`“${file.name}”의 이미지 크기가 너무 큽니다. 6,400만 화소 이하로 줄여주세요.`);
    }
    const blob = new Blob([file], { type: header.mime });
    const objectURL = URL.createObjectURL(blob);
    let image: HTMLImageElement | undefined;
    try {
      image = await imageFromURL(objectURL);
      const ratio = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      let width = Math.max(1, Math.round(image.naturalWidth * ratio));
      let height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('이미지를 준비할 수 없습니다. 앱을 다시 열어주세요.');
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, width, height);
      let data = header.mime === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.88) : canvas.toDataURL('image/png');
      while (data.length > DOCUMENT_LIMITS.assetData && width > 64 && height > 64) {
        width = Math.max(1, Math.floor(width * 0.75));
        height = Math.max(1, Math.floor(height * 0.75));
        canvas.width = width;
        canvas.height = height;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, width, height);
        data = header.mime === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.88) : canvas.toDataURL('image/png');
      }
      if (data.length > DOCUMENT_LIMITS.assetData) throw new Error(`“${file.name}”을 줄일 수 없습니다. 더 작은 이미지로 다시 시도하세요.`);
      canvas.width = canvas.height = 1;
      const assetId = uid();
      const asset: Asset = { id: assetId, data, name: file.name || '붙여넣은 이미지', width, height };
      assets[assetId] = asset;
      const node = createNode('image', at.x + index * 28, at.y + index * 28);
      const displayRatio = Math.min(1, 520 / width, 640 / height);
      node.w = Math.max(1, width * displayRatio);
      node.h = Math.max(1, height * displayRatio);
      node.assetId = assetId;
      node.text = '';
      node.fill = '#ffffff';
      node.stroke = 'transparent';
      nodes.push(node);
    } finally {
      if (image) image.src = '';
      URL.revokeObjectURL(objectURL);
    }
  }
  return { nodes, assets };
}
