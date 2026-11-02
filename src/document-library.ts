import './document-library.css';
import type { FlowDocument } from './types.ts';
import type { WorkbenchHost } from './workspace-types.ts';
import { validateDocument } from './model.ts';

interface RecentDocument { path: string; title: string; openedAt: string }
interface DocumentVersion { id: string; path: string; title: string; createdAt: string; size: number }
interface NativeLibrary {
  ListRecentDocuments(): Promise<RecentDocument[]>;
  OpenRecentDocument(path: string): Promise<{ path: string; data: string }>;
  ListDocumentVersions(path: string): Promise<DocumentVersion[]>;
  ReadDocumentVersion(id: string): Promise<{ path: string; data: string }>;
  SaveSnapshot(data: string): Promise<DocumentVersion>;
}
const bridge = () => (window as Window & { go?: { main?: { App?: NativeLibrary } } }).go?.main?.App;
const MAX_BYTES = 80 * 1024 * 1024;
const MAX_SNAPSHOTS = 10;
let browserDatabase: Promise<IDBDatabase> | undefined;
let snapshotQueue: Promise<unknown> = Promise.resolve();

function database(): Promise<IDBDatabase> {
  if (browserDatabase) return browserDatabase;
  browserDatabase = new Promise((resolve, reject) => {
    const request = indexedDB.open('agentsketch-library', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('metadata', { keyPath: 'id' });
      request.result.createObjectStore('documents');
    };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); browserDatabase = undefined; }; resolve(db); };
    request.onerror = () => reject(new Error('문서 보관함을 열지 못했습니다. 파일로 저장하세요.'));
  });
  browserDatabase.catch(() => { browserDatabase = undefined; });
  return browserDatabase;
}
async function browserVersions(): Promise<DocumentVersion[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('metadata').objectStore('metadata').getAll();
    request.onsuccess = () => resolve((request.result as DocumentVersion[]).sort((a,b) => b.createdAt.localeCompare(a.createdAt)));
    request.onerror = () => reject(new Error('복구 사본 목록을 읽지 못했습니다.'));
  });
}
async function browserRead(id: string): Promise<string> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents').objectStore('documents').get(id);
    request.onsuccess = () => typeof request.result === 'string' ? resolve(request.result) : reject(new Error('복구 사본을 찾을 수 없습니다. 목록을 새로고침하세요.'));
    request.onerror = () => reject(new Error('복구 사본을 읽지 못했습니다.'));
  });
}
function browserSave(data: string, title: string): Promise<DocumentVersion> {
  const operation = snapshotQueue.then(async () => {
    const size = new Blob([data]).size;
    if (size > MAX_BYTES) throw new Error('복구 사본은 80MB 이하여야 합니다. 큰 이미지를 줄이거나 파일로 저장하세요.');
    const item: DocumentVersion = { id: crypto.randomUUID(), path: '', title: title || '이름 없는 보드', createdAt: new Date().toISOString(), size };
    const existing = await browserVersions();
    let total = size, kept = 1;
    const remove: string[] = [];
    for (const version of existing) {
      if (kept >= MAX_SNAPSHOTS || total + version.size > MAX_BYTES) remove.push(version.id);
      else { total += version.size; kept++; }
    }
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['metadata', 'documents'], 'readwrite');
      const metadata = transaction.objectStore('metadata'), documents = transaction.objectStore('documents');
      metadata.put(item); documents.put(data, item.id);
      for (const id of remove) { metadata.delete(id); documents.delete(id); }
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error('복구 사본을 저장하지 못했습니다. 저장 공간을 확인하세요.'));
    });
    return item;
  });
  snapshotQueue = operation.catch(() => undefined);
  return operation;
}
const dateText = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}); };
const sizeText = (size: number) => size < 1024 * 1024 ? `${Math.max(1,Math.round(size / 1024))}KB` : `${(size / 1024 / 1024).toFixed(1)}MB`;

