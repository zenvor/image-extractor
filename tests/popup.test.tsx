// @vitest-environment happy-dom
import { act } from 'react';
import { setLanguagePreference } from '../lib/i18n';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../entrypoints/popup/App';
import type { AnalysisState, ArchiveBatch, Request } from '../lib/types';
import { EXTRACTION_VERSION as ORIGINAL_RESOLVER_VERSION } from '../lib/extractionVersion';

const results = ['海岸线', '城市日落', '山间晨光'].flatMap((label, index) => [true, false].map(candidate => ({
  id: (candidate ? 'L' : 'S') + index, label, candidate, reason: '', width: 0, height: 0,
  url: 'https://images.example/' + (candidate ? 'original' : 'thumb') + '/' + index + '.jpg',
  source: 'https://images.example/thumb/' + index + '.jpg',
})));
const fixture = (): AnalysisState => ({
  job: 'test', resolverVersion: ORIGINAL_RESOLVER_VERSION, tabId: 7, url: 'https://example.org/gallery', title: '测试图集', status: 'done', started: Date.now(),
  total: 3, truncated: false, message: '', results, selected: ['L0', 'L1', 'L2'], selectionMode: 'large', selectionFilter: 'large',
});
let analysis: AnalysisState | undefined;
let root: Root | undefined;
let container: HTMLDivElement;
let send: ReturnType<typeof vi.fn>;
let request: ReturnType<typeof vi.fn>;
let local: Record<string, unknown>;
type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
let listeners: Set<StorageListener>;
function changed(value: AnalysisState) {
  analysis = value;
  for (const listener of listeners) listener({ ['analysis:' + value.tabId]: { newValue: structuredClone(value) } }, 'session');
}
async function mount() {
  await act(async () => { root = createRoot(container); root.render(<App />); });
}
async function click(selector: string) {
  const element = container.querySelector<HTMLButtonElement>(selector);
  expect(element, selector).not.toBeNull();
  await act(async () => { element!.click(); });
}
async function chooseAction(selector: string) {
  const item = document.querySelector<HTMLElement>(selector);
  expect(item).not.toBeNull();
  await act(async () => { item!.click(); });
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
  analysis = fixture(); local = {}; listeners = new Set();
  container = document.createElement('div'); document.body.append(container);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  request = vi.fn(async () => true);
  send = vi.fn(async (message: Request) => {
    if (message.type === 'SELECT' && analysis) changed({ ...analysis, selected: message.selected, selectionMode: message.mode || 'custom', selectionFilter: message.filter || analysis.selectionFilter });
    if (message.type === 'ANALYZE') changed({ ...fixture(), job: 'fresh' });
    return { ok: true };
  });
  vi.stubGlobal('chrome', {
    tabs: { query: async () => [{ id: 7, url: 'https://example.org/gallery', title: '测试图集' }], update: vi.fn(async () => ({ id: 99 })), create: vi.fn(async () => ({ id: 100 })) },
    storage: {
      session: { get: async () => ({ analysis }) }, local: { get: async () => local, set: async (values: Record<string, unknown>) => Object.assign(local, values) },
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
  expectDownloadCount(3);
  await act(async () => root!.unmount()); root = undefined;
  await mount();
  expect(send.mock.calls.filter(([message]) => message.type === 'ANALYZE')).toHaveLength(1);
});
it('shows only page URLs by default and switches to matched originals without combining the two', async () => {
  analysis = { ...fixture(), selected: ['S0', 'S1', 'S2'], selectionMode: 'page', selectionFilter: 'page' };
  await mount();
  expect(container.querySelector('.image-type-select')).toBeNull();
  expect(container.querySelector('.original-mode-switch')?.getAttribute('aria-checked')).toBe('false');
  expect([...container.querySelectorAll('.item-checkbox')].map(el => el.id)).toEqual(['image-S0', 'image-S1', 'image-S2']);
  expect(container.querySelector('.kind-label')).toBeNull();
  await click('.original-mode-switch');
  expect(analysis).toMatchObject({ selectionMode: 'large', selected: ['L0', 'L1', 'L2'] });
  expect([...container.querySelectorAll('.item-checkbox')].map(el => el.id)).toEqual(['image-L0', 'image-L1', 'image-L2']);
  await click('.original-mode-switch');
  expect(analysis).toMatchObject({ selectionMode: 'page', selected: ['S0', 'S1', 'S2'] });
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
  expect(send).toHaveBeenCalledWith({ type: 'DOWNLOAD_ZIP', job: 'test', selected: ['S0'] });
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
  expectDownloadCount(3);
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
  expect(container.querySelectorAll('.image-item')).toHaveLength(3);
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
it('quickly selects small images, preserves the filter during manual choices and reports no matches', async () => {
  await mount();
  await chooseType('仅缩略图');
  expect(analysis).toMatchObject({ selected: ['S0', 'S1', 'S2'], selectionFilter: 'page', selectionMode: 'page' });
  await click('#image-S0');
  expect(analysis).toMatchObject({ selected: ['S1', 'S2'], selectionFilter: 'page', selectionMode: 'custom' });
  await search('找不到的图像');
  expect(container.querySelector('.empty [data-slot=empty-title]')?.textContent).toBe('没有符合条件的图像');
  expectDownloadCount(2);
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
it('changing image type clears format restrictions and selects that type', async () => {
  await mount();
  await click('.format-filter[data-format=JPG]');
  expect(container.querySelectorAll('.image-item')).toHaveLength(0);
  await chooseType('全部（缩略图＋原图）');
  expect(analysis).toMatchObject({ selected: ['S0', 'S1', 'S2'], selectionMode: 'page', selectionFilter: 'page' });
  expect(container.querySelector('.format-filter[data-format=JPG]')?.textContent).toBe('JPG(3)');
  expect(container.querySelectorAll('.image-item')).toHaveLength(3);
  expectDownloadCount(3);
});
it('selects from card padding and toggles a label exactly once', async () => {
  await mount();
  await click('.image-item');
  expect(analysis!.selected).toEqual(['L1', 'L2']);
  await click('.image-detail');
  expect(new Set(analysis!.selected)).toEqual(new Set(['L0', 'L1', 'L2']));
  const selectedAfterToggle = [...analysis!.selected];
  await click('.item-preview');
  expect(analysis!.selected).toEqual(selectedAfterToggle);
});
it('opens thumbnail preview without toggling selection and persists list view', async () => {
  await mount();
  const opener = container.querySelector<HTMLElement>('.item-preview')!;
  opener.focus();
  await click('.item-preview');
  expect(document.querySelector('[role="dialog"][aria-labelledby="preview-title"]')).not.toBeNull();
  expect(document.querySelector('#preview-url')?.getAttribute('value')).toBe(results[0]!.url);
  expect(document.querySelector('.thumbnail-full img')?.getAttribute('src')).toBe(results[0]!.source);
  expect(analysis!.selected).toEqual(['L0', 'L1', 'L2']);
  await chooseAction('[aria-label="关闭预览"]');
  expect(document.querySelector('[role="dialog"][aria-labelledby="preview-title"]')).toBeNull();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(document.activeElement).toBe(opener);
  await click('[aria-label="列表视图"]');
  expect(local.imageView).toBe('list');
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
it('downloads just one card through the existing ZIP job without changing selection', async () => {
  await mount();
  await click('.item-download');
  expect(request).toHaveBeenCalledWith({ permissions: ['downloads'], origins: ['https://images.example/*'] });
  expect(send).toHaveBeenCalledWith({ type: 'DOWNLOAD_ZIP', job: 'test', selected: ['L0'] });
  expect(analysis!.selected).toEqual(['L0', 'L1', 'L2']);
  const zipCall = send.mock.calls.findIndex(([message]) => message.type === 'DOWNLOAD_ZIP');
  expect(request.mock.invocationCallOrder[0]!).toBeLessThan(send.mock.invocationCallOrder[zipCall]!);
});
it('loads only the page thumbnail and never presents its size as original resolution', async () => {
  await mount();
  const image = container.querySelector<HTMLImageElement>('.thumbnail img')!;
  Object.defineProperties(image, { naturalWidth: { value: 16 }, naturalHeight: { value: 16 } });
  await act(async () => { image.dispatchEvent(new Event('load')); });
  expect(container.querySelector('.thumbnail-dimensions')).toBeNull();
  expect(container.querySelector('.item-preview')?.textContent).toBe('');
  expect(container.querySelector('.item-preview')?.getAttribute('title')).toBe('预览图像');
  expect(image.getAttribute('src')).toBe(results[0]!.source);
  expect(image.closest('.thumbnail')?.querySelector('.thumbnail-loading')).toBeNull();
  expect(analysis!.selected).toEqual(['L0', 'L1', 'L2']);
});
it('leaves no live storage listener after the popup closes', async () => {
  await mount(); expect(listeners.size).toBeGreaterThan(0);
  await act(async () => root!.unmount()); root = undefined;
  expect(listeners.size).toBe(0);
});
it('keeps a thousand-image grid bounded and reaches the last image from the keyboard', async () => {
  analysis = { ...fixture(), results: Array.from({ length: 1000 }, (_, index) => ({ ...results[0]!, id: String(index), label: '图像 ' + index })), selected: ['0'], total: 1000 };
  await mount();
  expect(container.querySelectorAll('.image-item').length).toBeLessThanOrEqual(15);
  const first = container.querySelector<HTMLButtonElement>('#image-0')!;
  first.focus();
  await act(async () => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); });
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(document.activeElement?.id).toBe('image-999');
  expect(container.querySelector('#image-0')).toBeNull();
  expect(container.querySelectorAll('.image-item').length).toBeLessThanOrEqual(15);
  await click('#image-999');
  expect(analysis!.selected).toEqual(['0', '999']);
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
it.each(['complete', 'fetching'] as const)('keeps the task accessible in the sidebar when the archive is %s', async status => {
  const batch: ArchiveBatch = { id: 'zip', title: '测试图集', filename: '测试图集.zip', pageUrl: 'https://example.org/gallery', items: [], status, started: Date.now(), updated: Date.now(), bytes: 0, message: '正在下载图像', sourceTabId: 7, tabId: 99 };
  local.archiveBatch = batch;
  await mount();
  expect(container.querySelector<HTMLButtonElement>('.zip-button')!.disabled).toBe(status === 'fetching');
  expect(document.querySelector<HTMLButtonElement>('.view-task-button')?.disabled).toBe(false);
  await chooseAction('.view-task-button');
  expect(send).toHaveBeenCalledWith({ type: 'OPEN_ARCHIVES' });
});

it('opens the shared task overview even when the current webpage has no task', async () => {
  await mount();
  expect(container.querySelector<HTMLButtonElement>('.view-task-button')!.disabled).toBe(false);
  await click('.view-task-button');
  expect(send).toHaveBeenCalledWith({ type: 'OPEN_ARCHIVES' });
});

it('runs scroll extraction and opens the batch tools from visible sidebar controls', async () => {
  await mount();
  await click('.scroll-extract-button');
  expect(send).toHaveBeenCalledWith({ type: 'ANALYZE', tabId: 7, mode: 'large', scroll: true });
  await click('.batch-tools-button');
  expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test/tools.html' });
});
it('resumes a cancelled archive from the visible recovery controls', async () => {
  const batch: ArchiveBatch = { id: 'cancelled', sourceTabId: 7, pageUrl: fixture().url, title: '当前页', filename: 'own.zip', items: [
    { id: 'cached', url: 'https://images.example/a.jpg', kind: 'large', filename: '001.jpg', status: 'complete', bytes: 100 },
    { id: 'pending', url: 'https://images.example/b.jpg', kind: 'large', filename: '002.jpg', status: 'pending' },
  ], status: 'cancelled', started: Date.now(), updated: Date.now(), cacheUntil: Date.now() + 60000, bytes: 100, message: '', tabId: 98 };
  local['archiveBatch:cancelled'] = batch;
  await mount();
  await click('[aria-label="继续未完成下载"]');
  expect(request).toHaveBeenCalledWith({ permissions: ['downloads'], origins: ['https://images.example/*'] });
  expect(send).toHaveBeenCalledWith({ type: 'RESUME_ARCHIVE', batchId: 'cancelled' });
});
it('shows and selects all thumbnails when a new analysis has no originals', async () => {
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
  expectDownloadCount(3);
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
])('keeps keyboard navigation and virtualization aligned at $columns columns', async ({ width, columns }) => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) {
    return this.classList.contains('image-list-heading') ? 44 : 0;
  });
  analysis = { ...fixture(), results: Array.from({ length: 1000 }, (_, index) => ({ ...results[0]!, id: String(index), label: '图像 ' + index })), selected: ['0'], total: 1000 };
  await mount();
  const scroller = container.querySelector<HTMLDivElement>('.image-list')!;
  expect(container.querySelector('.results-toolbar')?.closest('.image-list')).toBe(scroller);
  const rowHeight = Number.parseInt(container.querySelector<HTMLElement>('.image-item')!.style.height) + 10;
  await act(async () => { container.querySelector('#image-0')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); });
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(scroller.scrollTop).toBe(44 + Math.floor(999 / columns) * rowHeight);
  expect(document.activeElement?.id).toBe('image-999');
  expect(container.querySelectorAll('.image-item').length).toBeLessThanOrEqual(15);
  await act(async () => { container.querySelector('#image-999')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); });
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
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
  await click('.zip-button');
  expect(send).toHaveBeenCalledWith({ type: 'DOWNLOAD_ZIP', job: 'test', selected: ['L0', 'L1', 'L2'] });
  expect(document.querySelector<HTMLButtonElement>('.view-task-button')?.disabled).toBe(false);
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
  expect(container.querySelector('.archive-progress')?.textContent).toContain('正在获取图像');
  expect(container.querySelectorAll('.image-item')).toHaveLength(3);
  await chooseAction('.view-task-button');
  expect(send).toHaveBeenCalledWith({ type: 'OPEN_ARCHIVES' });
  await act(async () => {
    for (const listener of listeners) listener({ 'archiveBatch:own': { newValue: { ...own, status: 'complete' } } }, 'local');
  });
  expectDownloadCount(3);
  expect(container.querySelector<HTMLButtonElement>('.zip-button')!.disabled).toBe(false);
  expect(container.querySelector('.archive-progress')?.textContent).toContain('下载完成');
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
it.each(['packing', 'saving', 'partial', 'failed', 'cancelled'] as const)('shows %s feedback without claiming image processing is save progress', async status => {
  const batch: ArchiveBatch = { id: 'own', sourceTabId: 7, pageUrl: fixture().url, title: '当前页', filename: 'own.zip', items: [
    { id: '1', url: results[0]!.url, kind: 'large', filename: '001.jpg', status: 'complete' },
    { id: '2', url: results[2]!.url, kind: 'large', filename: '002.jpg', status: 'failed', error: 'HTTP 404' },
  ], status, started: Date.now(), updated: Date.now(), bytes: 10, message: '网络中断，请重试。', tabId: 98 };
  local['archiveBatch:own'] = batch;
  await mount();
  const feedback = container.querySelector('.archive-progress')!;
  expect(feedback).not.toBeNull();
  expect(feedback.querySelector('[role=progressbar]')).toBeNull();
  if (status === 'partial') expect(feedback.textContent).toContain('已保存 1 张 · 1 张失败');
  if (status === 'failed') expect(feedback.querySelector('[role=status]')?.getAttribute('title')).toContain('网络中断');
  await click('[aria-label="查看下载详情"]');
  expect(send).toHaveBeenCalledWith({ type: 'OPEN_ARCHIVES' });
  expect(container.querySelector<HTMLButtonElement>('.zip-button')!.disabled).toBe(status === 'packing' || status === 'saving');
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
  await click('.retry-failed-button');
  expect(request).toHaveBeenCalledWith({ permissions: ['downloads'], origins: ['https://failed.example/*'] });
  expect(send).toHaveBeenCalledWith({ type: 'RETRY_ARCHIVE', batchId: 'partial' });
  expect(analysis!.selected).toEqual([]);
  expect(request.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]!);
  request.mockResolvedValue(false); send.mockClear();
  await click('.retry-failed-button');
  expect(send).not.toHaveBeenCalled();
  expect(container.textContent).toContain('未获得权限');
});

it('restores retired unlimited settings as Medium on the five-step policy slider', async () => {
  local.downloadSpeed = 'unlimited';
  await mount();
  const slider = container.querySelector<HTMLElement>('.download-policy [role=slider]')!;
  expect(slider.getAttribute('aria-valuenow')).toBe('1');
  expect(slider.getAttribute('aria-valuemin')).toBe('0');
  expect(slider.getAttribute('aria-valuemax')).toBe('4');
  expect(container.querySelector('.download-policy')?.textContent).toContain('中等 · 10 并发');
  expect(container.querySelector('.download-policy')?.textContent).not.toContain('无限制');
  expect(slider.getAttribute('aria-labelledby')).toBeTruthy();
});

it('shows English policy names only in the English interface', async () => {
  await setLanguagePreference('en');
  await mount();
  expect(container.querySelector('.download-policy')?.textContent).toContain('Medium · 10 concurrent');
  expect(container.querySelector('.download-policy')?.textContent).toContain('Extra High');
  expect(container.querySelector('.download-policy')?.textContent).not.toContain('极高');
});

it.each([{ value: 'low', label: '低', index: 0 }, { value: 'medium', label: '中等', index: 1 }, { value: 'high', label: '高', index: 2 }, { value: 'xhigh', label: '极高', index: 3 }, { value: 'max', label: '超高', index: 4 }])('persists $value policy with keyboard and restores it when reopened', async ({ value, label, index }) => {
  local.downloadSpeed = value === 'medium' ? 'low' : 'medium';
  await mount();
  const slider = container.querySelector<HTMLElement>('.download-policy [role=slider]')!;
  const current = Number(slider.getAttribute('aria-valuenow'));
  for (let i = 0; i < Math.abs(index - current); i++) {
    await act(async () => slider.dispatchEvent(new KeyboardEvent('keydown', { key: index > current ? 'ArrowRight' : 'ArrowLeft', bubbles: true })));
  }
  expect(local.downloadSpeed).toBe(value);
  expect(slider.getAttribute('aria-valuenow')).toBe(String(index));
  await act(async () => root!.unmount()); root = undefined;
  await mount();
  expect(container.querySelector('.download-policy')?.textContent).toContain(label);
  expect(container.querySelector('.download-policy [role=slider]')?.getAttribute('aria-valuenow')).toBe(String(index));
});

it('reverts a slider change if saving fails and responds to another page changing the policy', async () => {
  await mount();
  chrome.storage.local.set = vi.fn().mockRejectedValue(new Error('storage unavailable'));
  const slider = container.querySelector<HTMLElement>('.download-policy [role=slider]')!;
  await act(async () => slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
  expect(container.textContent).toContain('下载策略保存失败，请重试。');
  expect(slider.getAttribute('aria-valuenow')).toBe('1');
  await act(async () => { for (const listener of listeners) listener({ downloadSpeed: { newValue: 'xhigh' } }, 'local'); });
  expect(slider.getAttribute('aria-valuenow')).toBe('3');
});
it('previews pointer dragging and saves only the final policy when released', async () => {
  local.downloadSpeed = 'medium';
  await mount();
  const track = container.querySelector<HTMLElement>('.download-policy [data-slot=slider]')!;
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 240, height: 24, right: 240, bottom: 24, x: 0, y: 0, toJSON: () => ({}) });
  let captured = false;
  track.setPointerCapture = () => { captured = true; };
  track.hasPointerCapture = () => captured;
  track.releasePointerCapture = () => { captured = false; };
  await act(async () => track.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 120, bubbles: true })));
  expect(local.downloadSpeed).toBe('medium');
  expect(container.querySelector('.download-policy')?.textContent).toContain('高 · 20 并发');
  await act(async () => track.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 180, bubbles: true })));
  expect(local.downloadSpeed).toBe('medium');
  await act(async () => track.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 180, bubbles: true })));
  expect(local.downloadSpeed).toBe('xhigh');
});
it('keeps page order and exposes settings and utility actions directly in the sidebar', async () => {
  analysis!.results = [...analysis!.results].reverse();
  await mount();
  expect([...container.querySelectorAll('.image-name')].map(node => node.textContent)).toEqual(['2','1','0']);
  expect(container.querySelector('.app-header .language-control')).toBeTruthy();
  expect(container.querySelector('.collection-options-trigger')?.textContent).toContain('全部启用');
  expect(document.querySelector('.collection-options')).toBeNull();
  await click('.preview-background-control [role=checkbox]');
  expect(container.querySelector('main')?.dataset.darkPreview).toBe('true');
  expect(container.querySelector('.more-actions-button')).toBeNull();
  expect(document.querySelector('[role=menu]')).toBeNull();
  for (const selector of ['.copy-links-button', '.export-links-button', '.scroll-extract-button', '.batch-tools-button', '.view-task-button']) {
    expect(container.querySelector(selector)?.closest('.workspace-sidebar')).toBeTruthy();
  }
  expect(analysis!.selected).toEqual(['L0','L1','L2']);
});

