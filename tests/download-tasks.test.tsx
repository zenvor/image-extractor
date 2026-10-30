// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DownloadTasks from '../entrypoints/download/DownloadTasks';
import { runArchive } from '../lib/archive';
import { setLanguagePreference } from '../lib/i18n';
import { ARCHIVE_KEY, archiveKey, removeArchiveRecords } from '../lib/archiveState';
import type { ArchiveBatch } from '../lib/types';

vi.mock('../lib/archive', () => ({ runArchive: vi.fn(async () => {}) }));
let root: Root, container: HTMLDivElement;
let records: Record<string, unknown>;
let allowDownloadAccess: boolean;
type Changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
let listeners: Set<Changed>;
let revoked: Set<() => void>;
function batch(id: string, status: ArchiveBatch['status'] = 'fetching', owner = 77): ArchiveBatch {
  return {
    id, title: `Page ${id}`, filename: `${id}.zip`, sourceTabId: Number(id), pageUrl: `https://page-${id}.test/`,
    status, tabId: owner, started: Number(id) || 1, launched: 1, updated: 1, bytes: 20, message: '',
    items: [
      { id: 'ok', filename: '001.svg', url: 'https://ok.test/a.svg', kind: 'small', status: 'complete', bytes: 20 },
      { id: 'remaining', filename: '002.svg', url: 'https://failed.test/b.svg', kind: 'small', status: 'pending' },
    ],
  };
}
async function mount() { await act(async () => root.render(<DownloadTasks />)); }
async function update(value: ArchiveBatch) {
  records[archiveKey(value.id)] = value;
  await act(async () => { for (const changed of listeners) changed({ [archiveKey(value.id)]: { newValue: value } }, 'local'); });
}
function card(id: string) { return container.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!; }
function button(id: string, label: string) { return [...card(id).querySelectorAll('button')].find(el => el.textContent === label)!; }
beforeEach(async () => {
  await setLanguagePreference('zh-CN'); allowDownloadAccess = true; records = {}; listeners = new Set(); revoked = new Set();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('chrome', {
    downloads: { showDefaultFolder: vi.fn(async () => {}) },
    tabs: { getCurrent: vi.fn(async () => ({ id: 77 })), update: vi.fn(async () => ({ id: 99 })) },
    permissions: { request: vi.fn(async () => allowDownloadAccess), onRemoved: { addListener: (fn: () => void) => revoked.add(fn), removeListener: (fn: () => void) => revoked.delete(fn) } },
    runtime: { sendMessage: vi.fn(async message => message.type === 'REMOVE_ARCHIVE_RECORDS'
      ? { ok: true, count: await removeArchiveRecords(message.ids, message.completedOnly) }
      : { ok: true, batchId: 'retry', tabId: 77 }) },
    storage: { local: { get: vi.fn(async () => structuredClone(records)), set: vi.fn(async () => {}), remove: vi.fn(async (keys: string[]) => {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const key of keys) { changes[key] = { oldValue: records[key] }; delete records[key]; }
      for (const changed of listeners) changed(changes, 'local');
    }) },
      onChanged: { addListener: (fn: Changed) => listeners.add(fn), removeListener: (fn: Changed) => listeners.delete(fn) } },
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  await setLanguagePreference('zh-CN'); vi.unstubAllGlobals(); vi.clearAllMocks();
});

it('shows five pages together and updates one progress without restarting any transfer', async () => {
  for (let id = 1; id <= 5; id++) records[archiveKey(String(id))] = batch(String(id), id <= 3 ? 'fetching' : 'complete');
  await mount();
  expect(container.querySelectorAll('[data-task-id]')).toHaveLength(5);
  expect([...container.querySelectorAll('.tasks-stats dt')].map(node => node.textContent)).toEqual(['全部任务', '进行中', '已保存']);
  expect([...container.querySelectorAll('.tasks-stats dd')].map(node => node.textContent)).toEqual(['5', '3', '2']);
  expect(vi.mocked(runArchive).mock.calls.map(([id]) => id).sort()).toEqual(['1', '2', '3']);
  const changed = structuredClone(records[archiveKey('1')]) as ArchiveBatch;
  changed.items[1]!.status = 'complete';
  await update(changed);
  expect(card('1').textContent).toContain('2 / 2 张已处理');
  expect(card('2').textContent).toContain('1 / 2 张已处理');
  expect(card('1').querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('100');
  expect(runArchive).toHaveBeenCalledTimes(3);
  await act(async () => { await setLanguagePreference('en'); });
  expect([...container.querySelectorAll('.tasks-stats dt')].map(node => node.textContent)).toEqual(['All tasks', 'Active', 'Saved']);
  expect([...container.querySelectorAll('.tasks-stats dd')].map(node => node.textContent)).toEqual(['5', '3', '2']);
  expect(runArchive).toHaveBeenCalledTimes(3);
  expect(vi.mocked(runArchive).mock.calls.every(([, signal]) => !signal.aborted)).toBe(true);
});

it('cancels only the chosen task and starts newly added batches independently', async () => {
  records[archiveKey('1')] = batch('1'); records[archiveKey('2')] = batch('2');
  await mount();
  const first = vi.mocked(runArchive).mock.calls.find(([id]) => id === '1')![1];
  const second = vi.mocked(runArchive).mock.calls.find(([id]) => id === '2')![1];
  await act(async () => button('1', '取消下载').click());
  expect(first.aborted).toBe(true); expect(second.aborted).toBe(false);
  await update(batch('3', 'queued'));
  expect(runArchive).toHaveBeenCalledTimes(3);
  expect(second.aborted).toBe(false);
});

it('restarts only the resumed batch with its new launch identity', async () => {
  records[archiveKey('1')] = batch('1'); records[archiveKey('2')] = batch('2'); await mount();
  const cancelled = { ...batch('1', 'cancelled'), cacheUntil: Date.now() + 60000 };
  await update(cancelled);
  await act(async () => button('1', '继续未完成下载').click());
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'RESUME_ARCHIVE', batchId: '1' });
  await update({ ...cancelled, launched: 2, status: 'queued' });
  expect(vi.mocked(runArchive).mock.calls.map(([id]) => id).sort()).toEqual(['1', '1', '2']);
});

