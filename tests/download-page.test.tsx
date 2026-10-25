// @vitest-environment happy-dom
import { act } from 'react';
import { setLanguagePreference } from '../lib/i18n';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readArchive } from '../lib/archiveState';
import { runArchive } from '../lib/archive';
import App from '../entrypoints/download/App';
import type { ArchiveBatch } from '../lib/types';
vi.mock('../lib/archive', () => ({ runArchive: vi.fn(async () => {}) }));
vi.mock('../lib/archiveState', async importOriginal => ({ ...await importOriginal<typeof import('../lib/archiveState')>(), readArchive: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  window.history.replaceState({}, '', '?batch=');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', { tabs: { getCurrent: vi.fn(async () => ({ id: 1 })) }, storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } }, permissions: { onRemoved: { addListener: vi.fn(), removeListener: vi.fn() } } });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it.each(['fetching', 'packing', 'saving', 'partial', 'failed', 'cancelled'] as const)('explains the %s state accurately on the task page', async status => {
  const batch: ArchiveBatch = { id: '', filename: 'test.zip', title: 'test', pageUrl: 'https://example.org/', status, started: 1, updated: 1, bytes: 100, message: '任务已中断，请重试。', items: [
    { id: '1', url: 'https://example.org/1.jpg', filename: '001.jpg', kind: 'large', status: 'complete' },
    { id: '2', url: 'https://example.org/2.jpg', filename: '002.jpg', kind: 'large', status: 'failed', error: 'HTTP 404' },
  ] };
  vi.mocked(readArchive).mockResolvedValue(batch);
  await act(async () => root.render(<App />));
  expect(runArchive).toHaveBeenCalledOnce();
  const progress = container.querySelector('[role=progressbar]')!;
  if (status === 'packing' || status === 'saving') {
    expect(progress.hasAttribute('aria-valuenow')).toBe(false);
    expect(container.querySelector('[role=status]')?.textContent).not.toContain('ZIP 已保存');
    expect(container.querySelector('.progress-indeterminate')).not.toBeNull();
  }
  if (status === 'partial') {
    expect(container.textContent).toContain('部分图像下载失败');
    expect(container.querySelector('[role=status]')?.textContent).toContain('1 张成功，1 张失败');
    expect(container.querySelector('.failed-items')?.textContent).toContain('HTTP 404');
  }
  if (status === 'cancelled') expect(container.textContent).toContain('下载已取消');
  if (status === 'failed') expect(container.querySelector('[role=status]')?.textContent).toContain('任务已中断');
});

it('starts a retry from the task page and replaces its button with a link to the new task', async () => {
  const batch: ArchiveBatch = { id: '', filename: 'test.zip', title: 'test', pageUrl: 'https://example.org/', status: 'partial', started: 1, updated: 1, bytes: 100, message: '', items: [
    { id: '1', url: 'https://success.example/1.jpg', filename: '001.jpg', kind: 'large', status: 'complete' },
    { id: '2', url: 'https://failed.example/2.jpg', filename: '002.jpg', kind: 'large', status: 'failed' },
  ] };
  const request = vi.fn(async () => true);
  const sendMessage = vi.fn(async () => ({ ok: true, batchId: 'retry', tabId: 99 }));
  const update = vi.fn(async () => ({}));
  Object.assign(chrome.permissions, { request });
  Object.assign(chrome, { runtime: { sendMessage }, tabs: { update, getCurrent: vi.fn(async () => ({ id: 1 })) } });
  vi.mocked(readArchive).mockResolvedValue(batch);
  await act(async () => root.render(<App />));
  const retry = [...container.querySelectorAll('button')].find(button => button.textContent === '仅重试失败图像')!;
  await act(async () => retry.click());
  expect(request).toHaveBeenCalledWith({ permissions: ['downloads'], origins: ['https://failed.example/*'] });
  expect(sendMessage).toHaveBeenCalledWith({ type: 'RETRY_ARCHIVE', batchId: '' });
  expect(update).toHaveBeenCalledWith(99, { active: true });
  expect(container.textContent).toContain('查看重试任务');
  expect([...container.querySelectorAll('button')].some(button => button.textContent === '仅重试失败图像')).toBe(false);
});

it('redirects a former task owner to the current download page rather than offering a no-op cancel', async () => {
  const batch: ArchiveBatch = { id: '', filename: 'test.zip', title: 'test', pageUrl: '', status: 'fetching', started: 1, updated: 1, bytes: 0, message: '', tabId: 99, items: [] };
  const update = vi.fn(async () => ({}));
  Object.assign(chrome, { tabs: { getCurrent: vi.fn(async () => ({ id: 1 })), update } });
  vi.mocked(readArchive).mockResolvedValue(batch);
  await act(async () => root.render(<App />));
  expect([...container.querySelectorAll('button')].some(button => button.textContent === '取消下载')).toBe(false);
  const open = [...container.querySelectorAll('button')].find(button => button.textContent === '打开正在下载的任务')!;
  expect(open).toBeTruthy();
  await act(async () => open.click());
  expect(update).toHaveBeenCalledWith(99, { active: true });
});
it('removes cancellation controls as soon as ownership moves to a resumed task page', async () => {
  let changed!: (changes: Record<string, chrome.storage.StorageChange>, area: chrome.storage.AreaName) => void;
  vi.mocked(chrome.storage.onChanged.addListener).mockImplementation(fn => { changed = fn; });
  const batch: ArchiveBatch = { id: '', filename: 'test.zip', title: '', pageUrl: '', status: 'fetching', started: 1, updated: 1, bytes: 0, message: '', tabId: 1, items: [] };
  vi.mocked(readArchive).mockResolvedValue(batch);
  await act(async () => root.render(<App />));
  expect(container.textContent).toContain('取消下载');
  await act(async () => changed({ 'archiveBatch:': { newValue: { ...batch, tabId: 99 } } }, 'local'));
  expect(container.textContent).not.toContain('取消下载');
  expect(container.textContent).toContain('打开正在下载的任务');
});
it('still cancels the active owner controller', async () => {
  const batch: ArchiveBatch = { id: '', filename: 'test.zip', title: '', pageUrl: '', status: 'fetching', started: 1, updated: 1, bytes: 0, message: '', tabId: 1, items: [] };
  vi.mocked(readArchive).mockResolvedValue(batch);
  await act(async () => root.render(<App />));
  const signal = vi.mocked(runArchive).mock.calls[0]![1];
  const cancel = [...container.querySelectorAll('button')].find(button => button.textContent === '取消下载')!;
  await act(async () => cancel.click());
  expect(signal.aborted).toBe(true);
});

it('switches task language without restarting or aborting the download', async () => {
  const batch = { id: '', tabId: 1, filename: 'test.zip', status: 'fetching', bytes: 0, message: '已处理 0 / 1 张', items: [{ id: '1', filename: '001.jpg', status: 'pending' }] } as ArchiveBatch;
  vi.mocked(readArchive).mockResolvedValue(batch);
  await act(async () => root.render(<App />));
  const signal = vi.mocked(runArchive).mock.calls[0]![1];
  try {
    await act(async () => { await setLanguagePreference('en'); });
    expect(container.textContent).toContain('Fetching images…');
    expect(container.textContent).toContain('Cancel download');
    expect(runArchive).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(false);
  } finally { await act(async () => { await setLanguagePreference('zh-CN'); }); }
});