it('persists extraction opt-outs and keeps unset options enabled', async () => {
  local.collectOptions = { css: false };
  await mount();
  expect(container.querySelector('.collection-options-trigger')?.textContent).toContain('已选 2 项');
  await click('.collection-options-trigger');
  const boxes = () => [...document.querySelectorAll<HTMLElement>('.collection-options [role=option]')];
  expect(boxes().map(box => box.getAttribute('aria-selected'))).toEqual(['true', 'false', 'true']);
  await act(async () => boxes()[0]!.click());
  expect(local.collectOptions).toEqual({ icons: false, css: false, inline: true });
  await act(async () => root!.unmount()); root = undefined;
  await mount();
  await click('.collection-options-trigger');
  expect(boxes().map(box => box.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
  expect(container.querySelector('.collection-options-trigger')?.textContent).toContain('已选 1 项');
});

it('supports keyboard selection and Escape in the compact extraction picker', async () => {
  await mount();
  await click('.collection-options-trigger');
  const input = document.querySelector<HTMLInputElement>('input[role=combobox][readonly]')!;
  expect(input).not.toBeNull();
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(Object.values(local.collectOptions as Record<string, boolean>).filter(Boolean)).toHaveLength(2);
  expect(document.querySelector('.collection-options')).not.toBeNull();
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(container.querySelector('.collection-options-trigger')?.getAttribute('aria-expanded')).toBe('false');
  // Base UI retains closed content during its exit transition. Check its actual
  // open state rather than depending on animation timing in happy-dom.
  expect(document.querySelector('[data-slot="combobox-content"][data-open]')).toBeNull();
  const exitingPopup = document.querySelector('.collection-options')?.closest('[data-slot="combobox-content"]');
  if (exitingPopup) expect(exitingPopup.hasAttribute('data-closed')).toBe(true);
});

it('does not show an unsaved extraction change as saved', async () => {
  await mount();
  vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('storage unavailable'));
  await click('.collection-options-trigger');
  await chooseAction('.collection-options [role=option]');
  expect(document.querySelector('.collection-options [role=option]')?.getAttribute('aria-selected')).toBe('true');
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

const resumeCalls = () => send.mock.calls.filter(([message]) => message.type === 'RESUME_DOWNLOADS');
it.each(['zh-CN', 'en'] as const)('shows a refused selection save in %s and allows the next save', async language => {
  try {
    await setLanguagePreference(language);
    send.mockImplementation(async (message: Request) => message.type === 'SELECT'
      ? { ok: false, message: '结果已变化，请重新选择图像。' } : { ok: true });
    await mount();
    await click('.deselect-all-button');
    expect(container.querySelector('.feedback')?.textContent).toContain(language === 'en'
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
  expect(container.querySelector('.feedback')?.textContent).toContain('选择未能保存，请重新选择。');
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
    if (message.type === 'ANALYZE') changed({ ...fixture(), job: 'fresh' });
    return Promise.resolve({ ok: true });
  });
  await mount();
  expect(resumeCalls()).toHaveLength(1);
  expectDownloadCount(3);
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
  await click('.collection-options-trigger');
  for (let i = 0; i < 3; i++) await chooseAction(`.collection-options [role=option]:nth-child(${i + 1})`);
  expect(local.collectOptions).toEqual({ icons: false, css: false, inline: false });
  expect(container.querySelector('.collection-options-trigger')?.textContent).toContain('仅页面图像');
  expect(document.querySelector('.collection-options')).not.toBeNull();
  await chooseAction('.collection-options [role=option]:nth-child(2)');
  expect(local.collectOptions).toEqual({ icons: false, css: true, inline: false });
  expect(send.mock.calls.some(([message]) => message.type === 'ANALYZE')).toBe(false);
});

it('closes extraction settings with Escape and preserves the saved summary', async () => {
  await mount();
  await click('.collection-options-trigger');
  await chooseAction('.collection-options [role=option]');
  const checkbox = container.querySelector<HTMLElement>('.collection-options-trigger')!;
  await act(async () => { checkbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(container.querySelector('.collection-options-trigger')?.getAttribute('aria-expanded')).toBe('false');
  // Official exit animations may retain a closed popup until animationend.
  // Assert its interactive state instead of happy-dom's animation timing.
  expect(document.querySelector('[data-slot=combobox-content][data-open]')).toBeNull();
  const exitingPopup = document.querySelector('[data-slot=combobox-content]');
  if (exitingPopup) expect(exitingPopup.hasAttribute('data-closed')).toBe(true);
  expect(container.querySelector('.collection-options-trigger')?.textContent).toContain('已选 2 项');
  await click('.collection-options-trigger');
  expect(document.querySelector('[data-slot=combobox-content][data-open] [role=option]')?.getAttribute('aria-selected')).toBe('false');
});