/** Metadata stays in the panel; full documents are loaded only for an explicit open. */
export function mountDocumentLibrary(host: WorkbenchHost, container: HTMLElement): { update(): void } {
  container.classList.add('document-library');
  const section = document.createElement('section'); section.className = 'library-section';
  section.innerHTML = `<div class="library-heading"><h3>문서 보관함</h3><button type="button" class="library-refresh" aria-label="문서 목록 새로고침">새로고침</button></div>
    
    <button type="button" class="library-snapshot">현재 작업 보관</button>
    <p class="library-message" role="status" aria-live="polite"></p>
    <div class="library-recent-section"><h4>최근 파일</h4><div class="library-recent"></div></div>
    <div class="library-version-heading"><h4>복구 사본</h4><button type="button" class="library-all" hidden>전체 사본</button></div>
    <p class="library-version-source" hidden></p><div class="library-versions"></div>
    <p class="library-footnote">이전 사본은 새 문서로 엽니다. 현재 작업은 전환 전에 보관합니다. 복구 사본은 순환 보관되므로 중요한 작업은 Ctrl+S로 파일에 저장하세요.</p>`;
  container.append(section);
  const el = <T extends HTMLElement = HTMLElement>(selector: string) => section.querySelector<T>(selector)!;
  const refreshButton = el<HTMLButtonElement>('.library-refresh'), saveButton = el<HTMLButtonElement>('.library-snapshot'), allButton = el<HTMLButtonElement>('.library-all');
  let busy = false, selectedPath = host.getFilePath?.() || '', epoch = 0;
  function message(text: string, error = false) { const node = el('.library-message'); node.textContent = text; node.classList.toggle('is-error', error); }
  function disable(value: boolean) { busy = value; section.setAttribute('aria-busy', String(value)); section.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = value); }
  function empty(parent: HTMLElement, text: string) { const p = document.createElement('p'); p.className = 'library-empty'; p.textContent = text; parent.append(p); }
  async function saveCurrent() { const doc = host.getDocument(), data = JSON.stringify(doc); return bridge() ? bridge()!.SaveSnapshot(data) : browserSave(data, doc.title); }
  async function loadVersions() {
    const request = ++epoch;
    const versions = bridge() ? await bridge()!.ListDocumentVersions(selectedPath) : await browserVersions();
    if (request !== epoch) return;
    const list = el('.library-versions'); list.replaceChildren();
    el('.library-version-source').hidden = !selectedPath;
    el('.library-version-source').textContent = selectedPath;
    allButton.hidden = !selectedPath;
    if (!versions?.length) { empty(list, selectedPath ? '이 파일의 이전 버전이 아직 없습니다.' : '보관한 작업이 없습니다. 현재 작업 보관을 눌러 시작하세요.'); return; }
    for (const version of versions) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'library-version'; button.dataset.versionId = version.id;
      const title = document.createElement('strong'); title.textContent = version.title || '이름 없는 보드';
      const meta = document.createElement('span'); meta.textContent = `${dateText(version.createdAt)} · ${sizeText(version.size)} · 사본으로 열기`;
      button.append(title, meta);
      button.addEventListener('click', () => void run(async () => {
        const data = bridge() ? (await bridge()!.ReadDocumentVersion(version.id)).data : await browserRead(version.id);
        const restored: FlowDocument = validateDocument(JSON.parse(data));
        await saveCurrent();
        if (await host.replaceDocument(restored, '') === false) { message('문서 전환을 취소했습니다. 현재 작업 사본은 보관되어 있습니다.'); return; }
        message('현재 작업을 보관하고 이전 사본을 열었습니다. 원본 파일은 바뀌지 않았습니다.');
        await loadVersions();
      }));
      list.append(button);
    }
  }
  async function refresh() {
    const list = el('.library-recent'); list.replaceChildren();
    if (bridge()) {
      const documents = await bridge()!.ListRecentDocuments();
      if (!documents?.length) empty(list, '파일을 열거나 저장하면 여기에 표시됩니다.');
      for (const document of documents ?? []) {
        const row = window.document.createElement('div'); row.className = 'library-file';
        const button = window.document.createElement('button'); button.type = 'button'; button.className = 'library-open'; button.title = document.path;
        const title = window.document.createElement('strong'); title.textContent = document.title || document.path.split(/[\\/]/).at(-1) || '문서';
        const meta = window.document.createElement('span'); meta.textContent = document.path;
        button.append(title, meta);
        button.addEventListener('click', () => void run(async () => {
          const result = await bridge()!.OpenRecentDocument(document.path);
          const restored = validateDocument(JSON.parse(result.data));
          await saveCurrent(); if (await host.replaceDocument(restored, result.path) === false) { message('문서 전환을 취소했습니다. 현재 작업 사본은 보관되어 있습니다.'); return; } message('현재 작업을 보관하고 선택한 파일을 열었습니다.'); await refresh();
        }));
        const versions = window.document.createElement('button'); versions.type = 'button'; versions.className = 'library-file-versions'; versions.textContent = '이력'; versions.setAttribute('aria-label', `${title.textContent} 저장 이력`);
        versions.addEventListener('click', () => void run(async () => { selectedPath = document.path; await loadVersions(); message('파일 저장 이력을 표시합니다.'); }));
        row.append(button, versions); list.append(row);
      }
    } else empty(list, '브라우저에서는 아래 복구 사본을 사용할 수 있습니다. 최근 파일은 데스크톱 앱에서 제공됩니다.');
    await loadVersions();
  }
  async function run(action: () => Promise<void>) {
    if (busy) return; disable(true);
    try { await action(); }
    catch (error) { message(String(error instanceof Error ? error.message : error), true); host.toast('문서 보관함 작업을 완료하지 못했습니다. 안내를 확인하세요.', true); }
    finally { disable(false); }
  }
  refreshButton.addEventListener('click', () => void run(async () => { await refresh(); message('문서 목록을 새로고침했습니다.'); }));
  saveButton.addEventListener('click', () => void run(async () => { await saveCurrent(); selectedPath = ''; await loadVersions(); message('현재 작업을 복구 사본으로 보관했습니다.'); }));
  allButton.addEventListener('click', () => void run(async () => { selectedPath = ''; await loadVersions(); message('직접 보관한 복구 사본을 표시합니다.'); }));
  let initialized = false;
  return { update() { if (initialized || !container.isConnected || container.closest('[hidden]')) return; initialized = true; void run(refresh); } };
}