it('requests permissions for failed images only and preserves failure details', async () => {
  const partial = batch('1', 'partial'); partial.items[1]!.status = 'failed'; partial.items[1]!.error = 'HTTP 503';
  records[archiveKey('1')] = partial; await mount();
  expect(card('1').querySelector<HTMLElement>('[data-outcome=complete]')?.style.width).toBe('50%');
  expect(card('1').querySelector<HTMLElement>('[data-outcome=failed]')?.style.width).toBe('50%');
  expect(card('1').querySelector('[role=progressbar]')?.getAttribute('aria-valuetext')).toContain('1 张成功，1 张失败');
  const row = card('1');
  expect(button('1', '仅重试失败图像').dataset.variant).toBe('outline');
  expect(row.querySelector('[role=region]')).toBeNull();
  await act(async () => button('1', '失败详情（1）').click());
  const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
  expect(dialog.textContent).toContain('002.svg');
  expect(dialog.textContent).toContain('HTTP 503');
  expect(dialog.querySelector('[role=region]')?.textContent).toContain('https://failed.test/b.svg');
  expect(dialog.querySelector('[role=region]')?.getAttribute('tabindex')).toBe('0');
  expect(card('1')).toBe(row);
  await act(async () => [...dialog.querySelectorAll('button')].find(node => node.textContent === '关闭')!.click());
  expect(document.querySelector('[role=dialog]')).toBeNull();
  await act(async () => button('1', '仅重试失败图像').click());
  expect(chrome.permissions.request).toHaveBeenCalledWith({ permissions: ['downloads'], origins: ['https://failed.test/*'] });
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'RETRY_ARCHIVE', batchId: '1' });
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(runArchive).not.toHaveBeenCalled();
});

it('observes older worker pages without taking their work or cancellation ownership', async () => {
  records[archiveKey('1')] = batch('1', 'fetching', 99); await mount();
  expect(runArchive).not.toHaveBeenCalled();
  expect(button('1', '取消下载')).toBeUndefined();
  await act(async () => button('1', '打开正在下载的任务').click());
  expect(chrome.tabs.update).toHaveBeenCalledWith(99, { active: true });
});

it.each(['permission', 'unload'])('aborts every owned controller on %s and unregisters listeners', async reason => {
  records[archiveKey('1')] = batch('1'); records[archiveKey('2')] = batch('2'); await mount();
  if (reason === 'permission') for (const revoke of revoked) revoke();
  else window.dispatchEvent(new Event('beforeunload'));
  expect(vi.mocked(runArchive).mock.calls.every(([, signal]) => signal.aborted)).toBe(true);
  expect(revoked.size).toBe(2);
  await act(async () => root.unmount());
  expect(revoked.size).toBe(0); expect(listeners.size).toBe(0);
  root = createRoot(container);
});

