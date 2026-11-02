import './organization.css';
import type { WorkbenchHost, WorkspaceGroup } from './workspace-types.ts';
import {
  ensureWorkspace, groupMembers, createGroup, ungroup, setGroupParent, resizeGroup,
  addPage, removePage, moveToPage, addLayer, removeLayer, assignLayer, addBookmark,
  createLibraryItem, insertLibraryItem, loadLibrary, saveLibrary,
} from './organization.ts';

type Option = { value: string; label: string };
const labelOf = (text: string) => text.split('\n')[0].trim().slice(0, 80) || '이름 없는 요소';

/** On-demand DOM panel; no polling, observers, or retained image decoding. */
export function mountOrganizationPanel(host: WorkbenchHost, container: HTMLElement) {
  container.classList.add('organization-panel');
  let activeGroup = '', disposed = false;
  const closedTreeGroups = new Set<string>();
  let treeFocusKey = '';
  let library: ReturnType<typeof loadLibrary> = [], libraryError = '';
  try { library = loadLibrary(); }
  catch (error) { libraryError = error instanceof Error ? error.message : '이 PC의 보관함을 읽지 못했습니다.'; }

  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
    const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
  };
  const button = (text: string, action: () => void, disabled = false, tone = '') => {
    const result = node('button', `org-button ${tone}`, text); result.type = 'button'; result.disabled = disabled;
    result.addEventListener('click', action); return result;
  };
  const field = (label: string, value: string, change: (value: string) => void, options?: Option[]) => {
    const wrapper = node('label', 'org-field'), title = node('span', '', label); wrapper.append(title);
    const input = options ? node('select') : node('input'); input.setAttribute('aria-label', label);
    if (input instanceof HTMLInputElement) { input.type = 'text'; input.maxLength = 120; }
    if (options) for (const item of options) { const option = node('option', '', item.label); option.value = item.value; input.append(option); }
    input.value = value; input.addEventListener('change', () => change(input.value)); wrapper.append(input); return wrapper;
  };
  const section = (title: string) => {
    const section = node('section', 'org-section'); section.append(node('h3', '', title));
    const body = node('div', 'org-section-body'); section.append(body); container.append(section); return body;
  };
  const run = (action: () => void, message?: string) => {
    try { host.mutate(action, message); update(); }
    catch (error) { host.toast(error instanceof Error ? error.message : String(error), true); }
  };
  const row = (...items: HTMLElement[]) => { const result = node('div', 'org-actions'); result.append(...items); return result; };
  const empty = (parent: HTMLElement, text: string) => parent.append(node('p', 'org-empty', text));
  const pagesBody = section('페이지');
  const groupsBody = section('그룹');
  const layersBody = section('레이어');
  const bookmarksBody = section('저장한 보기');
  const libraryBody = section('개인 보관함');

  function revealMember(id: string) {
    const doc = host.getDocument(), item = doc.nodes.find(n => n.id === id); if (!item) return;
    run(() => {
      const workspace = ensureWorkspace(doc), seen = new Set<string>(); let groupId = item.groupId;
      while (groupId && !seen.has(groupId)) {
        seen.add(groupId); const group = workspace.groups!.find(g => g.id === groupId); if (!group) break;
        group.collapsed = false; groupId = group.parentId;
      }
      workspace.activePageId = item.details?.pageId || 'page-main'; host.select([id]);
    }); host.fit([item]);
  }

  function renderGroupTree(groups: WorkspaceGroup[]) {
    const doc = host.getDocument(), tree = node('div', 'org-tree'); tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', '그룹과 내부 요소');tree.setAttribute('aria-multiselectable','true');
    const byId = new Map(groups.map(g => [g.id, g])), children = new Map<string, WorkspaceGroup[]>(), members = new Map<string, typeof doc.nodes>();
    for (const group of groups) { const parent = group.parentId && byId.has(group.parentId) ? group.parentId : ''; const list = children.get(parent) || []; list.push(group); children.set(parent, list); }
    for (const member of doc.nodes) if (member.groupId) { const list = members.get(member.groupId) || []; list.push(member); members.set(member.groupId, list); }
    const focus = (key: string) => { treeFocusKey = key; queueMicrotask(() => { const target = [...groupsBody.querySelectorAll<HTMLElement>('[data-tree-key]')].find(el => el.dataset.treeKey === key); target?.focus(); }); };
    const visited = new Set<string>(); let count = 0, truncated = false;
    type Work = { kind: 'group'; value: WorkspaceGroup; parent: HTMLElement; level: number } | { kind: 'member'; value: typeof doc.nodes[number]; parent: HTMLElement; level: number };
    const stack: Work[] = [...(children.get('') || [])].reverse().map(value => ({kind: 'group', value, parent: tree, level: 1}));
    while (stack.length) {
      if (count >= 500) { truncated = true; break; }
      const task = stack.pop()!, group = task.kind === 'group' ? task.value : undefined;
      if (group && visited.has(group.id)) continue; if (group) visited.add(group.id);
      const key = `${task.kind}:${task.value.id}`, item = node('div', 'org-tree-item');
      item.dataset.treeKey = key; item.setAttribute('role', 'treeitem'); item.setAttribute('aria-level', String(task.level)); item.tabIndex = treeFocusKey ? (treeFocusKey === key ? 0 : -1) : (count === 0 ? 0 : -1);
      item.setAttribute('aria-label', group ? group.name : labelOf((task.value as typeof doc.nodes[number]).text));
      item.setAttribute('aria-selected', String(group ? activeGroup === group.id : host.getSelection().has(task.value.id)));
      const header = node('div', 'org-tree-label'); header.style.paddingLeft = `${Math.min(8, task.level - 1) * 12 + 6}px`;
      const open = group ? !closedTreeGroups.has(group.id) : false;
      if (group) {
        item.setAttribute('aria-expanded', String(open));
        const toggle = node('button', 'org-tree-toggle'); toggle.type = 'button'; toggle.tabIndex = -1; toggle.setAttribute('aria-label', `${group.name} 목록 ${open ? '접기' : '펼치기'}`);
        toggle.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="${open ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4'}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        toggle.addEventListener('click', event => { event.stopPropagation(); open ? closedTreeGroups.add(group.id) : closedTreeGroups.delete(group.id); renderGroups(); focus(key); }); header.append(toggle);
      } else header.append(node('span', 'org-tree-member-mark'));
      header.append(node('span', 'org-tree-name', group ? group.name : labelOf((task.value as typeof doc.nodes[number]).text)));
      const activate = () => {
        treeFocusKey = key;
        if (group) {
          activeGroup = group.id; const selected = groupMembers(doc, group.id);
          run(() => { if (selected[0]) ensureWorkspace(doc).activePageId = selected[0].details?.pageId || 'page-main'; host.select(selected.map(n => n.id)); });
          host.fit(selected);
        } else revealMember(task.value.id);
        focus(key);
      };
      header.addEventListener('click', activate); item.append(header); task.parent.append(item); count++;
      item.addEventListener('focus', () => { treeFocusKey = key; tree.querySelectorAll<HTMLElement>('[role="treeitem"]').forEach(el => el.tabIndex = el === item ? 0 : -1); });
      item.addEventListener('keydown', event => {
        if ((event.target as Element).closest('[role="treeitem"]') !== item) return;
        const rows = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')], index = rows.indexOf(item);
        if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))); rows[next]?.focus(); }
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
        else if (event.key === 'ArrowRight' && group) { event.preventDefault(); if (!open) { closedTreeGroups.delete(group.id); renderGroups(); focus(key); } else if (Number(rows[index + 1]?.getAttribute('aria-level')) > task.level) rows[index + 1]?.focus(); }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); if (group && open) { closedTreeGroups.add(group.id); renderGroups(); focus(key); } else { const parent = item.parentElement?.closest<HTMLElement>('[role="treeitem"]'); parent?.focus(); } }
      });
      if (group && open) {
        const branch = node('div', 'org-tree-branch'); branch.setAttribute('role', 'group'); item.append(branch);
        const next: Work[] = [...(children.get(group.id) || []).map(value => ({kind:'group' as const,value,parent:branch,level:task.level+1})), ...(members.get(group.id) || []).map(value => ({kind:'member' as const,value,parent:branch,level:task.level+1}))];
        stack.push(...next.reverse());
      }
    }
    if (!tree.querySelector('[tabindex="0"]')) { const first = tree.querySelector<HTMLElement>('[role="treeitem"]'); if (first) first.tabIndex = 0; }
    groupsBody.append(tree);
    if (truncated) groupsBody.append(node('p', 'org-help', '목록은 500개까지 표시합니다. 상위 묶음을 접거나 아래 그룹 선택에서 나머지를 찾으세요.'));
  }

  function renderPages() {
    const doc = host.getDocument(), workspace = doc.workspace;
    const pages = workspace?.pages?.length ? workspace.pages : [{ id: 'page-main', name: '기본 페이지' }];
    const active = workspace?.activePageId || pages[0].id, current = pages.find(p => p.id === active) || pages[0];
    pagesBody.replaceChildren();
    pagesBody.append(field('현재 페이지', current.id, id => {
      run(() => { ensureWorkspace(doc).activePageId = id; host.select([]); }, '페이지를 변경했습니다.');
    }, pages.map(page => ({ value: page.id, label: `${page.name} · ${doc.nodes.filter(n => (n.details?.pageId || 'page-main') === page.id).length}개` }))));
    pagesBody.append(field('페이지 이름', current.name, name => run(() => {
      const page = ensureWorkspace(doc).pages!.find(p => p.id === current.id)!; page.name = name.trim().slice(0, 120) || '페이지';
    })));
    pagesBody.append(row(button('페이지 추가', () => run(() => {
      const id = addPage(doc, `페이지 ${pages.length + 1}`); ensureWorkspace(doc).activePageId = id; host.select([]);
    }, '새 페이지를 만들었습니다.')), button('기본 페이지로 합치기', () => run(() => {
      removePage(doc, current.id); host.select([]);
    }, '요소를 기본 페이지로 옮겼습니다.'), current.id === 'page-main')));
    const destination = field('선택 요소를 보낼 페이지', '', id => {
      if (id) run(() => { moveToPage(doc, host.getSelection(), id); host.select([]); }, '선택 요소의 페이지를 변경했습니다.');
    }, [{ value: '', label: '페이지 선택…' }, ...pages.map(page => ({ value: page.id, label: page.name }))]);
    (destination.querySelector('select') as HTMLSelectElement).disabled = host.getSelection().size === 0;
    pagesBody.append(destination);
  }

  function renderGroups() {
    const doc = host.getDocument(), groups = doc.workspace?.groups || [], selected = host.getSelection();
    const legacy = [...new Set(doc.nodes.map(n => n.groupId).filter((value): value is string => !!value))]
      .filter(id => !groups.some(g => g.id === id)).map(id => ({ id, name: '이름 없는 그룹', parentId: undefined, collapsed: false }));
    const allGroups: WorkspaceGroup[] = [...groups, ...legacy];
    if (!allGroups.some(g => g.id === activeGroup)) activeGroup = doc.nodes.find(n => selected.has(n.id) && n.groupId)?.groupId || allGroups[0]?.id || '';
    groupsBody.replaceChildren();
    groupsBody.append(row(button('선택 요소 묶기', () => run(() => {
      activeGroup = createGroup(doc, selected, `그룹 ${allGroups.length + 1}`); host.select(groupMembers(doc, activeGroup).map(n => n.id));
    }, '선택 요소를 그룹으로 만들었습니다.'), selected.size < 2, 'org-primary')));
    if (!allGroups.length) { empty(groupsBody, '여러 요소를 선택하고 그룹을 만들어 보세요.'); return; }
    renderGroupTree(allGroups);
    groupsBody.append(field('관리할 그룹', activeGroup, id => { activeGroup = id; update(true); }, allGroups.map(g => ({ value: g.id, label: `${g.parentId ? '하위 그룹 · ' : ''}${g.name} (${groupMembers(doc, g.id).length})` }))));
    const group = allGroups.find(g => g.id === activeGroup); if (!group) return;
    const currentGroup = () => {
      const workspace = ensureWorkspace(doc);
      let current = workspace.groups!.find(g => g.id === group.id);
      if (!current) { current = { id: group.id, name: group.name }; workspace.groups!.push(current); }
      return current;
    };
    groupsBody.append(field('그룹 이름', group.name, name => run(() => { currentGroup().name = name.trim().slice(0, 120) || '그룹'; })));
    const descriptionField = node('label', 'org-field'), description = node('textarea');
    descriptionField.append(node('span', '', '그룹 설명')); description.rows = 3; description.maxLength = 5000; description.value = group.description || ''; description.setAttribute('aria-label', '그룹 설명');
    description.addEventListener('change', () => run(() => { currentGroup().description = description.value.slice(0, 5000); })); descriptionField.append(description); groupsBody.append(descriptionField);
    groupsBody.append(field('상위 그룹', group.parentId || '', id => run(() => setGroupParent(doc, group.id, id || undefined)), [{ value: '', label: '최상위 그룹' }, ...allGroups.filter(g => g.id !== group.id).map(g => ({ value: g.id, label: g.name }))]));
    groupsBody.append(row(button(group.collapsed ? '그룹 펼치기' : '그룹 접기', () => run(() => {
      const current = currentGroup(); current.collapsed = !current.collapsed; host.select([]);
    })), button('그룹 선택', () => {
      const members = groupMembers(doc, group.id);
      run(() => { if (members[0]) ensureWorkspace(doc).activePageId = members[0].details?.pageId || 'page-main'; host.select(members.map(n => n.id)); });
      host.fit(members);
    }), button('그룹 풀기', () => run(() => { ungroup(doc, group.id); activeGroup = ''; }, '그룹을 해제했습니다.'))));
    const scaleRow = node('div', 'org-scale'), scaleLabel = node('label', '', '그룹 크기');
    const scaleInput = node('input'); scaleInput.type = 'number'; scaleInput.min = '10'; scaleInput.max = '400'; scaleInput.step = '10'; scaleInput.value = '100'; scaleInput.setAttribute('aria-label', '그룹 크기 비율');
    scaleLabel.append(scaleInput, document.createTextNode('%')); scaleRow.append(scaleLabel, button('크기 적용', () => run(() => {
      const percent = Number(scaleInput.value); if (!Number.isFinite(percent) || percent < 10 || percent > 400) throw new Error('그룹 크기는 10~400%로 입력하세요.');
      resizeGroup(doc, group.id, percent / 100);
    }, '그룹 크기를 변경했습니다.'))); groupsBody.append(scaleRow);
    const memberSelect = field('그룹 안의 요소 선택', '', id => {
      if (!id) return;
      revealMember(id);
    }, [{ value: '', label: '개별 요소 선택…' }, ...groupMembers(doc, group.id).map(n => ({ value: n.id, label: labelOf(n.text) }))]);
    groupsBody.append(memberSelect);
  }

  function renderLayers() {
    const doc = host.getDocument(), layers = doc.workspace?.layers || [];
    layersBody.replaceChildren();
    layersBody.append(button('레이어 추가', () => run(() => { addLayer(doc, `레이어 ${layers.length + 1}`); })));
    const selectedLayer = doc.nodes.find(n => host.getSelection().has(n.id))?.details?.layerId || '';
    const assign = field('선택 요소의 레이어', selectedLayer === 'layer-main' ? '' : selectedLayer, id => run(() => {
      assignLayer(doc, host.getSelection(), id); host.select([]);
    }), [{ value: '', label: '기본 레이어' }, ...layers.filter(layer => layer.id !== 'layer-main').map(layer => ({ value: layer.id, label: layer.name }))]);
    (assign.querySelector('select') as HTMLSelectElement).disabled = !host.getSelection().size; layersBody.append(assign);
    if (!layers.length) { empty(layersBody, '배경·캡처·설명처럼 역할에 따라 나눌 수 있습니다.'); return; }
    for (const [index, layer] of layers.entries()) {
      const item = node('div', 'org-layer-row');
      item.append(field('레이어 이름', layer.name, name => run(() => { layer.name = name.trim().slice(0, 120) || '레이어'; })));
      const visibility = button(layer.hidden ? '표시' : '숨기기', () => run(() => { layer.hidden = !layer.hidden; host.select([]); })); visibility.setAttribute('aria-label', `${layer.name} ${layer.hidden ? '표시' : '숨기기'}`); visibility.setAttribute('aria-pressed', String(!!layer.hidden));
      const lock = button(layer.locked ? '잠금 해제' : '잠금', () => run(() => { layer.locked = !layer.locked; host.select([]); })); lock.setAttribute('aria-label', `${layer.name} ${layer.locked ? '잠금 해제' : '잠금'}`); lock.setAttribute('aria-pressed', String(!!layer.locked));
      const reorder = (offset: number) => run(() => {
        const list = ensureWorkspace(doc).layers!, current = list.findIndex(l => l.id === layer.id), target = current + offset;
        if (current < 0 || target < 0 || target >= list.length) return;
        const [entry] = list.splice(current, 1); list.splice(target, 0, entry);
      });
      item.append(row(visibility, lock, button('한 단계 뒤로', () => reorder(-1), index === 0), button('한 단계 앞으로', () => reorder(1), index === layers.length - 1), button('레이어 해제', () => run(() => removeLayer(doc, layer.id), '요소를 기본 레이어로 옮겼습니다.'), layer.id === 'layer-main'))); layersBody.append(item);
    }
  }

  function renderBookmarks() {
    const doc = host.getDocument(), bookmarks = doc.workspace?.bookmarks || [];
    bookmarksBody.replaceChildren(); bookmarksBody.append(button('현재 보기 저장', () => run(() => {
      addBookmark(doc, `보기 ${bookmarks.length + 1}`, [...host.getSelection()][0]);
    }, '현재 배율과 위치를 저장했습니다.')));
    if (!bookmarks.length) { empty(bookmarksBody, '저장한 보기가 없습니다.'); return; }
    for (const bookmark of bookmarks) {
      const item = node('div', 'org-bookmark'); item.append(field('보기 이름', bookmark.name, name => run(() => { bookmark.name = name.trim().slice(0, 120) || '보기'; })));
      item.append(row(button('이 보기로 이동', () => {
        const target = bookmark.nodeId && doc.nodes.find(n => n.id === bookmark.nodeId);
        run(() => { if (target) ensureWorkspace(doc).activePageId = target.details?.pageId || doc.workspace?.pages?.[0]?.id || 'page-main'; doc.viewport = { ...bookmark.viewport }; host.select(target ? [target.id] : []); });
      }), button('보기 삭제', () => run(() => { ensureWorkspace(doc).bookmarks = bookmarks.filter(b => b.id !== bookmark.id); })))); bookmarksBody.append(item);
    }
  }

  function renderLibrary() {
    const doc = host.getDocument(); libraryBody.replaceChildren();
    if (libraryError) {
      const error = node('p', 'org-error', `${libraryError} 기존 보관함을 보호하기 위해 저장을 중지했습니다. 문서를 파일로 보관한 뒤 저장소 상태를 확인하세요.`); error.setAttribute('role', 'alert'); libraryBody.append(error);
    }
    libraryBody.append(button('선택을 보관함에 저장', () => {
      try { const item = createLibraryItem(doc, host.getSelection(), `내 구성 ${library.length + 1}`); const next = [...library, item]; saveLibrary(next); library = next; host.toast('선택한 구성을 이 PC에 보관했습니다.'); update(true); }
      catch (error) { host.toast(error instanceof Error ? error.message : String(error), true); }
    }, host.getSelection().size === 0 || !!libraryError, 'org-primary'));
    if (!library.length) { empty(libraryBody, '반복 사용하는 선행 자료 묶음이나 도형 구성을 저장하세요.'); return; }
    for (const item of library) {
      const rowItem = node('div', 'org-library-item');
      rowItem.append(field('보관한 구성 이름', item.name, name => {
        try {
          const next = library.map(entry => entry.id === item.id ? { ...entry, name: name.trim().slice(0, 120) || '내 구성' } : entry);
          saveLibrary(next); library = next;
        } catch (error) { host.toast(error instanceof Error ? error.message : String(error), true); }
      }), row(button('현재 페이지에 삽입', () => run(() => {
        const viewport = doc.viewport, ids = insertLibraryItem(doc, item, { x: (120 - viewport.x) / viewport.zoom, y: (120 - viewport.y) / viewport.zoom }); host.select(ids); host.fit(doc.nodes.filter(n => ids.includes(n.id)));
      }, '보관한 구성을 삽입했습니다.')), button('보관함에서 삭제', () => {
        try { const next = library.filter(entry => entry.id !== item.id); saveLibrary(next); library = next; update(true); }
        catch (error) { host.toast(error instanceof Error ? error.message : String(error), true); }
      }))); libraryBody.append(rowItem);
    }
  }

  function update(force = false) {
    if (disposed) return;
    const active = document.activeElement;
    if (!force && active && container.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    renderPages(); renderGroups(); renderLayers(); renderBookmarks(); renderLibrary();
  }
  // A blur fired by a button press precedes click. Replacing that button here
  // would swallow the first click; its action will refresh after it runs.
  const blur = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return;
    queueMicrotask(() => update());
  };
  container.addEventListener('focusout', blur);
  update();
  return { update, destroy() { disposed = true; container.removeEventListener('focusout', blur); container.replaceChildren(); } };
}
