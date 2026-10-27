// @vitest-environment happy-dom
import { act, Profiler } from 'react';
import { setLanguagePreference } from '../lib/i18n';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../entrypoints/popup/App';
import type { AnalysisState, ArchiveBatch, Request } from '../lib/types';
import { EXTRACTION_VERSION as ORIGINAL_RESOLVER_VERSION } from '../lib/extractionVersion';
import { toast } from '../components/ui/sonner';
import { loadPopupSnapshot } from '../entrypoints/popup/bootstrap';

vi.mock('../lib/downloadSpeed', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/downloadSpeed')>(),
  withDownloadSlot: vi.fn(async (_url: string, _signal: AbortSignal, work: () => Promise<unknown>) => work()),
  noteDownloadResponse: vi.fn(async () => {}),
}));

const results = ['海岸线', '城市日落', '山间晨光'].flatMap((label, index) => [true, false].map(candidate => ({
  id: (candidate ? 'L' : 'S') + index, label, candidate, reason: '', width: 0, height: 0,
  url: 'https://images.example/' + (candidate ? 'original' : 'thumb') + '/' + index + '.jpg',
  source: 'https://images.example/thumb/' + index + '.jpg',
})));
const fixture = (): AnalysisState => ({
  job: 'test', resolverVersion: ORIGINAL_RESOLVER_VERSION, tabId: 7, url: 'https://example.org/gallery', title: '测试图集', status: 'done', started: Date.now(),
  total: 3, truncated: false, message: '', results, selected: ['L0', 'L1', 'L2'], selectionMode: 'custom', selectionFilter: 'large',
});
let analysis: AnalysisState | undefined;
let root: Root | undefined;
let container: HTMLDivElement;
let send: ReturnType<typeof vi.fn>;
let request: ReturnType<typeof vi.fn>;
let local: Record<string, unknown>;
let popupSession: Record<string, unknown>;
type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
let listeners: Set<StorageListener>;
function changed(value: AnalysisState) {
  analysis = value;
  for (const listener of listeners) listener({ ['analysis:' + value.tabId]: { newValue: structuredClone(value) } }, 'session');
}
async function mount() {
  await act(async () => { root = createRoot(container); root.render(<App />); });
  await flushToasts();
}
async function flushToasts() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function click(selector: string) {
  const element = container.querySelector<HTMLButtonElement>(selector);
  expect(element, selector).not.toBeNull();
  await act(async () => { element!.click(); });
  await flushToasts();
}
async function chooseAction(selector: string) {
  const item = document.querySelector<HTMLElement>(selector);
  expect(item).not.toBeNull();
  await act(async () => { item!.click(); });
  await flushToasts();
}
async function openMore() {
  const trigger = container.querySelector<HTMLButtonElement>('.more-actions-button')!;
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
  expect(document.querySelector('[role=menu]')).not.toBeNull();
}
async function openExtractionOptions() {
  const trigger = container.querySelector<HTMLButtonElement>('.collection-options-trigger')!;
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
  await flushToasts();
  expect(document.querySelector('.collection-options[role=menu]')).not.toBeNull();
}
async function chooseMoreAction(selector: string) {
  await openMore();
  await chooseAction(selector);
}
async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type=search]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function expectDownloadCount(count: number) {
  expect(container.querySelector('.zip-button')?.getAttribute('aria-label')).toBe('下载所选内容（' + count + '）');
}
async function chooseType(label: string) {
  const checked = label === '仅原图';
  const control = container.querySelector<HTMLElement>('.original-mode-switch')!;
  if (control.getAttribute('aria-checked') !== String(checked)) await click('.original-mode-switch');
}
beforeEach(() => {
  analysis = fixture(); local = {}; popupSession = {}; listeners = new Set();
  container = document.createElement('div'); document.body.append(container);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  request = vi.fn(async () => true);
  send = vi.fn(async (message: Request) => {
    if (message.type === 'SAVE_POPUP_VIEW') await chrome.storage.session.set({ ['popupView:' + message.tabId]: message.view });
    if (message.type === 'SELECT' && analysis) changed({ ...analysis, selected: message.selected, selectionMode: message.mode || 'custom', selectionFilter: message.filter || analysis.selectionFilter });
    if (message.type === 'ANALYZE') changed({ ...fixture(), job: 'fresh', selected: [], selectionFilter: message.mode === 'large' ? 'large' : 'page' });
    return { ok: true };
  });
  vi.stubGlobal('chrome', {
    tabs: { query: async () => [{ id: 7, url: 'https://example.org/gallery', title: '测试图集' }], update: vi.fn(async () => ({ id: 99 })), create: vi.fn(async () => ({ id: 100 })) },
    storage: {
      session: { get: async () => ({ analysis, ...popupSession }), set: async (values: Record<string, unknown>) => { Object.assign(popupSession, structuredClone(values)); } }, local: { get: async () => local, set: async (values: Record<string, unknown>) => Object.assign(local, values) },
      onChanged: { addListener: (listener: StorageListener) => listeners.add(listener), removeListener: (listener: StorageListener) => listeners.delete(listener) },
    },
    runtime: { sendMessage: send, getURL: (path: string) => 'chrome-extension://test' + path }, permissions: { request },
  });
});
afterEach(async () => {
  await act(async () => { root?.unmount(); }); root = undefined;
  await setLanguagePreference('zh-CN');
  container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
it('automatically reads a new page once and reuses a matching cached analysis', async () => {
  analysis = undefined;
  await mount();
  expect(send.mock.calls.filter(([message]) => message.type === 'ANALYZE')).toEqual([[{ type: 'ANALYZE', tabId: 7 }]]);
  expectDownloadCount(0);
  await act(async () => root!.unmount()); root = undefined;
  await mount();
  expect(send.mock.calls.filter(([message]) => message.type === 'ANALYZE')).toHaveLength(1);
});
it('never commits a fake extracting or zero-image frame while restoring a delayed cache', async () => {
  let finish!: (value: Record<string, unknown>) => void;
  const cached = new Promise<Record<string, unknown>>(resolve => { finish = resolve; });
  chrome.storage.session.get = vi.fn(() => cached) as typeof chrome.storage.session.get;
  const frames: { busy: string | null; count: string | null; emptyFormats: boolean }[] = [];
  await act(async () => {
    root = createRoot(container);
    root.render(<Profiler id="popup" onRender={() => {
      if (container.querySelector('.gallery')) frames.push({
        busy: container.querySelector('.gallery')!.getAttribute('aria-busy'),
        count: container.querySelector('.visible-count')?.textContent || null,
        emptyFormats: !!container.querySelector('.format-empty'),
      });
    }}><App /></Profiler>);
  });
  expect(container.querySelector('.refresh-button')).toBeNull();
  expect(send.mock.calls.some(([message]) => message.type === 'ANALYZE')).toBe(false);
  await act(async () => { finish({ analysis }); });
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every(frame => frame.busy === 'false' && frame.count === '3 张原图' && !frame.emptyFormats)).toBe(true);
  expect(send.mock.calls.some(([message]) => message.type === 'ANALYZE')).toBe(false);
});
it('renders a preloaded cache and saved controls in its very first workspace frame', async () => {
  local = { imageView: 'list', downloadSpeed: 'high', collectOptions: { icons: false, css: false, inline: false } };
  const initialSnapshot = await loadPopupSnapshot();
  const frames: string[] = [];
  await act(async () => {
    root = createRoot(container);
    root.render(<Profiler id="popup" onRender={() => { frames.push(container.innerHTML); }}><App initialSnapshot={initialSnapshot} /></Profiler>);
  });
  expect(frames[0]).toContain('3 张原图');
  expect(frames[0]).not.toContain('正在读取页面');
  expect(frames[0]).not.toContain('暂无图像类型');
  expect(frames[0]).toContain('data-view="list"');
  expect(frames[0]).toContain('20 并发');
  expect(frames[0]).toContain('仅页面图像');
  expect(frames[0]).not.toContain('全部启用');
});
it.each(['done', 'running'] as const)('reconciles an extraction that became %s after a bootstrap cache miss', async status => {
  analysis = undefined;
  const snapshot = await loadPopupSnapshot();
  expect(snapshot.shouldAnalyze).toBe(true);
  analysis = { ...fixture(), status };
  await act(async () => { root = createRoot(container); root.render(<App initialSnapshot={snapshot} />); });
  await flushToasts();
  expect(send.mock.calls.some(([message]) => message.type === 'ANALYZE')).toBe(false);
  expect(analysis.job).toBe('test');
  if (status === 'done') expectDownloadCount(3);
  else expect(container.querySelector('.gallery')?.getAttribute('aria-busy')).toBe('true');
});
it('ignores a late mismatched analysis event without erasing the current selection', async () => {
  await mount();
  await act(async () => { changed({ ...fixture(), job: 'other-page', url: 'https://example.org/other' }); });
  expectDownloadCount(3);
  expect(container.querySelectorAll('.image-item')).toHaveLength(3);
});
it('reconciles an archive completed between bootstrap and event subscription', async () => {
  const batch: ArchiveBatch = { id: 'gap', sourceTabId: 7, pageUrl: fixture().url, title: 'test', filename: 'test.zip', items: [], status: 'fetching', started: Date.now(), updated: Date.now(), bytes: 0, message: '', tabId: 98 };
  local['archiveBatch:gap'] = batch;
  chrome.storage.local.get = vi.fn(async () => structuredClone(local)) as typeof chrome.storage.local.get;
  const snapshot = await loadPopupSnapshot();
  local['archiveBatch:gap'] = { ...batch, status: 'complete' };
  await act(async () => { root = createRoot(container); root.render(<App initialSnapshot={snapshot} />); });
  await flushToasts();
  expect(container.querySelector<HTMLButtonElement>('.zip-button')!.disabled).toBe(false);
});
it('lets a newer extraction event win over the bootstrap refresh read', async () => {
  analysis = undefined;
  const snapshot = await loadPopupSnapshot();
  let finish!: (value: Record<string, unknown>) => void;
  chrome.storage.session.get = vi.fn(() => new Promise<Record<string, unknown>>(resolve => { finish = resolve; })) as typeof chrome.storage.session.get;
  await act(async () => { root = createRoot(container); root.render(<App initialSnapshot={snapshot} />); });
  await act(async () => { changed(fixture()); finish({}); });
  await flushToasts();
  expect(send.mock.calls.some(([message]) => message.type === 'ANALYZE')).toBe(false);
  expectDownloadCount(3);
  expect(container.querySelector('.gallery')?.getAttribute('aria-busy')).toBe('false');
});
it.each(['complete', 'removed'] as const)('does not overwrite an archive %s event with an older refresh snapshot', async outcome => {
  const batch: ArchiveBatch = { id: 'refresh-race', sourceTabId: 7, pageUrl: fixture().url, title: 'test', filename: 'test.zip', items: [], status: 'fetching', started: Date.now(), updated: Date.now(), bytes: 0, message: '', tabId: 98 };
  const key = 'archiveBatch:refresh-race';
  local[key] = batch;
  const snapshot = await loadPopupSnapshot();
  let finish!: (value: Record<string, unknown>) => void;
  chrome.storage.local.get = vi.fn(async keys => keys === null
    ? new Promise<Record<string, unknown>>(resolve => { finish = resolve; }) : local) as typeof chrome.storage.local.get;
  await act(async () => { root = createRoot(container); root.render(<App initialSnapshot={snapshot} />); });
  const notify = vi.spyOn(toast, 'success');
  await act(async () => {
    for (const listener of listeners) listener({ [key]: { newValue: outcome === 'complete' ? { ...batch, status: 'complete' } : undefined } }, 'local');
    finish({ [key]: batch });
  });
  await flushToasts();
  expect(container.querySelector<HTMLButtonElement>('.zip-button')!.disabled).toBe(false);
  expect(notify).toHaveBeenCalledTimes(outcome === 'complete' ? 1 : 0);
});
it('reports the resumed task outcome without replaying a newer historical failure', async () => {
  const base = { sourceTabId: 7, pageUrl: fixture().url, title: 'test', filename: 'test.zip', items: [], updated: Date.now(), bytes: 0, message: '', tabId: 98 };
  const resumed: ArchiveBatch = { ...base, id: 'old-resumed', started: 100, launched: Date.now(), status: 'fetching' };
  const historical: ArchiveBatch = { ...base, id: 'later-failure', started: 200, status: 'failed', message: 'Old failure' };
  local['archiveBatch:old-resumed'] = resumed;
  local['archiveBatch:later-failure'] = historical;
  await mount();
  const success = vi.spyOn(toast, 'success');
  const error = vi.spyOn(toast, 'error');
  await act(async () => { for (const listener of listeners) listener({ 'archiveBatch:old-resumed': { newValue: { ...resumed, status: 'complete' } } }, 'local'); });
  await flushToasts();
  expect(error).not.toHaveBeenCalled();
  expect(success).toHaveBeenCalledOnce();
});
it('dispatches the latest position before closing even when an earlier save is pending', async () => {
  await mount();
  send.mockImplementation(message => message.type === 'SAVE_POPUP_VIEW' ? new Promise(() => {}) : Promise.resolve({ ok: true }));
  const scroller = container.querySelector<HTMLDivElement>('.image-list')!;
  await act(async () => { scroller.scrollTop = 100; scroller.dispatchEvent(new Event('scroll')); });
  await act(async () => { scroller.scrollTop = 385; scroller.dispatchEvent(new Event('scroll')); });
  await act(async () => root!.unmount()); root = undefined;
  const writes = send.mock.calls.map(([message]) => message).filter(message => message.type === 'SAVE_POPUP_VIEW');
  expect(writes.at(-1)).toMatchObject({ type: 'SAVE_POPUP_VIEW', view: { gallery: { scrollTop: 385 } } });
});
it('restores search, type exclusions, background, page and scroll position after closing the popup', async () => {
  analysis = { ...fixture(), results: Array.from({ length: 53 }, (_, index) => ({ ...results[0]!, id: String(index), label: '图像 ' + index, url: `https://images.example/photo-${index}.${index === 0 ? 'png' : 'jpg'}` })), selected: ['20'], total: 53 };
  await mount();
  await search('photo');
  await click('.format-filter[data-format="PNG"]');
  await click('.preview-background-control [role="checkbox"]');
  await click('[aria-label="下一页"]');
  const scroller = container.querySelector<HTMLDivElement>('.image-list')!;
  await act(async () => { scroller.scrollTop = 385; scroller.dispatchEvent(new Event('scroll')); });
  await flushToasts();
  expect(popupSession['popupView:7']).toMatchObject({ query: 'photo', excludedFormats: ['PNG'], darkPreview: true, gallery: { page: 1, scrollTop: 385 } });
  await act(async () => root!.unmount()); root = undefined;
  await mount();
  expect(send.mock.calls.some(([message]) => message.type === 'ANALYZE')).toBe(false);
  expect(container.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('photo');
  expect(container.querySelector('.format-filter[data-format="PNG"]')?.getAttribute('aria-pressed')).toBe('false');
  expect(container.querySelector('.preview-background-control [role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');
  expect(container.querySelector('.image-page-summary')?.textContent).toBe('2 / 3');
  expect(container.querySelector<HTMLDivElement>('.image-list')?.scrollTop).toBe(385);
  expectDownloadCount(1);
});
it('ignores view state from a different extraction and tolerates an unavailable view cache', async () => {
  popupSession['popupView:7'] = { job: 'older-job', query: 'missing', excludedFormats: ['JPG'], darkPreview: true };
  chrome.storage.session.set = vi.fn().mockRejectedValue(new Error('storage unavailable'));
  await mount();
  expect(container.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('');
  expect(container.querySelectorAll('.image-item')).toHaveLength(3);
  expect(container.querySelector('.preview-background-control [role="checkbox"]')?.getAttribute('aria-checked')).toBe('false');
  expect(send.mock.calls.some(([message]) => message.type === 'ANALYZE')).toBe(false);
});
it('does not cover an already decoded browser-cached thumbnail with a loading skeleton', async () => {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(200);
  await mount();
  expect(container.querySelectorAll('.image-item img')).toHaveLength(3);
  expect(container.querySelector('.thumbnail-loading')).toBeNull();
});
it('reuses an empty result and an in-flight extraction instead of starting another on reopen', async () => {
  for (const status of ['done', 'running'] as const) {
    analysis = { ...fixture(), status, results: [], selected: [], total: 0 };
    await mount();
    expect(send.mock.calls.some(([message]) => message.type === 'ANALYZE')).toBe(false);
    await act(async () => root!.unmount()); root = undefined;
  }
});
it('discards the saved view when the user explicitly extracts again', async () => {
  await mount();
  await search('海岸线');
  await click('.refresh-button');
  expect(send).toHaveBeenCalledWith({ type: 'ANALYZE', tabId: 7, mode: 'large' });
  expect(container.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('');
  expect(popupSession['popupView:7']).toMatchObject({ job: 'fresh', query: '', excludedFormats: [], gallery: { page: 0, scrollTop: 0 } });
});
it('shows only page URLs by default and switches to matched originals without combining the two', async () => {
  analysis = { ...fixture(), selected: ['S0', 'S1', 'S2'], selectionMode: 'custom', selectionFilter: 'page' };
  await mount();
  expect(container.querySelector('.image-type-select')).toBeNull();
  expect(container.querySelector('.original-mode-switch')?.getAttribute('aria-checked')).toBe('false');
  expect([...container.querySelectorAll('.item-checkbox')].map(el => el.id)).toEqual(['image-S0', 'image-S1', 'image-S2']);
  expect(container.querySelector('.kind-label')).toBeNull();
  await click('.original-mode-switch');
  expect(analysis).toMatchObject({ selectionMode: 'custom', selected: ['S0', 'S1', 'S2'], selectionFilter: 'large' });
  expect([...container.querySelectorAll('.item-checkbox')].map(el => el.id)).toEqual(['image-L0', 'image-L1', 'image-L2']);
  await click('.original-mode-switch');
  expect(analysis).toMatchObject({ selectionMode: 'custom', selected: ['S0', 'S1', 'S2'], selectionFilter: 'page' });
});
it('shows an empty matching state without falling back to page images', async () => {
  const pageImages = results.filter(item => !item.candidate);
  analysis = { ...fixture(), results: pageImages, selected: pageImages.map(item => item.id), selectionMode: 'page', selectionFilter: 'page' };
  await mount();
  await click('.original-mode-switch');
  expect(container.querySelectorAll('.image-item')).toHaveLength(0);
  expect(container.querySelector('.empty [data-slot=empty-title]')?.textContent).toBe('未匹配到原图');
  expectDownloadCount(0);
  await click('.empty button');
  expect(container.querySelectorAll('.image-item')).toHaveLength(3);
});
it('does not include hidden converted URLs in page-mode copy or download', async () => {
  analysis = { ...fixture(), selected: ['L0', 'S0'], selectionMode: 'custom', selectionFilter: 'page' };
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await mount();
  expectDownloadCount(1);
  await click('.copy-links-button');
  expect(writeText).toHaveBeenCalledWith(results.find(item => item.id === 'S0')!.url);
  await click('.zip-button');
  expect(send).toHaveBeenCalledWith({ type: 'DOWNLOAD', job: 'test', selected: ['S0'] });
  expect(request).toHaveBeenCalledWith({ permissions: ['downloads'] });
});
it('restores the returned analysis even when no storage event arrives', async () => {
  analysis = undefined;
  send.mockImplementation(async () => ({ ok: true, analysis: fixture() }));
  await mount();
  expectDownloadCount(3);
  expect(container.textContent).not.toContain('准备读取页面');
});
it('reads the stored result when an older worker returns only ok without an event', async () => {
  analysis = undefined;
  send.mockImplementation(async () => { analysis = fixture(); return { ok: true }; });
  await mount();
  expectDownloadCount(3);
});
it('explains a worker version mismatch instead of claiming the page has no images', async () => {
  analysis = undefined;
  send.mockImplementation(async () => {
    changed({ ...fixture(), resolverVersion: 'host-path-originals-v5:sources-v2' });
    return { ok: true };
  });
  await mount();
  expect(container.querySelector('.empty [data-slot=empty-description]')?.textContent).toContain('插件后台与界面版本不一致');
  expect(container.textContent).not.toContain('准备读取页面');
});
it.each([undefined, { ...fixture(), status: 'running' }, { ...fixture(), url: 'https://example.org/another' }])('shows an incomplete result error instead of an empty gallery', async incomplete => {
  analysis = undefined;
  send.mockImplementation(async () => ({ ok: true, analysis: incomplete }));
  await mount();
  expect(container.querySelector('.empty [data-slot=empty-description]')?.textContent).toContain('页面读取未返回完整结果');
});
it.each([undefined, 'host-path-originals-v4'])('reanalyzes cached results from an outdated rule version: %s', async resolverVersion => {
  analysis = { ...fixture(), resolverVersion };
  await mount();
  expect(send.mock.calls.filter(([message]) => message.type === 'ANALYZE')).toEqual([[{ type: 'ANALYZE', tabId: 7 }]]);
  expect(analysis?.resolverVersion).toBe(ORIGINAL_RESOLVER_VERSION);
  expect(analysis?.job).toBe('fresh');
  expectDownloadCount(0);
});
it('restores custom small-image selection and the display preference after reopening', async () => {
  analysis = { ...fixture(), selected: ['S1'], selectionMode: 'custom', selectionFilter: 'page' };
  local.imageView = 'list';
  await mount();
  expect(send.mock.calls.some(([message]) => message.type === 'ANALYZE')).toBe(false);
  expect(container.querySelector('.original-mode-switch')?.getAttribute('aria-checked')).toBe('false');
  expect(container.querySelector('.image-list')?.getAttribute('data-view')).toBe('list');
  expectDownloadCount(1);
  expect(container.querySelector('#image-S1')?.getAttribute('aria-checked')).toBe('true');
});
it('keeps hidden selections when searching and toggling a visible image', async () => {
  await mount();
  await search('海岸线');
  expect(container.querySelectorAll('.image-item')).toHaveLength(1);
  expectDownloadCount(3);
  await click('#image-L0');
  expect(analysis!.selected).toEqual(['L1', 'L2']);
  await search('');
  expect(container.querySelectorAll('.image-item')).toHaveLength(3);
  expectDownloadCount(2);
});
it('select all adds the displayed images, keeps hidden choices and is safe to repeat', async () => {
  analysis = { ...fixture(), selected: ['L1', 'L2'], selectionMode: 'custom' };
  await mount();
  await search('海岸线');
  await click('.select-all-button');
  expect(analysis!.selected).toEqual(['L1', 'L2', 'L0']);
  expect(container.querySelector('.visible-count')?.textContent).toBe('1 / 3 张原图');
  await click('.select-all-button');
  expect(analysis!.selected).toEqual(['L1', 'L2', 'L0']);
  expectDownloadCount(3);
});
it('cancel all clears hidden choices while preserving displayed images, search and type', async () => {
  analysis = { ...fixture(), selected: ['L0', 'L1', 'S2'], selectionMode: 'custom' };
  await mount();
  await search('海岸线');
  await click('.deselect-all-button');
  expect(analysis).toMatchObject({ selected: [], selectionMode: 'custom', selectionFilter: 'large' });
  expect(container.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('海岸线');
  expect(container.querySelectorAll('.image-item')).toHaveLength(1);
  expect(container.querySelector('#image-L0')?.getAttribute('aria-checked')).toBe('false');
  for (const selector of ['.deselect-all-button', '.zip-button']) {
    expect(container.querySelector<HTMLButtonElement>(selector)?.disabled, selector).toBe(true);
  }
  expect(container.querySelector<HTMLButtonElement>('.copy-links-button')?.disabled).toBe(true);
  for (const selector of ['.export-links-button']) expect(document.querySelector<HTMLButtonElement>(selector)?.disabled).toBe(true);
  await act(async () => root!.unmount()); root = undefined;
  await mount();
  expectDownloadCount(0);
  expect(container.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('海岸线');
  expect(container.querySelectorAll('.image-item')).toHaveLength(1);
});
it('can cancel every selection even when the current search has no results', async () => {
  await mount();
  await search('没有匹配');
  expect(container.querySelector<HTMLButtonElement>('.select-all-button')?.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('.deselect-all-button')?.disabled).toBe(false);
  await click('.deselect-all-button');
  expect(analysis!.selected).toEqual([]);
  expect(container.querySelector('.empty [data-slot=empty-title]')?.textContent).toBe('没有符合条件的图像');
  await click('.empty button');
  expect(container.querySelectorAll('.image-item')).toHaveLength(3);
  expectDownloadCount(0);
});
it('keeps explicit choices across modes and counts only the current mode', async () => {
  await mount();
  await chooseType('仅缩略图');
  expect(analysis).toMatchObject({ selected: ['L0', 'L1', 'L2'], selectionFilter: 'page', selectionMode: 'custom' });
  await click('#image-S0');
  expect(analysis).toMatchObject({ selected: ['L0', 'L1', 'L2', 'S0'], selectionFilter: 'page', selectionMode: 'custom' });
  await search('找不到的图像');
  expect(container.querySelector('.empty [data-slot=empty-title]')?.textContent).toBe('没有符合条件的图像');
  expectDownloadCount(1);
  await click('.empty button');
  expect(container.querySelectorAll('.image-item')).toHaveLength(3);
});
it('filters several formats without losing hidden selections and resets an empty format filter', async () => {
  const mixed = results.map((item, index) => ({ ...item, url: item.url.replace('.jpg', ['.png', '.png', '.jpeg', '.jpeg', '.svg', '.svg'][index]!) }));
  analysis = { ...fixture(), results: mixed };
  await mount();
  expect(container.querySelector('.format-filter[data-format=JPG]')?.textContent).toBe('JPG(1)');
  expect(container.querySelector('.format-filter[data-format=PNG]')?.textContent).toBe('PNG(1)');
  expect(container.querySelector('.format-filter[data-format=SVG]')?.textContent).toBe('SVG(1)');
  await click('.format-filter[data-format=SVG]');
  expect([...container.querySelectorAll('.image-item')].map(item => item.querySelector('.format-badge')?.textContent)).toEqual(['PNG', 'JPG']);
  expect(container.querySelector('.format-filter[data-format=SVG]')?.getAttribute('aria-pressed')).toBe('false');
  expect(container.querySelector('.sidebar-group-heading button')).toBeNull();
  expectDownloadCount(3);
  await click('#image-L0');
  await click('#image-L1');
  expect(analysis!.selected).toEqual(['L2']);
  expectDownloadCount(1);
  await click('.select-all-button');
  expect(new Set(analysis!.selected)).toEqual(new Set(['L0', 'L1', 'L2']));
  await search('海岸线');
  expect(container.querySelectorAll('.image-item')).toHaveLength(1);
  await click('.deselect-all-button');
  expect(analysis!.selected).toEqual([]);
  await search('');
  await click('.format-filter[data-format=PNG]');
  await click('.format-filter[data-format=JPG]');
  expect(container.querySelector('.empty [data-slot=empty-title]')?.textContent).toBe('没有符合条件的图像');
  await click('.empty button');
  expect(container.querySelectorAll('.image-item')).toHaveLength(3);
  expect(container.querySelectorAll('.format-filter[aria-pressed=true]')).toHaveLength(3);
  expectDownloadCount(0);
});
it('changing image mode clears format restrictions without adding selections', async () => {
  await mount();
  await click('.format-filter[data-format=JPG]');
  expect(container.querySelectorAll('.image-item')).toHaveLength(0);
  await chooseType('全部（缩略图＋原图）');
  expect(analysis).toMatchObject({ selected: ['L0', 'L1', 'L2'], selectionMode: 'custom', selectionFilter: 'page' });
  expect(container.querySelector('.format-filter[data-format=JPG]')?.textContent).toBe('JPG(3)');
  expect(container.querySelectorAll('.image-item')).toHaveLength(3);
  expectDownloadCount(0);
});
it('selects from card padding and toggles a label exactly once', async () => {
  await mount();
  await click('.image-item');
  expect(analysis!.selected).toEqual(['L1', 'L2']);
  await click('.image-detail');
  expect(new Set(analysis!.selected)).toEqual(new Set(['L0', 'L1', 'L2']));
});
it('selects thumbnails without opening a preview dialog and persists list view', async () => {
  await mount();
  expect(container.querySelector('.item-preview')).toBeNull();
  await click('.thumbnail img');
  expect(analysis!.selected).toEqual(['L1', 'L2']);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('[aria-label="列表视图"]');
  expect(local.imageView).toBe('list');
  expect(container.querySelector('.image-list')?.getAttribute('data-view')).toBe('list');
  expect(analysis!.selected).toEqual(['L1', 'L2']);
});
it('requests permission from the click before starting a ZIP with the chosen images', async () => {
  await mount();
  await click('.zip-button');
  expect(request).toHaveBeenCalledWith({ permissions: ['downloads'], origins: ['https://images.example/*'] });
  expect(send).toHaveBeenCalledWith({ type: 'DOWNLOAD_ZIP', job: 'test', selected: ['L0', 'L1', 'L2'] });
  const zipCall = send.mock.calls.findIndex(([message]) => message.type === 'DOWNLOAD_ZIP');
  expect(request.mock.invocationCallOrder[0]!).toBeLessThan(send.mock.invocationCallOrder[zipCall]!);
});
it('copies one card URL without altering the batch selection', async () => {
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await mount();
  await click('.item-copy');
  expect(writeText).toHaveBeenCalledWith(results[0]!.url);
  expect(analysis!.selected).toEqual(['L0', 'L1', 'L2']);
  expect(send.mock.calls.some(([message]) => message.type === 'SELECT')).toBe(false);
  expect(container.textContent).toContain('已复制 1 个图像链接');
});
it('downloads one card directly without changing selection or requesting host access', async () => {
  await mount();
  await click('.item-download');
  expect(request).toHaveBeenCalledWith({ permissions: ['downloads'] });
  expect(send).toHaveBeenCalledWith({ type: 'DOWNLOAD', job: 'test', selected: ['L0'] });
  expect(analysis!.selected).toEqual(['L0', 'L1', 'L2']);
  const downloadCall = send.mock.calls.findIndex(([message]) => message.type === 'DOWNLOAD');
  expect(request.mock.invocationCallOrder[0]!).toBeLessThan(send.mock.invocationCallOrder[downloadCall]!);
  expect(container.querySelector('[data-sonner-toast]')?.textContent).toContain('已发起图片下载');
  expect(container.querySelector('.item-download')?.getAttribute('title')).toBe('直接下载这张图像');
});
it('loads only the page thumbnail and never presents its size as original resolution', async () => {
  await mount();
  const image = container.querySelector<HTMLImageElement>('.thumbnail img')!;
  Object.defineProperties(image, { naturalWidth: { value: 16 }, naturalHeight: { value: 16 } });
  await act(async () => { image.dispatchEvent(new Event('load')); });
  expect(container.querySelector('.thumbnail-dimensions')).toBeNull();
  expect(container.querySelector('.item-preview')).toBeNull();
  expect(image.getAttribute('src')).toBe(results[0]!.source);
  expect(image.closest('.thumbnail')?.querySelector('.thumbnail-loading')).toBeNull();
  expect(analysis!.selected).toEqual(['L0', 'L1', 'L2']);
});
it('leaves no live storage listener after the popup closes', async () => {
  await mount(); expect(listeners.size).toBeGreaterThan(0);
  await act(async () => root!.unmount()); root = undefined;
  expect(listeners.size).toBe(0);
});
it('paginates a thousand images in complete 20-card pages and keeps keyboard navigation', async () => {
  analysis = { ...fixture(), results: Array.from({ length: 1000 }, (_, index) => ({ ...results[0]!, id: String(index), label: '图像 ' + index })), selected: ['0'], total: 1000 };
  await mount();
  const activeCards = () => container.querySelectorAll('.image-cards[data-visible=true] .image-item');
  expect(activeCards()).toHaveLength(20);
  expect(container.querySelector('.image-page-summary')?.textContent).toBe('1 / 50');
  expect(container.querySelector('.results-count-group .image-pagination')).not.toBeNull();
  expect(container.querySelectorAll('.image-pagination button')).toHaveLength(2);
  expect(container.querySelector('.image-gallery > .image-pagination')).toBeNull();
  expect(container.querySelector<HTMLButtonElement>('[aria-label="上一页"]')?.disabled).toBe(true);
  container.querySelector<HTMLButtonElement>('#image-0')!.focus();
  await act(async () => { container.querySelector('#image-0')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); });
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(document.activeElement?.id).toBe('image-999');
  expect(activeCards()).toHaveLength(20);
  expect(container.querySelector('.image-page-summary')?.textContent).toBe('50 / 50');
  expect(container.querySelector<HTMLButtonElement>('[aria-label="下一页"]')?.disabled).toBe(true);
  await click('#image-999');
  expect(analysis!.selected).toEqual(['0', '999']);
});

it.each(['grid', 'list'])('keeps all current-page cards mounted while scrolling and reuses recent pages in %s view', async view => {
  analysis = { ...fixture(), results: Array.from({ length: 1000 }, (_, index) => ({ ...results[0]!, id: String(index), source: `https://images.example/thumb/${index}.jpg` })), selected: [], total: 1000 };
  local.imageView = view;
  await mount();
  const firstCard = container.querySelector<HTMLElement>('.image-item')!;
  const image = firstCard.querySelector<HTMLImageElement>('img')!;
  const initialCards = [...container.querySelectorAll('.image-item')];
  expect(initialCards).toHaveLength(20);
  expect([...container.querySelectorAll('.image-item img')].every(img => img.getAttribute('loading') === 'lazy')).toBe(true);
  await act(async () => { image.dispatchEvent(new Event('load')); });
  const scroller = container.querySelector<HTMLDivElement>('.image-list')!;
  await act(async () => { scroller.scrollTop = 3000; scroller.dispatchEvent(new Event('scroll')); });
  expect([...container.querySelectorAll('.image-item')]).toEqual(initialCards);
  expect(container.querySelector('.image-page-summary')?.textContent).toBe('1 / 50');
  await click('[aria-label="下一页"]');
  expect(scroller.scrollTop).toBe(0);
  expect(container.querySelector('.image-cards[data-page="1"]')?.getAttribute('style')).toContain('display: none');
  await click('[aria-label="上一页"]');
  expect(container.querySelector('.image-cards[data-visible=true] img')).toBe(image);
  expect(firstCard.querySelector('.thumbnail-loading')).toBeNull();
  for (let page = 0; page < 3; page++) await click('[aria-label="下一页"]');
  expect(container.querySelectorAll('.image-cards')).toHaveLength(3);
  expect(container.querySelectorAll('.image-item')).toHaveLength(60);
  expect(container.contains(image)).toBe(false);
});

it('preserves cross-page selections and applies select-all to all filtered images', async () => {
  analysis = { ...fixture(), results: Array.from({ length: 53 }, (_, index) => ({ ...results[0]!, id: String(index), label: 'image-' + index })), selected: [], total: 53 };
  await mount();
  await click('#image-0');
  await click('[aria-label="下一页"]');
  await click('#image-20');
  await click('[aria-label="下一页"]');
  expect(container.querySelectorAll('.image-cards[data-visible=true] .image-item')).toHaveLength(13);
  await click('#image-52');
  expect(analysis!.selected).toEqual(['0', '20', '52']);
  expectDownloadCount(3);
  await click('[aria-label="列表视图"]');
  expect(container.querySelector('.image-page-summary')?.textContent).toBe('3 / 3');
  await click('.select-all-button');
  expect(analysis!.selected).toHaveLength(53);
  expectDownloadCount(53);
  await search('image-0');
  expect(container.querySelectorAll('.image-item')).toHaveLength(1);
  expect(container.querySelector('.image-pagination')).toBeNull();
  expect(analysis!.selected).toHaveLength(53);
  await search('');
  expect(container.querySelector('.image-page-summary')?.textContent).toBe('1 / 3');
});

it('returns to the first page when a type filter changes the displayed results', async () => {
  analysis = { ...fixture(), results: Array.from({ length: 53 }, (_, index) => ({ ...results[0]!, id: String(index), url: `https://images.example/image-${index}.${index % 2 ? 'jpg' : 'png'}` })), selected: [], total: 53 };
  await mount();
  await click('[aria-label="下一页"]');
  await click('[aria-label="下一页"]');
  await click('.format-filter[data-format=JPG]');
  expect(container.querySelector('.image-page-summary')?.textContent).toBe('1 / 2');
  expect(container.querySelector('.image-page-summary')?.getAttribute('aria-label')).toBe('第 1 页，共 2 页');
  expect(container.querySelectorAll('.image-item')).toHaveLength(20);
  expect([...container.querySelectorAll('.format-badge')].every(badge => badge.textContent === 'PNG')).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('[aria-label="上一页"]')?.disabled).toBe(true);
});

it('localizes pagination controls and the page count in English', async () => {
  await setLanguagePreference('en');
  analysis = { ...fixture(), results: Array.from({ length: 21 }, (_, index) => ({ ...results[0]!, id: String(index) })), selected: [], total: 21 };
  await mount();
  expect(container.querySelector('[aria-label="Image pagination"]')).not.toBeNull();
  expect(container.querySelector('.image-page-summary')?.textContent).toBe('1 / 2');
  expect(container.querySelector('.image-page-summary')?.getAttribute('aria-label')).toBe('Page 1 of 2');
  await click('[aria-label="Next page"]');
  expect(container.querySelectorAll('.image-cards[data-visible=true] .image-item')).toHaveLength(1);
  expect(container.querySelector('.image-page-summary')?.textContent).toBe('2 / 2');
});

it('copies the full selection from the sidebar, including search-hidden images', async () => {
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await mount();
  await search('海岸线');
  await click('.copy-links-button');
  expect(writeText).toHaveBeenCalledWith(results.filter(item => item.candidate).map(item => item.url).join('\n'));
  expect(analysis!.selected).toEqual(['L0', 'L1', 'L2']);
  expect(document.querySelector('[role=menu]')).toBeNull();
});
it('exports selected URLs using the page title from the visible sidebar button', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  let filename = '';
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { filename = this.download; });
  await mount();
  await chooseAction('.export-links-button');
  expect(filename).toBe('测试图集.txt');
  const blob = create.mock.calls[0]![0] as Blob;
  expect(await blob.text()).toBe(results.filter(item => item.candidate).map(item => item.url).join('\n') + '\n');
  expect(analysis!.selected).toEqual(['L0', 'L1', 'L2']);
});
it.each(['complete', 'fetching'] as const)('keeps the task accessible in More when the archive is %s', async status => {
  const batch: ArchiveBatch = { id: 'zip', title: '测试图集', filename: '测试图集.zip', pageUrl: 'https://example.org/gallery', items: [], status, started: Date.now(), updated: Date.now(), bytes: 0, message: '正在下载图像', sourceTabId: 7, tabId: 99 };
  local.archiveBatch = batch;
  await mount();
  expect(container.querySelector<HTMLButtonElement>('.zip-button')!.disabled).toBe(status === 'fetching');
  await openMore();
  expect(document.querySelector('.view-task-button')?.hasAttribute('data-disabled')).toBe(false);
  await chooseAction('.view-task-button');
  expect(send).toHaveBeenCalledWith({ type: 'OPEN_ARCHIVES' });
});

it('opens the shared task overview even when the current webpage has no task', async () => {
  await mount();
  expect(container.querySelector('.view-task-button')).toBeNull();
  await chooseMoreAction('.view-task-button');
  expect(send).toHaveBeenCalledWith({ type: 'OPEN_ARCHIVES' });
});

it('keeps scroll extraction visible and opens batch tools from More', async () => {
  await mount();
  await click('.scroll-extract-button');
  expect(send).toHaveBeenCalledWith({ type: 'ANALYZE', tabId: 7, mode: 'large', scroll: true });
  expect(container.querySelector('.batch-tools-button')).toBeNull();
  await chooseMoreAction('.batch-tools-button');
  expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test/tools.html' });
});
it('resumes a cancelled archive from More', async () => {
  const batch: ArchiveBatch = { id: 'cancelled', sourceTabId: 7, pageUrl: fixture().url, title: '当前页', filename: 'own.zip', items: [
    { id: 'cached', url: 'https://images.example/a.jpg', kind: 'large', filename: '001.jpg', status: 'complete', bytes: 100 },
    { id: 'pending', url: 'https://images.example/b.jpg', kind: 'large', filename: '002.jpg', status: 'pending' },
  ], status: 'cancelled', started: Date.now(), updated: Date.now(), cacheUntil: Date.now() + 60000, bytes: 100, message: '', tabId: 98 };
  local['archiveBatch:cancelled'] = batch;
  await mount();
  await chooseMoreAction('[aria-label="继续未完成下载"]');
  expect(request).toHaveBeenCalledWith({ permissions: ['downloads'], origins: ['https://images.example/*'] });
  expect(send).toHaveBeenCalledWith({ type: 'RESUME_ARCHIVE', batchId: 'cancelled' });
});
it('shows unselected page images when a new analysis has no originals', async () => {
  analysis = undefined;
  const thumbs = results.filter(item => !item.candidate);
  send.mockImplementation(async (message: Request) => {
    if (message.type === 'ANALYZE') changed({ ...fixture(), results: thumbs, selected: thumbs.map(item => item.id), selectionMode: 'all', selectionFilter: 'all' });
    return { ok: true };
  });
  await mount();
  expect(send).toHaveBeenCalledWith({ type: 'ANALYZE', tabId: 7 });
  expect(container.querySelector('.original-mode-switch')?.getAttribute('aria-checked')).toBe('false');
  expect(container.querySelectorAll('.image-item')).toHaveLength(3);
  expectDownloadCount(0);
});
it('disables duplicate extraction while showing busy text and then completion feedback', async () => {
  await mount();
  let finish!: () => void;
  send.mockImplementation(async (message: Request) => {
    if (message.type === 'ANALYZE') {
      changed({ ...fixture(), job: 'extracting', status: 'running', results: [], selected: [] });
      await new Promise<void>(resolve => { finish = resolve; });
      changed({ ...fixture(), job: 'extracted' });
    }
    return { ok: true };
  });
  await click('.refresh-button');
  const button = container.querySelector<HTMLButtonElement>('.refresh-button')!;
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(button.textContent).toBe('提取中…');
  await click('.refresh-button');
  expect(send.mock.calls.filter(([message]) => message.type === 'ANALYZE')).toHaveLength(1);
  await act(async () => { finish(); });
  expect(button.disabled).toBe(false);
  expect(button.getAttribute('aria-busy')).toBe('false');
  expect(button.textContent).toBe('提取完成');
  expectDownloadCount(3);
});

it.each([
  { width: 498, columns: 3 },
  { width: 400, columns: 2 },
  { width: 290, columns: 1 },
])('keeps keyboard navigation aligned at $columns columns and crosses page boundaries', async ({ width, columns }) => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  analysis = { ...fixture(), results: Array.from({ length: 53 }, (_, index) => ({ ...results[0]!, id: String(index), label: '图像 ' + index })), selected: [], total: 53 };
  await mount();
  const move = async (id: number, key: string) => {
    await act(async () => { container.querySelector('#image-' + id)!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  };
  await move(0, 'ArrowDown');
  expect(document.activeElement?.id).toBe('image-' + columns);
  await move(19, 'ArrowRight');
  expect(document.activeElement?.id).toBe('image-20');
  expect(container.querySelector('.image-page-summary')?.textContent).toBe('2 / 3');
  await move(20, 'End');
  expect(document.activeElement?.id).toBe('image-52');
  expect(container.querySelectorAll('.image-cards[data-visible=true] .image-item')).toHaveLength(13);
  await move(52, 'Home');
  expect(document.activeElement?.id).toBe('image-0');
});

it.each([
  { sourceTabId: 8, pageUrl: 'https://example.org/gallery' },
  { sourceTabId: 7, pageUrl: 'https://example.org/another-page' },
  { sourceTabId: undefined, pageUrl: 'https://example.org/gallery' },
])('does not inherit another page task on open or storage updates: %j', async owner => {
  const batch: ArchiveBatch = { id: 'foreign', title: '页面 A', filename: 'A.zip', items: [], status: 'fetching', started: Date.now(), updated: Date.now(), bytes: 0, message: '正在下载 A', tabId: 99, ...owner };
  local['archiveBatch:foreign'] = batch;
  await mount();
  expectDownloadCount(3);
  expect(container.querySelector<HTMLButtonElement>('.zip-button')!.disabled).toBe(false);
  expect(container.querySelector('.archive-progress')).toBeNull();
  await act(async () => {
    for (const listener of listeners) listener({ 'archiveBatch:foreign': { newValue: { ...batch, message: 'A 的新进度' } } }, 'local');
  });
  expectDownloadCount(3);
  expect(container.querySelector('.archive-progress')).toBeNull();
  expect(container.querySelector('[data-sonner-toast]')).toBeNull();
  await click('.zip-button');
  expect(send).toHaveBeenCalledWith({ type: 'DOWNLOAD_ZIP', job: 'test', selected: ['L0', 'L1', 'L2'] });
  await openMore();
  expect(document.querySelector('.view-task-button')?.hasAttribute('data-disabled')).toBe(false);
});
it('retains the current page progress and task link while another page updates or completes', async () => {
  const own: ArchiveBatch = { id: 'own', sourceTabId: 7, pageUrl: 'https://example.org/gallery', title: '当前页', filename: 'own.zip', items: [], status: 'fetching', started: Date.now(), updated: Date.now(), bytes: 0, message: '当前页下载中', tabId: 98 };
  local['archiveBatch:own'] = own;
  await mount();
  await act(async () => {
    for (const listener of listeners) {
      listener({ 'archiveBatch:other': { newValue: { ...own, id: 'other', sourceTabId: 8, status: 'complete', tabId: 99 } } }, 'local');
      listener({ 'analysis:8': { newValue: { ...fixture(), tabId: 8, job: 'other-analysis' } } }, 'session');
    }
  });
  expect(container.querySelector<HTMLButtonElement>('.zip-button')!.disabled).toBe(true);
  expect(container.querySelector('.download-selection')?.textContent).not.toContain('正在获取图像');
  expect(container.querySelector('[data-sonner-toast]')).toBeNull();
  expect(container.querySelectorAll('.image-item')).toHaveLength(3);
  await chooseMoreAction('.view-task-button');
  expect(send).toHaveBeenCalledWith({ type: 'OPEN_ARCHIVES' });
  await act(async () => {
    for (const listener of listeners) listener({ 'archiveBatch:own': { newValue: { ...own, status: 'complete' } } }, 'local');
  });
  await flushToasts();
  expectDownloadCount(3);
  expect(container.querySelector<HTMLButtonElement>('.zip-button')!.disabled).toBe(false);
  expect(container.querySelector('[data-sonner-toast]')?.textContent).toContain('下载完成');
  expect(container.querySelector('.download-selection')?.textContent).not.toContain('下载完成');
});

it('retries a failed thumbnail without changing selection or requesting the original', async () => {
  await mount();
  send.mockClear();
  const image = container.querySelector<HTMLImageElement>('.thumbnail img')!;
  await act(async () => image.dispatchEvent(new Event('error')));
  expect(container.querySelector('.thumbnail')?.textContent).toContain('加载失败');
  expect(container.querySelector('.thumbnail')?.querySelector('.thumbnail-loading')).toBeNull();
  await click('.thumbnail-fallback button');
  const retry = container.querySelector<HTMLImageElement>('.thumbnail img')!;
  expect(retry).not.toBe(image);
  expect(retry.src).toBe(results[0]!.source);
  expect(analysis!.selected).toEqual(['L0', 'L1', 'L2']);
  expect(send).not.toHaveBeenCalled();
  await act(async () => retry.dispatchEvent(new Event('load')));
  expect(container.querySelector('.thumbnail')?.querySelector('.thumbnail-loading')).toBeNull();
  await act(async () => retry.dispatchEvent(new Event('error')));
  expect(container.querySelector('.thumbnail-fallback button')).not.toBeNull();
});
it.each(['packing', 'saving', 'partial', 'failed', 'cancelled'] as const)('does not replay stored %s feedback or add sidebar progress on open', async status => {
  const batch: ArchiveBatch = { id: 'own', sourceTabId: 7, pageUrl: fixture().url, title: '当前页', filename: 'own.zip', items: [
    { id: '1', url: results[0]!.url, kind: 'large', filename: '001.jpg', status: 'complete' },
    { id: '2', url: results[2]!.url, kind: 'large', filename: '002.jpg', status: 'failed', error: 'HTTP 404' },
  ], status, started: Date.now(), updated: Date.now(), bytes: 10, message: '网络中断，请重试。', tabId: 98 };
  local['archiveBatch:own'] = batch;
  await mount();
  expect(container.querySelector('.workspace-sidebar [role=progressbar]')).toBeNull();
  expect(container.querySelector('.archive-progress')).toBeNull();
  expect(container.querySelector('[aria-label="查看下载详情"]')).toBeNull();
  expect(container.querySelector('[data-sonner-toast]')).toBeNull();
  await chooseMoreAction('.view-task-button');
  expect(send).toHaveBeenCalledWith({ type: 'OPEN_ARCHIVES' });
  expect(container.querySelector<HTMLButtonElement>('.zip-button')!.disabled).toBe(status === 'packing' || status === 'saving');
});

it.each([
  { status: 'complete', type: 'success', title: '下载完成' },
  { status: 'partial', type: 'warning', title: '部分图像下载失败' },
  { status: 'failed', type: 'error', title: '下载失败' },
  { status: 'cancelled', type: 'info', title: '下载已取消' },
] as const)('shows one $type toast for a new $status result without changing the sidebar', async ({ status, type, title }) => {
  const batch: ArchiveBatch = { id: 'own', sourceTabId: 7, pageUrl: fixture().url, title: '当前页', filename: 'own.zip', items: [
    { id: '1', url: results[0]!.url, kind: 'large', filename: '001.jpg', status: 'complete' },
    { id: '2', url: results[2]!.url, kind: 'large', filename: '002.jpg', status: 'failed' },
  ], status: 'fetching', started: Date.now(), updated: Date.now(), bytes: 10, message: '网络中断，请重试。', tabId: 98 };
  local['archiveBatch:own'] = batch;
  await mount();
  const notify = vi.spyOn(toast, type);
  async function update(next: ArchiveBatch) {
    await act(async () => { for (const listener of listeners) listener({ 'archiveBatch:own': { newValue: next } }, 'local'); });
    await flushToasts();
  }
  await update({ ...batch, status });
  expect(container.querySelector(`[data-sonner-toast][data-type=${type}]`)?.textContent).toContain(title);
  if (status === 'failed') expect(container.querySelector('[data-sonner-toast]')?.textContent).toContain('网络中断');
  if (status === 'partial') expect(container.querySelector('[data-sonner-toast]')?.textContent).toContain('ZIP 已保存');
  expect(container.querySelector('.download-selection')?.textContent).toBe('下载全选取消全选');
  expect(container.querySelector('.workspace-sidebar [role=progressbar]')).toBeNull();
  await update({ ...batch, status, updated: Date.now() + 1 });
  expect(notify).toHaveBeenCalledTimes(1);
  expect(analysis!.selected).toEqual(['L0', 'L1', 'L2']);
});

it('shows a new task notification once while keeping per-image progress in the task page', async () => {
  await mount();
  const info = vi.spyOn(toast, 'info');
  const batch: ArchiveBatch = { id: 'new', sourceTabId: 7, pageUrl: fixture().url, title: '当前页', filename: 'own.zip', items: [], status: 'queued', started: Date.now(), updated: Date.now(), bytes: 0, message: '', tabId: 98 };
  for (const status of ['queued', 'fetching', 'fetching', 'packing', 'saving'] as const) {
    await act(async () => { for (const listener of listeners) listener({ 'archiveBatch:new': { newValue: { ...batch, status, updated: Date.now() } } }, 'local'); });
    await flushToasts();
  }
  expect(info).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-sonner-toast]')?.textContent).toContain('下载任务已开始');
  expect(container.querySelector('.workspace-sidebar [role=progressbar]')).toBeNull();
  expect(container.querySelector('[data-sonner-toast] button[aria-label="关闭提示"]')).not.toBeNull();
});

it('retries the current task failure snapshot regardless of the current selection', async () => {
  const batch: ArchiveBatch = { id: 'partial', sourceTabId: 7, pageUrl: fixture().url, title: '当前页', filename: 'own.zip', items: [
    { id: 'old-success', url: 'https://success.example/1.jpg', kind: 'large', filename: '001.jpg', status: 'complete' },
    { id: 'old-failure', url: 'https://failed.example/2.jpg', kind: 'large', filename: '002.jpg', status: 'failed' },
  ], status: 'partial', started: Date.now(), updated: Date.now(), bytes: 10, message: '', tabId: 98 };
  local['archiveBatch:partial'] = batch;
  await mount();
  await click('.deselect-all-button');
  send.mockClear(); request.mockClear();
  await chooseMoreAction('.retry-failed-button');
  expect(request).toHaveBeenCalledWith({ permissions: ['downloads'], origins: ['https://failed.example/*'] });
  expect(send).toHaveBeenCalledWith({ type: 'RETRY_ARCHIVE', batchId: 'partial' });
  expect(analysis!.selected).toEqual([]);
  expect(request.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]!);
  request.mockResolvedValue(false); send.mockClear();
  await chooseMoreAction('.retry-failed-button');
  expect(send).not.toHaveBeenCalled();
  expect(container.textContent).toContain('未获得权限');
});

it('restores retired unlimited settings as Medium on the five-option segmented control', async () => {
  local.downloadSpeed = 'unlimited';
  await mount();
  const group = container.querySelector<HTMLElement>('.download-speed-segments')!;
  const buttons = group.querySelectorAll('[data-slot=toggle-group-item]');
  expect(buttons).toHaveLength(5);
  expect(buttons[1]?.getAttribute('aria-checked')).toBe('true');
  expect(group.getAttribute('aria-labelledby')).toBeTruthy();
  expect(container.querySelector('.download-concurrency')?.textContent).toBe('10 并发');
  expect(container.querySelector('.download-policy [role=slider]')).toBeNull();
  await click('.download-speed-segments [data-slot=toggle-group-item]:nth-child(2)');
  expect(buttons[1]?.getAttribute('aria-checked')).toBe('true');
  expect(local.downloadSpeed).toBe('unlimited');
});

it('uses concise English field and preset names without repeating the selected preset', async () => {
  await setLanguagePreference('en');
  await mount();
  const buttons = container.querySelectorAll('.download-speed-segments [data-slot=toggle-group-item]');
  expect([...buttons].map(button => button.textContent)).toEqual(['Low', 'Med', 'High', 'xhigh', 'Max']);
  expect(container.querySelector('.download-policy h3')?.textContent).toBe('Download speed');
  expect(container.querySelector('.download-concurrency')?.textContent).toBe('10 concurrent');
  expect(container.querySelector('#image-format-heading')?.textContent).toBe('Filter images by type');
  expect(container.querySelector('.collection-options-trigger')?.getAttribute('aria-labelledby')).toBeTruthy();
  expect(container.textContent).toContain('Extraction scope');
});

it.each([{ value: 'low', index: 0 }, { value: 'medium', index: 1 }, { value: 'high', index: 2 }, { value: 'xhigh', index: 3 }, { value: 'max', index: 4 }])('persists $value from its segment and restores it when reopened', async ({ value, index }) => {
  local.downloadSpeed = value === 'medium' ? 'low' : 'medium';
  await mount();
  await click(`.download-speed-segments [data-slot=toggle-group-item]:nth-child(${index + 1})`);
  expect(local.downloadSpeed).toBe(value);
  expect(container.querySelectorAll('.download-speed-segments [aria-checked=true]')).toHaveLength(1);
  await act(async () => root!.unmount()); root = undefined;
  await mount();
  expect(container.querySelectorAll('.download-speed-segments [data-slot=toggle-group-item]')[index]?.getAttribute('aria-checked')).toBe('true');
});

it('preserves the saved segment on failure and responds to another page changing the speed', async () => {
  await mount();
  chrome.storage.local.set = vi.fn().mockRejectedValue(new Error('storage unavailable'));
  await click('.download-speed-segments [data-slot=toggle-group-item]:last-child');
  expect(container.textContent).toContain('下载速度保存失败，请重试。');
  expect(container.querySelectorAll('.download-speed-segments [data-slot=toggle-group-item]')[1]?.getAttribute('aria-checked')).toBe('true');
  await act(async () => { for (const listener of listeners) listener({ downloadSpeed: { newValue: 'xhigh' } }, 'local'); });
  expect(container.querySelectorAll('.download-speed-segments [data-slot=toggle-group-item]')[3]?.getAttribute('aria-checked')).toBe('true');
  expect(container.querySelector('.download-concurrency')?.textContent).toBe('25 并发');
});

it('locks the speed segments while a save is pending', async () => {
  await mount();
  let finish!: () => void;
  const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  chrome.storage.local.set = save;
  await click('.download-speed-segments [data-slot=toggle-group-item]:last-child');
  expect(container.querySelector('.download-speed-segments')?.getAttribute('aria-busy')).toBe('true');
  expect([...container.querySelectorAll<HTMLButtonElement>('.download-speed-segments button')].every(button => button.disabled)).toBe(true);
  await click('.download-speed-segments [data-slot=toggle-group-item]:first-child');
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(container.querySelector('.download-speed-segments')?.getAttribute('aria-busy')).toBe('false');
  expect(container.querySelector('.download-concurrency')?.textContent).toBe('30 并发');
});

it('keeps page order and separates common sidebar actions from More', async () => {
  analysis!.results = [...analysis!.results].reverse();
  await mount();
  expect([...container.querySelectorAll('.image-name')].map(node => node.textContent)).toEqual(['2','1','0']);
  expect(container.querySelector('.app-header .language-control')).toBeTruthy();
  expect(container.querySelector('.collection-options-trigger')?.textContent).toContain('全部启用');
  expect(document.querySelector('.collection-options')).toBeNull();
  await click('.preview-background-control [role=checkbox]');
  expect(container.querySelector('main')?.dataset.darkPreview).toBe('true');
  expect(container.querySelector('.more-actions-button')).not.toBeNull();
  expect(document.querySelector('[role=menu]')).toBeNull();
  for (const selector of ['.copy-links-button', '.export-links-button', '.scroll-extract-button']) {
    expect(container.querySelector(selector)?.closest('.workspace-sidebar')).toBeTruthy();
  }
  await openMore();
  expect(document.querySelector('[role=menu] .batch-tools-button')).not.toBeNull();
  expect(document.querySelector('[role=menu] .view-task-button')).not.toBeNull();
  await act(async () => { document.querySelector('[role=menu]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(document.querySelector('[role=menu]')).toBeNull();
  expect(analysis!.selected).toEqual(['L0','L1','L2']);
});

it('persists extraction opt-outs and keeps unset options enabled', async () => {
  local.collectOptions = { css: false };
  await mount();
  expect(container.querySelector('.collection-options-trigger')?.textContent).toContain('已选 2 项');
  await openExtractionOptions();
  const boxes = () => [...document.querySelectorAll<HTMLElement>('.collection-options [role=menuitemcheckbox]')];
  expect(boxes().map(box => box.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true']);
  await act(async () => boxes()[0]!.click());
  expect(local.collectOptions).toEqual({ icons: false, css: false, inline: true });
  await act(async () => root!.unmount()); root = undefined;
  await mount();
  await openExtractionOptions();
  expect(boxes().map(box => box.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
  expect(container.querySelector('.collection-options-trigger')?.textContent).toContain('已选 1 项');
});
it('does not overwrite saved extraction options with a delayed initial read', async () => {
  const snapshot = await loadPopupSnapshot();
  let finish!: (value: Record<string, unknown>) => void;
  const old = new Promise<Record<string, unknown>>(resolve => { finish = resolve; });
  chrome.storage.local.get = vi.fn(async keys => keys === 'collectOptions' ? old : structuredClone(local)) as typeof chrome.storage.local.get;
  await act(async () => { root = createRoot(container); root.render(<App initialSnapshot={snapshot} />); });
  await openExtractionOptions();
  await chooseAction('.collection-options [role=menuitemcheckbox]');
  expect(local.collectOptions).toEqual({ icons: false, css: true, inline: true });
  await act(async () => { finish({ collectOptions: { icons: true, css: true, inline: true } }); });
  expect(container.querySelector('.collection-options-trigger')?.textContent).toContain('已选 2 项');
  expect(document.querySelector('.collection-options [role=menuitemcheckbox]')?.getAttribute('aria-checked')).toBe('false');
});
it.each(['interaction', 'storage event'])('does not overwrite a newer download speed from a %s with a delayed read', async source => {
  const snapshot = await loadPopupSnapshot();
  let finish!: (value: Record<string, unknown>) => void;
  const old = new Promise<Record<string, unknown>>(resolve => { finish = resolve; });
  chrome.storage.local.get = vi.fn(async keys => keys === 'downloadSpeed' ? old : structuredClone(local)) as typeof chrome.storage.local.get;
  await act(async () => { root = createRoot(container); root.render(<App initialSnapshot={snapshot} />); });
  if (source === 'interaction') await click('.download-speed-segments [data-slot=toggle-group-item]:last-child');
  else await act(async () => { for (const listener of listeners) listener({ downloadSpeed: { newValue: 'max' } }, 'local'); });
  await act(async () => { finish({ downloadSpeed: 'low' }); });
  expect(container.querySelector('.download-concurrency')?.textContent).toBe('30 并发');
});

it('supports keyboard selection and Escape in the standard extraction menu', async () => {
  await mount();
  await openExtractionOptions();
  const menu = document.querySelector<HTMLElement>('.collection-options')!;
  const first = menu.querySelector<HTMLElement>('[role=menuitemcheckbox]')!;
  expect(document.querySelector('input[role=combobox][readonly]')).toBeNull();
  first.focus();
  await act(async () => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await flushToasts();
  expect(local.collectOptions).toEqual({ icons: false, css: true, inline: true });
  expect(document.querySelector('.collection-options')).not.toBeNull();
  await act(async () => { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(container.querySelector('.collection-options-trigger')?.getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelector('.collection-options[data-state=open]')).toBeNull();
});

it('does not show an unsaved extraction change as saved', async () => {
  await mount();
  vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('storage unavailable'));
  await openExtractionOptions();
  await chooseAction('.collection-options [role=menuitemcheckbox]');
  expect(document.querySelector('.collection-options [role=menuitemcheckbox]')?.getAttribute('aria-checked')).toBe('true');
  expect(container.querySelector('.collection-options-trigger')?.textContent).toContain('全部启用');
  expect(container.textContent).toContain('无法保存选项，请重试。');
});

it('switches the popup language while preserving search and selection', async () => {
  await mount();
  await search('城市');
  const before = [...analysis!.selected];
  try {
    await act(async () => { await setLanguagePreference('en'); });
    expect(container.querySelector('.zip-button')?.textContent).toBe('Download selected (3)');
    expect(container.querySelector('.copy-links-button')?.textContent).toBe('Copy URLs');
    expect(container.querySelector('.copy-links-button')?.getAttribute('aria-label')).toBe('Copy selected URLs');
    expect(container.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('城市');
    expect(container.querySelector('.visible-count')?.textContent).toBe('Originals: 1 / 3');
    expect(analysis!.selected).toEqual(before);
    expect(send.mock.calls.some(([message]) => message.type === 'ANALYZE')).toBe(false);
  } finally { await act(async () => { await setLanguagePreference('zh-CN'); }); }
});
it('changes language through the official Select menu without losing the current results', async () => {
  vi.stubGlobal('chrome', { ...chrome, runtime: { ...chrome.runtime, id: 'test' } });
  await mount();
  const selected = [...analysis!.selected];
  const trigger = container.querySelector<HTMLElement>('.language-control [data-slot=select-trigger]')!;
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
  await flushToasts();
  expect(document.querySelector('[data-slot=select-content][role=listbox]')).not.toBeNull();
  const english = [...document.querySelectorAll<HTMLElement>('[data-slot=select-item]')].find(item => item.textContent === 'English')!;
  await act(async () => { english.click(); });
  await flushToasts();
  expect(local.interfaceLanguage).toBe('en');
  expect(container.querySelector('.language-control [data-slot=select-value]')?.textContent).toBe('English');
  expect(container.querySelector('.visible-count')?.textContent).toBe('Originals: 3');
  expect(analysis!.selected).toEqual(selected);
  expect(send.mock.calls.some(([message]) => message.type === 'ANALYZE')).toBe(false);
});

const resumeCalls = () => send.mock.calls.filter(([message]) => message.type === 'RESUME_DOWNLOADS');
it.each(['zh-CN', 'en'] as const)('shows a refused selection save in %s and allows the next save', async language => {
  try {
    await setLanguagePreference(language);
    send.mockImplementation(async (message: Request) => message.type === 'SELECT'
      ? { ok: false, message: '结果已变化，请重新选择图像。' } : { ok: true });
    await mount();
    await click('.deselect-all-button');
    expect(container.querySelector('[data-sonner-toast]')?.textContent).toContain(language === 'en'
      ? 'Results have changed. Select images again.' : '结果已变化，请重新选择图像。');
    send.mockImplementation(async () => ({ ok: true }));
    await click('.select-all-button');
    const selections = send.mock.calls.filter(([message]) => message.type === 'SELECT');
    expect(selections).toHaveLength(2);
    expect(selections[1]![0].selected).toEqual(['L0', 'L1', 'L2']);
  } finally { await act(async () => { await setLanguagePreference('zh-CN'); }); }
});

it('reports an empty selection-save response instead of silently accepting it', async () => {
  send.mockImplementation(async (message: Request) => message.type === 'SELECT' ? undefined : { ok: true });
  await mount();
  await click('.deselect-all-button');
  expect(container.querySelector('[data-sonner-toast]')?.textContent).toContain('选择未能保存，请重新选择。');
});

it('requests task recovery without waiting for a hanging analysis', async () => {
  analysis = undefined;
  send.mockImplementation(async (message: Request) => message.type === 'ANALYZE' ? new Promise(() => {}) : { ok: true });
  await mount();
  expect(send.mock.calls.filter(([message]) => message.type === 'ANALYZE')).toHaveLength(1);
  expect(resumeCalls()).toHaveLength(1);
});
it('still requests task recovery when the analysis fails', async () => {
  analysis = undefined;
  send.mockImplementation(async (message: Request) => message.type === 'ANALYZE' ? { ok: false, message: '读取失败，请重试。' } : { ok: true });
  await mount();
  expect(resumeCalls()).toHaveLength(1);
  expect(container.querySelector('.empty [data-slot=empty-description]')?.textContent).toContain('读取失败');
});
it.each([
  ['rejects', async () => { throw new Error('worker asleep'); }],
  ['throws synchronously', () => { throw new Error('port closed'); }],
  ['answers not ok', async () => ({ ok: false, message: '恢复失败' })],
])('a recovery request that %s never makes an ordinary page look unreachable', async (_name, failure) => {
  analysis = undefined;
  send.mockImplementation((message: Request) => {
    if (message.type === 'RESUME_DOWNLOADS') return failure();
    if (message.type === 'ANALYZE') changed({ ...fixture(), job: 'fresh', selected: [], selectionFilter: message.mode === 'large' ? 'large' : 'page' });
    return Promise.resolve({ ok: true });
  });
  await mount();
  expect(resumeCalls()).toHaveLength(1);
  expectDownloadCount(0);
  expect(container.querySelector('.empty')).toBeNull();
  expect(container.textContent).not.toContain('恢复失败');
  expect(container.textContent).not.toContain('请在普通网页上');
});
it('requests recovery on a restricted page too, where there is nothing to analyse', async () => {
  vi.stubGlobal('chrome', { ...chrome, tabs: { query: async () => [{ id: 7, url: 'chrome://extensions', title: '扩展' }] } });
  analysis = undefined;
  await mount();
  expect(send.mock.calls.some(([message]) => message.type === 'ANALYZE')).toBe(false);
  expect(resumeCalls()).toHaveLength(1);
});

it('allows every extraction option to be turned off and back on independently', async () => {
  await mount();
  await openExtractionOptions();
  for (let i = 0; i < 3; i++) await chooseAction(`.collection-options [role=menuitemcheckbox]:nth-child(${i + 1})`);
  expect(local.collectOptions).toEqual({ icons: false, css: false, inline: false });
  expect(container.querySelector('.collection-options-trigger')?.textContent).toContain('仅页面图像');
  expect(document.querySelector('.collection-options')).not.toBeNull();
  await chooseAction('.collection-options [role=menuitemcheckbox]:nth-child(2)');
  expect(local.collectOptions).toEqual({ icons: false, css: true, inline: false });
  expect(send.mock.calls.some(([message]) => message.type === 'ANALYZE')).toBe(false);
});

it('closes extraction settings with Escape and preserves the saved summary', async () => {
  await mount();
  await openExtractionOptions();
  await chooseAction('.collection-options [role=menuitemcheckbox]');
  const checkbox = container.querySelector<HTMLElement>('.collection-options-trigger')!;
  await act(async () => { checkbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(container.querySelector('.collection-options-trigger')?.getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelector('.collection-options[data-state=open]')).toBeNull();
  expect(container.querySelector('.collection-options-trigger')?.textContent).toContain('已选 2 项');
  await openExtractionOptions();
  expect(document.querySelector('.collection-options [role=menuitemcheckbox]')?.getAttribute('aria-checked')).toBe('false');
});

it('ignores cached automatic selections but preserves explicit user choices', async () => {
  analysis = { ...fixture(), selectionMode: 'large' };
  await mount();
  expectDownloadCount(0);
  expect([...container.querySelectorAll('.item-checkbox')].every(box => box.getAttribute('aria-checked') === 'false')).toBe(true);
  await click('#image-L1');
  expect(analysis).toMatchObject({ selectionMode: 'custom', selected: ['L1'] });
  await act(async () => root!.unmount()); root = undefined;
  await mount();
  expectDownloadCount(1);
  expect(analysis!.selected).toEqual(['L1']);
});
it('keeps zero-selection bulk actions disabled while single-image download remains available', async () => {
  analysis = { ...fixture(), selected: [] };
  await mount();
  expectDownloadCount(0);
  for (const selector of ['.zip-button', '.copy-links-button', '.export-links-button']) expect(container.querySelector<HTMLButtonElement>(selector)?.disabled).toBe(true);
  await click('.image-item .item-download');
  expect(send).toHaveBeenCalledWith({ type: 'DOWNLOAD', job: 'test', selected: ['L0'] });
  expect(analysis!.selected).toEqual([]);
});
it('can clear choices hidden in another image mode without selecting that mode automatically', async () => {
  await mount();
  await click('.original-mode-switch');
  expectDownloadCount(0);
  expect(container.querySelector<HTMLButtonElement>('.deselect-all-button')?.disabled).toBe(false);
  await click('.deselect-all-button');
  expect(analysis!.selected).toEqual([]);
  await click('.original-mode-switch');
  expectDownloadCount(0);
});
it('requests detail-host permission only when original matching is enabled and preserves results after denial', async () => {
  analysis = { ...fixture(), selected: [], selectionFilter: 'page', hostedPages: [{ url: 'https://www.imagebam.com/view/MABC123', source: results[1]!.source, label: 'sample' }] };
  // This source has no existing deterministic original match.
  analysis.hostedPages![0]!.source = 'https://thumbs.imagebam.com/sample.jpg';
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  request.mockResolvedValue(false);
  await mount();
  expect(request).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  await chooseType('仅原图');
  expect(request).toHaveBeenCalledWith({ origins: ['https://imagebam.com/*'] });
  expect(fetcher).not.toHaveBeenCalled();
  expectDownloadCount(0);
  expect(analysis.results).toHaveLength(results.length);
  expect(container.textContent).toContain('未获得图床访问权限');
});
it('resolves permitted detail links, saves originals without selecting them, and reuses completed work', async () => {
  const detail = { url: 'https://www.imagebam.com/view/MABC123', source: 'https://thumbs.imagebam.com/sample.jpg', label: 'sample' };
  analysis = { ...fixture(), selected: [], selectionFilter: 'page', hostedPages: [detail] };
  const original = { id: 'hosted-original', url: 'https://images4.imagebam.com/sample.jpg', source: detail.source, candidate: true, pageImage: false, label: 'sample', reason: '', width: 0, height: 0 };
  const fetcher = vi.fn<typeof fetch>(async () => new Response(`<img class="main-image" src="${original.url}">`, { headers: { 'content-type': 'text/html' } }));
  vi.stubGlobal('fetch', fetcher);
  const originalSend = send.getMockImplementation() as (message: Request) => Promise<{ ok: boolean }>;
  send.mockImplementation(async (message: Request) => {
    if (message.type !== 'HOSTED_ORIGINAL') return originalSend(message);
    const completed = { ...analysis!, hostedPages: [], results: [...analysis!.results, original] };
    changed(completed);
    return { ok: true, analysis: completed };
  });
  await mount(); await chooseType('仅原图');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({ type: 'HOSTED_ORIGINAL', job: 'test', pageUrl: detail.url, url: original.url });
  expectDownloadCount(0);
  expect(analysis?.hostedPages).toEqual([]);
  await chooseType('全部图像'); await chooseType('仅原图');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('cancels in-flight detail lookup when another extraction supersedes its job', async () => {
  const detail = { url: 'https://www.imagebam.com/view/MABC123', source: 'https://thumbs.imagebam.com/sample.jpg', label: '' };
  analysis = { ...fixture(), selected: [], selectionFilter: 'page', hostedPages: [detail] };
  let pendingSignal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_url, options) => {
    pendingSignal = options?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => pendingSignal!.addEventListener('abort', () => reject(pendingSignal!.reason), { once: true }));
  }));
  await mount(); await chooseType('仅原图');
  expect(pendingSignal?.aborted).toBe(false);
  await act(async () => { changed({ ...fixture(), job: 'new-extraction', selected: [], selectionFilter: 'page', hostedPages: [] }); });
  expect(pendingSignal?.aborted).toBe(true);
  expect(send.mock.calls.filter(([message]) => message.type === 'HOSTED_ORIGINAL')).toHaveLength(0);
  expect(analysis?.job).toBe('new-extraction');
  expectDownloadCount(0);
});