it('keeps live storage updates that arrive before the initial snapshot resolves', async () => {
  let finish!: (value: Record<string, unknown>) => void;
  vi.mocked(chrome.storage.local.get).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount();
  const current = batch('1', 'complete'); current.items[1]!.status = 'complete';
  await update(current);
  await act(async () => finish({ [archiveKey('1')]: batch('1') }));
  expect(card('1').textContent).toContain('下载完成');
  expect(runArchive).not.toHaveBeenCalled();
});

it('shows an empty overview without starting any work', async () => {
  await mount(); expect(container.textContent).toContain('还没有下载任务'); expect(runArchive).not.toHaveBeenCalled();
});

it('distinguishes saved partial results, unsaved failures and user cancellation without losing details', async () => {
  const partial = batch('1', 'partial'); partial.items[1]!.status = 'failed'; partial.items[1]!.error = 'HTTP 404';
  const failed = batch('2', 'failed'); failed.message = 'Archive disk failure';
  records[archiveKey('1')] = partial; records[archiveKey('2')] = failed; records[archiveKey('3')] = batch('3', 'cancelled');
  await mount();
  expect(card('1').querySelector('[data-slot=badge]')?.getAttribute('data-variant')).toBe('warning');
  expect(card('1').querySelector('[role=status]')?.textContent).toBe('ZIP 已保存。');
  expect(card('2').querySelector('[data-slot=badge]')?.getAttribute('data-variant')).toBe('destructive');
  expect(card('2').querySelector('[role=status]')?.textContent).toBe('ZIP 未保存。');
  expect(card('3').querySelector('[data-slot=badge]')?.getAttribute('data-variant')).toBe('outline');
  expect(card('2').textContent).toContain('Archive disk failure');
  expect(card('3').textContent).toContain('下载已取消');
  expect(button('1', '失败详情（1）')).toBeTruthy();
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(runArchive).not.toHaveBeenCalled();
});

it('keeps task rows and active controllers mounted through resizing and status sorting', async () => {
  records[archiveKey('1')] = batch('1'); records[archiveKey('2')] = batch('2'); await mount();
  const firstRow = card('1'); const secondRow = card('2');
  const secondSignal = vi.mocked(runArchive).mock.calls.find(([id]) => id === '2')![1];
  expect(firstRow.tagName).toBe('TR');
  expect([...container.querySelectorAll('thead th')].map(el => el.textContent)).toEqual(['任务与来源', '状态与进度', '下载结果', '操作']);
  expect([...firstRow.querySelectorAll('td')].map(el => el.getAttribute('headers'))).toEqual(['tasks-source', 'tasks-progress', 'tasks-result', 'tasks-actions']);
  await act(async () => window.dispatchEvent(new Event('resize')));
  await update({ ...batch('2', 'complete'), items: batch('2').items.map(item => ({ ...item, status: 'complete' })) });
  expect([...container.querySelectorAll('[data-task-id]')].map(el => el.getAttribute('data-task-id'))).toEqual(['1', '2']);
  expect(card('1')).toBe(firstRow); expect(card('2')).toBe(secondRow);
  expect(runArchive).toHaveBeenCalledTimes(2); expect(secondSignal.aborted).toBe(false);
  await act(async () => { await setLanguagePreference('en'); });
  expect([...container.querySelectorAll('thead th')].map(el => el.textContent)).toEqual(['Task / source', 'Status / progress', 'Download results', 'Actions']);
  expect(card('1')).toBe(firstRow); expect(card('2')).toBe(secondRow);
  expect(container.querySelectorAll('[aria-label="Interface language: English"]')).toHaveLength(1);
});

it('shows full filenames and source URLs directly in each task row', async () => {
  const complete = batch('1', 'complete');
  complete.title = 'Long title '.repeat(40); complete.pageUrl = 'https://gallery.test/deep/path?album=example';
  records[archiveKey('1')] = complete; await mount();
  expect(card('1').querySelector('h2')?.title).toBe(complete.title);
  expect(card('1').querySelector('.task-identity')?.textContent).toContain('gallery.test');
  expect(card('1').textContent).toContain(complete.filename);
  expect(card('1').textContent).toContain(complete.pageUrl);
  expect(button('1', '删除记录')).toBeTruthy();
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(runArchive).not.toHaveBeenCalled();
});

it.each([0, 5])('opens the default downloads folder once from one global control with %s task rows', async count => {
  for (let id = 1; id <= count; id++) records[archiveKey(String(id))] = batch(String(id), 'complete');
  await mount();
  const folderButtons = [...container.querySelectorAll('button')].filter(el => el.textContent === '打开下载文件夹');
  expect(folderButtons).toHaveLength(1);
  expect(folderButtons[0]!.closest('tr')).toBeNull();
  await act(async () => folderButtons[0]!.click());
  expect(chrome.permissions.request).toHaveBeenCalledWith({ permissions: ['downloads'] });
  expect(chrome.downloads.showDefaultFolder).toHaveBeenCalledTimes(1);
  expect(runArchive).not.toHaveBeenCalled();
});

it('reports denied folder permission and open errors without starting a transfer', async () => {
  await mount();
  const folderButton = [...container.querySelectorAll('button')].find(el => el.textContent === '打开下载文件夹')!;
  allowDownloadAccess = false;
  await act(async () => folderButton.click());
  expect(container.querySelector('[role=alert]')?.textContent).toBe('未获得下载权限。');
  expect(chrome.downloads.showDefaultFolder).not.toHaveBeenCalled();
  allowDownloadAccess = true;
  vi.mocked(chrome.downloads.showDefaultFolder).mockImplementationOnce(() => { throw new Error('not available'); });
  await act(async () => folderButton.click());
  expect(container.querySelector('[role=alert]')?.textContent).toBe('请在 Chrome 下载列表中查看 ZIP。');
  expect(runArchive).not.toHaveBeenCalled();
});

it('shows imported HTML source metadata without replacing the workspace identity', async () => {
  const imported = { ...batch('1', 'complete'), title: 'gallery.html', pageUrl: 'chrome-extension://example/popup.html?workspace=1', sourceUrl: 'https://gallery.test/original/' };
  records[archiveKey('1')] = imported;
  records[archiveKey('2')] = { ...imported, id: '2', sourceUrl: undefined };
  await mount();
  expect(card('1').textContent).toContain('https://gallery.test/original/');
  expect(card('1').textContent).not.toContain('chrome-extension://');
  expect(card('2').textContent).toContain('本地 HTML：gallery.html');
  expect(imported.pageUrl).toBe('chrome-extension://example/popup.html?workspace=1');
});

it('searches titles, filenames and source URLs without aborting hidden transfers', async () => {
  records[archiveKey('1')] = batch('1');
  records[archiveKey('2')] = { ...batch('2', 'complete'), title: 'Holiday', filename: 'album.zip', sourceUrl: 'https://gallery.test/photos/' };
  await mount();
  const firstRow = card('1');
  const signal = vi.mocked(runArchive).mock.calls[0]![1];
  const input = container.querySelector<HTMLInputElement>('#task-search')!;
  for (const term of ['HOLIDAY', 'album.zip', 'gallery.test', 'no-match']) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, term);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(card('1')).toBe(firstRow);
    expect(card('1').hidden).toBe(true);
    expect(card('2').hidden).toBe(term === 'no-match');
    expect(signal.aborted).toBe(false);
  }
  expect(container.textContent).toContain('没有符合条件的任务');
  await act(async () => [...container.querySelectorAll('button')].find(el => el.textContent === '清除筛选')!.click());
  expect(card('1').hidden).toBe(false);
  expect(runArchive).toHaveBeenCalledTimes(1);
});

it('clears all completed records including legacy copies while retaining failures, active tasks and unrelated storage', async () => {
  records[ARCHIVE_KEY] = batch('1', 'complete');
  records[archiveKey('1')] = batch('1', 'complete');
  records[archiveKey('2')] = batch('2');
  records[archiveKey('3')] = batch('3', 'partial');
  records[archiveKey('4')] = batch('4', 'failed');
  records.preference = 'keep';
  await mount();
  const signal = vi.mocked(runArchive).mock.calls[0]![1];
  expect(button('2', '删除记录')).toBeUndefined();
  await act(async () => [...container.querySelectorAll('button')].find(el => el.textContent === '清理已完成记录（1）')!.click());
  expect(card('1')).toBeNull();
  expect(Object.keys(records).sort()).toEqual([archiveKey('2'), archiveKey('3'), archiveKey('4'), 'preference'].sort());
  expect(signal.aborted).toBe(false);
  expect(container.textContent).toContain('已删除 1 条任务记录');
  await act(async () => button('3', '删除记录').click());
  expect(card('3')).toBeNull();
  expect(card('4')).toBeTruthy();
  expect(chrome.downloads.showDefaultFolder).not.toHaveBeenCalled();
});

it('keeps the task record and reports a storage deletion failure', async () => {
  records[archiveKey('1')] = batch('1', 'complete');
  await mount();
  vi.mocked(chrome.storage.local.remove).mockRejectedValueOnce(new Error('storage error'));
  await act(async () => button('1', '删除记录').click());
  expect(card('1')).toBeTruthy();
  expect(container.querySelector('[role=alert]')?.textContent).toBe('无法删除任务记录，请重试。');
  expect(button('1', '删除记录').disabled).toBe(false);
});
