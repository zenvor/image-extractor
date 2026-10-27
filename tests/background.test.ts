import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { AnalysisState, DownloadBatch, Request } from '../lib/types';
import type { PopupViewState } from '../lib/popupViewState';

let saved: { [key: `analysis:${number}`]: AnalysisState | undefined; [key: `popupView:${number}`]: PopupViewState | undefined; downloadBatch?: DownloadBatch };
let handler: (message: Request, sender: { id: string }, response: (result: unknown) => void) => boolean;
let updated: (id: number, change: { status: string }) => void;
const capture = { url: 'https://example.org/', baseUrl: 'https://example.org/', title: 'Landscapes', total: 1, truncated: false, challenged: false, images: [{ source: '/landscape.jpg', alt: 'Landscape', width: 640, height: 400, declared: ['/full.jpg'], srcsets: [], link: '' }] };
let execute: ReturnType<typeof vi.fn>;
let permissionContains: ReturnType<typeof vi.fn>;
let permissionAdded: (permissions: chrome.permissions.Permissions) => void;
let permissionRemoved: (permissions: chrome.permissions.Permissions) => void;
let downloadChanged: (delta: chrome.downloads.DownloadDelta) => void;
const downloadStates: Record<number, string> = {};
function exposeDownloads() {
  let nextId = 1;
  const download = vi.fn(async () => { const id = nextId++; downloadStates[id] = 'in_progress'; return id; });
  const addListener = vi.fn((listener: typeof downloadChanged) => { downloadChanged = listener; });
  Object.defineProperty(chrome, 'downloads', { configurable: true, value: {
    onChanged: { addListener, removeListener: vi.fn() },
    download,
    search: async ({ id }: { id: number }) => [{ id, state: downloadStates[id] }],
  } });
  return { download, addListener };
}
async function restartWorker() {
  vi.resetModules();
  const { default: setup } = await import('../entrypoints/background');
  (setup as unknown as () => void)();
}

beforeEach(async () => {
  saved = {};
  for (const id of Object.keys(downloadStates)) delete downloadStates[Number(id)];
  execute = vi.fn(async () => [{ result: capture }]);
  permissionContains = vi.fn(async () => false);
  vi.resetModules();
  vi.stubGlobal('defineBackground', (setup: () => void) => setup);
  vi.stubGlobal('chrome', {
    runtime: { id: 'extension', getURL: (path: string) => 'chrome-extension://extension' + path, onStartup: { addListener: vi.fn() }, onMessage: { addListener: (fn: typeof handler) => { handler = fn; } } },
    storage: { local: { get: async () => ({}), set: vi.fn() }, session: {
      get: async () => structuredClone(saved),
      set: async (value: typeof saved) => { Object.assign(saved, structuredClone(value)); },
      remove: async (key: keyof typeof saved) => { delete saved[key]; },
    } },
    tabs: { get: async (id: number) => ({ id, url: 'https://example.org/' }), onRemoved: { addListener: vi.fn() }, onUpdated: { addListener: (fn: typeof updated) => { updated = fn; } } },
    scripting: { executeScript: execute },
    permissions: {
      contains: permissionContains,
      onAdded: { addListener: (listener: typeof permissionAdded) => { permissionAdded = listener; } },
      onRemoved: { addListener: (listener: typeof permissionRemoved) => { permissionRemoved = listener; } },
    },
    // Match Chrome before optional downloads permission is granted: no namespace.
  });
  const { default: setup } = await import('../entrypoints/background');
  (setup as unknown as () => void)();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function send(message: Request): Promise<{ ok: boolean; message?: string }> {
  return new Promise(resolve => { expect(handler(message, { id: 'extension' }, value => resolve(value as { ok: boolean; message?: string }))).toBe(true); });
}
it('starts the worker and analyzes normally without optional downloads permission or API', async () => {
  expect(chrome.downloads).toBeUndefined();
  expect(await send({ type: 'RESUME_DOWNLOADS' })).toEqual({ ok: true });
  expect(await send({ type: 'ANALYZE', tabId: 1 })).toMatchObject({ ok: true, analysis: { status: 'done', tabId: 1 } });
  expect(saved['analysis:1']?.status).toBe('done');
  expect(updated).toBeTypeOf('function');
  const denied = await send({ type: 'DOWNLOAD', job: saved['analysis:1']!.job, selected: ['0'] });
  expect(denied).toMatchObject({ ok: false, message: '请先允许下载权限。' });
  expect(saved.downloadBatch).toBeUndefined();
});
it('replaces an interrupted analysis from an older rule version immediately', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const previousJob = saved['analysis:1']!.job;
  saved['analysis:1'] = { ...saved['analysis:1']!, resolverVersion: 'host-path-originals-v4', status: 'running', started: Date.now() };
  expect(await send({ type: 'ANALYZE', tabId: 1 })).toMatchObject({ ok: true, analysis: { status: 'done', tabId: 1 } });
  expect(saved['analysis:1']?.status).toBe('done');
  expect(saved['analysis:1']?.job).not.toBe(previousJob);
  expect(saved['analysis:1']?.resolverVersion).not.toBe('host-path-originals-v4');
});
it('attaches the download listener after first grant and advances all files without restarting', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const { download, addListener } = exposeDownloads();
  permissionContains.mockResolvedValue(true);
  permissionAdded({ permissions: ['downloads'] });
  permissionAdded({ permissions: ['downloads'] });
  expect(await send({ type: 'DOWNLOAD', job: saved['analysis:1']!.job, selected: ['0', '1'] })).toEqual({ ok: true });
  expect(addListener).toHaveBeenCalledTimes(1);
  expect(download).toHaveBeenCalledTimes(1);
  downloadStates[1] = 'complete';
  downloadChanged({ id: 1, state: { previous: 'in_progress', current: 'complete' } });
  await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2));
  downloadStates[2] = 'complete';
  downloadChanged({ id: 2, state: { previous: 'in_progress', current: 'complete' } });
  await vi.waitFor(() => expect(saved.downloadBatch?.jobs.map(job => job.status)).toEqual(['complete', 'complete']));
});
it('registers granted download events on worker startup and resumes without duplicate transfers', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const { download, addListener } = exposeDownloads();
  permissionContains.mockResolvedValue(true);
  await restartWorker();
  expect(addListener).toHaveBeenCalledTimes(1);
  await send({ type: 'DOWNLOAD', job: saved['analysis:1']!.job, selected: ['0', '1'] });
  await restartWorker();
  expect(addListener).toHaveBeenCalledTimes(2);
  await send({ type: 'RESUME_DOWNLOADS' });
  expect(download).toHaveBeenCalledTimes(1);
  downloadStates[1] = 'complete';
  downloadChanged({ id: 1, state: { current: 'complete' } });
  await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2));
});
it('handles permission revocation without touching a missing downloads API or breaking analysis', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const { download, addListener } = exposeDownloads();
  permissionContains.mockResolvedValue(true);
  await send({ type: 'DOWNLOAD', job: saved['analysis:1']!.job, selected: ['0', '1'] });
  permissionContains.mockResolvedValue(false);
  Object.defineProperty(chrome, 'downloads', { configurable: true, value: undefined });
  permissionRemoved({ permissions: ['downloads'] });
  await vi.waitFor(() => expect(saved.downloadBatch?.jobs.map(job => job.status)).toEqual(['failed', 'failed']));
  expect(saved.downloadBatch?.jobs[0]?.error).toContain('下载权限已撤回');
  expect(await send({ type: 'RESUME_DOWNLOADS' })).toEqual({ ok: true });
  expect(await send({ type: 'ANALYZE', tabId: 1 })).toMatchObject({ ok: true, analysis: { status: 'done', tabId: 1 } });
  expect(download).toHaveBeenCalledTimes(1);
  expect(addListener).toHaveBeenCalledTimes(1);
});
it('reports an unavailable API clearly when granted permission is not yet exposed', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  permissionContains.mockResolvedValue(true);
  permissionAdded({ permissions: ['downloads'] });
  expect(await send({ type: 'DOWNLOAD', job: saved['analysis:1']!.job, selected: ['0'] })).toMatchObject({ ok: false, message: expect.stringContaining('下载接口不可用') });
  expect(saved['analysis:1']?.status).toBe('done');
});
it('persists completed results independently of popup response delivery', async () => {
  // Response is discarded: simulates the popup disappearing during analysis.
  handler({ type: 'ANALYZE', tabId: 1 }, { id: 'extension' }, () => {});
  await vi.waitFor(() => expect(saved['analysis:1']?.status).toBe('done'));
  expect(saved['analysis:1']!.results).toHaveLength(2);
  expect(saved['analysis:1']!.selected).toEqual([]);
});
it('reads existing DOM immediately instead of waiting for images or page idle', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  expect(execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ injectImmediately: true, target: { tabId: 1 } }));
  expect(saved['analysis:1']!.results.every(item => !item.candidate)).toBe(true);
});
it('applies the chosen size mode to new results instead of selecting both groups', async () => {
  execute.mockResolvedValue([{ result: { ...capture, images: [{ ...capture.images[0], source: 'https://t01.imx.to/t/forest.jpg', declared: [] }] } }]);
  await send({ type: 'ANALYZE', tabId: 1, mode: 'large' });
  expect(saved['analysis:1']).toMatchObject({ selectionMode: 'custom', selectionFilter: 'large', selected: [] });
  expect(saved['analysis:1']!.results.map(item => item.candidate)).toEqual([true, false]);
  await send({ type: 'ANALYZE', tabId: 1, mode: 'small' });
  expect(saved['analysis:1']).toMatchObject({ selectionMode: 'custom', selectionFilter: 'small', selected: [] });
});
it('times out stalled injection, allows retry and ignores a late response', async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const stalled = send({ type: 'ANALYZE', tabId: 1 });
  await vi.advanceTimersByTimeAsync(5001);
  await stalled;
  expect(saved['analysis:1']).toMatchObject({ status: 'error', message: expect.stringContaining('超时'), results: [] });
  await send({ type: 'ANALYZE', tabId: 1 });
  const retryJob = saved['analysis:1']!.job;
  finish([{ result: { ...capture, images: [] } }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(saved['analysis:1']).toMatchObject({ job: retryJob, status: 'done' });
  expect(saved['analysis:1']!.results).toHaveLength(2);
});
it('restores selection from storage across worker module restarts', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const job = saved['analysis:1']!.job;
  vi.resetModules();
  const { default: setup } = await import('../entrypoints/background');
  (setup as unknown as () => void)();
  await send({ type: 'SELECT', job, selected: ['1', 'fake-id'] });
  expect(saved['analysis:1']!.selected).toEqual(['1']);
});
it('preserves the small-image filter for custom selections across worker restarts', async () => {
  await send({ type: 'ANALYZE', tabId: 1, mode: 'small' });
  expect(saved['analysis:1']!.selectionFilter).toBe('small');
  const job = saved['analysis:1']!.job;
  await send({ type: 'SELECT', job, selected: ['1'], mode: 'custom', filter: 'small' });
  await restartWorker();
  expect(saved['analysis:1']).toMatchObject({ selected: ['1'], selectionMode: 'custom', selectionFilter: 'small' });
  await send({ type: 'SELECT', job, selected: ['0'], mode: 'custom', filter: 'invalid' } as unknown as Request);
  expect(saved['analysis:1']!.selectionFilter).toBe('small');
});
it('reports challenge pages without exporting images', async () => {
  execute.mockResolvedValue([{ result: { ...capture, challenged: true } }]);
  await send({ type: 'ANALYZE', tabId: 1 });
  expect(saved['analysis:1']!.status).toBe('error');
  expect(saved['analysis:1']!.results).toEqual([]);
  expect(saved['analysis:1']!.message).toContain('验证');
});
it('orders popup state writes independently of popup lifetime and rejects superseded jobs', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const job = saved['analysis:1']!.job;
  const view: PopupViewState = { job, query: '', excludedFormats: [], darkPreview: false, gallery: { results: 'results', page: 0, scrollTop: 100 } };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const originalSet = chrome.storage.session.set;
  let blocked = false;
  chrome.storage.session.set = vi.fn(async (values: Record<string, unknown>) => {
    if ((values['popupView:1'] as PopupViewState)?.gallery?.scrollTop === 100) { blocked = true; await gate; }
    await originalSet(values);
  });
  const first = send({ type: 'SAVE_POPUP_VIEW', tabId: 1, view });
  await vi.waitFor(() => expect(blocked).toBe(true));
  const latest = send({ type: 'SAVE_POPUP_VIEW', tabId: 1, view: { ...view, gallery: { ...view.gallery!, scrollTop: 385 } } });
  release();
  expect(await first).toEqual({ ok: true });
  expect(await latest).toEqual({ ok: true });
  expect(saved['popupView:1']?.gallery?.scrollTop).toBe(385);
  await restartWorker();
  expect(saved['popupView:1']?.gallery?.scrollTop).toBe(385);
  await send({ type: 'ANALYZE', tabId: 1 });
  expect(await send({ type: 'SAVE_POPUP_VIEW', tabId: 1, view })).toMatchObject({ ok: false });
  expect(saved['popupView:1']?.gallery?.scrollTop).toBe(385);
});
it('does not restore a queued popup view after its tab navigates', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const view: PopupViewState = { job: saved['analysis:1']!.job, query: 'old', excludedFormats: [], darkPreview: false };
  updated(1, { status: 'loading' });
  expect(await send({ type: 'SAVE_POPUP_VIEW', tabId: 1, view })).toMatchObject({ ok: false });
  expect(saved['analysis:1']).toBeUndefined();
  expect(saved['popupView:1']).toBeUndefined();
});
it('invalidates previous results when the tab reloads', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  updated(1, { status: 'loading' });
  await vi.waitFor(() => expect(saved['analysis:1']).toBeUndefined());
});
it('does not resurrect results if navigation occurs during DOM reading', async () => {
  let finish!: (value: unknown) => void;
  execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const job = send({ type: 'ANALYZE', tabId: 1 });
  await vi.waitFor(() => expect(saved['analysis:1']?.status).toBe('running'));
  updated(1, { status: 'loading' });
  await vi.waitFor(() => expect(saved['analysis:1']).toBeUndefined());
  finish([{ result: capture }]);
  await job;
  expect(saved['analysis:1']).toBeUndefined();
});

it('defaults to page images even when original rules match', async () => {
  execute.mockResolvedValue([{ result: { ...capture, images: [{ ...capture.images[0], source: 'https://image.imx.to/u/t/2026/09/26/765kix.jpg', declared: [] }] } }]);
  await send({ type: 'ANALYZE', tabId: 1 });
  expect(saved['analysis:1']).toMatchObject({ selectionMode: 'custom', selectionFilter: 'page', selected: [] });
  expect(saved['analysis:1']!.results[0]!.url).toBe('https://i02.imx.to/i/2026/09/26/765kix.jpg');
});
it('defaults to page mode when no originals match', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  expect(saved['analysis:1']!.results.every(item => !item.candidate)).toBe(true);
  expect(saved['analysis:1']).toMatchObject({ selectionMode: 'custom', selectionFilter: 'page', selected: [] });
});
it('keeps an explicit all-image choice even when originals are available', async () => {
  execute.mockResolvedValue([{ result: { ...capture, images: [{ ...capture.images[0], source: 'https://t01.imx.to/t/forest.jpg', declared: [] }] } }]);
  await send({ type: 'ANALYZE', tabId: 1, mode: 'all' });
  expect(saved['analysis:1']).toMatchObject({ selectionMode: 'custom', selectionFilter: 'all', selected: [] });
});

it('keeps analysis and selections isolated when switching between pages and after worker restart', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const a = structuredClone(saved['analysis:1']!);
  await send({ type: 'ANALYZE', tabId: 2 });
  const b = structuredClone(saved['analysis:2']!);
  expect(saved['analysis:1']).toEqual(a);
  expect(a.job).not.toBe(b.job);
  await restartWorker();
  await send({ type: 'SELECT', job: a.job, selected: ['1'], mode: 'custom' });
  expect(saved['analysis:1']!.selected).toEqual(['1']);
  expect(saved['analysis:2']).toEqual(b);
  updated(2, { status: 'loading' });
  await vi.waitFor(() => expect(saved['analysis:2']).toBeUndefined());
  expect(saved['analysis:1']!.selected).toEqual(['1']);
});
it('allows page B analysis while A is reading and does not discard B when A finishes', async () => {
  let finish!: (value: unknown) => void;
  execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const readingA = send({ type: 'ANALYZE', tabId: 1 });
  await vi.waitFor(() => expect(saved['analysis:1']?.status).toBe('running'));
  expect(await send({ type: 'ANALYZE', tabId: 2 })).toMatchObject({ ok: true, analysis: { status: 'done', tabId: 2 } });
  const b = structuredClone(saved['analysis:2']);
  finish([{ result: capture }]); await readingA;
  expect(saved['analysis:1']?.status).toBe('done');
  expect(saved['analysis:2']).toEqual(b);
});

it('keeps imported workspace results when the initial navigation finishes after saving', async () => {
  const url = chrome.runtime.getURL('/popup.html?workspace=1');
  chrome.tabs.create = vi.fn(async () => ({ id: 42 } as chrome.tabs.Tab));
  chrome.tabs.get = vi.fn(async (id: number) => ({ id, url } as chrome.tabs.Tab));
  expect(await send({ type: 'IMPORT_CAPTURE', capture })).toMatchObject({ ok: true });
  expect(saved['analysis:42']?.url).toBe(url);
  expect(saved['analysis:42']?.sourceUrl).toBe(capture.url);
  expect(saved['analysis:42']?.selected).toEqual([]);
  updated(42, { status: 'loading' });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(saved['analysis:42']?.status).toBe('done');
  chrome.tabs.get = vi.fn(async (id: number) => ({ id, url: 'https://elsewhere.test/' } as chrome.tabs.Tab));
  updated(42, { status: 'loading' });
  await vi.waitFor(() => expect(saved['analysis:42']).toBeUndefined());
});

it('does not let an in-flight old selection overwrite a newer analysis', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const oldJob = saved['analysis:1']!.job;
  const originalSet = chrome.storage.session.set;
  let release!: () => void;
  chrome.storage.session.set = vi.fn(async value => {
    const state = value['analysis:1'] as AnalysisState | undefined;
    if (state?.job === oldJob && state.selected.length === 1) await new Promise<void>(resolve => { release = resolve; });
    await originalSet(value);
  });
  const selection = send({ type: 'SELECT', job: oldJob, selected: ['1'] });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const analysis = send({ type: 'ANALYZE', tabId: 1 });
  await send({ type: 'ANALYZE', tabId: 2 }); // Other tabs must remain independent.
  release(); await selection;
  expect(await analysis).toMatchObject({ ok: true, analysis: { status: 'done' } });
  expect(saved['analysis:1']!.job).not.toBe(oldJob);
  expect(saved['analysis:1']!.selected).toEqual([]);
});
it('does not resurrect an old selection after navigation clears its page', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const oldJob = saved['analysis:1']!.job;
  const originalSet = chrome.storage.session.set;
  let release!: () => void;
  chrome.storage.session.set = vi.fn(async value => {
    if (value['analysis:1']?.job === oldJob) await new Promise<void>(resolve => { release = resolve; });
    await originalSet(value);
  });
  const selection = send({ type: 'SELECT', job: oldJob, selected: ['1'] });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  updated(1, { status: 'loading' });
  await new Promise(resolve => setTimeout(resolve, 0));
  release(); await selection;
  await vi.waitFor(() => expect(saved['analysis:1']).toBeUndefined());
});
it('reports unresolved relative addresses in imported HTML instead of silent success', async () => {
  chrome.tabs.create = vi.fn(async () => ({ id: 42 } as chrome.tabs.Tab));
  const imported = { ...capture, url: '', baseUrl: '', images: [{ ...capture.images[0]!, source: 'photos/a.jpg', declared: [] }, { ...capture.images[0]!, source: 'https://example.org/b.jpg', declared: [] }] };
  expect(await send({ type: 'IMPORT_CAPTURE', capture: imported })).toMatchObject({ ok: true, unresolvedCount: 1 });
  expect(saved['analysis:42']).toMatchObject({ status: 'done', unresolvedCount: 1, message: expect.stringContaining('1 个相对图像地址') });
  expect(saved['analysis:42']!.results).toHaveLength(1);
});
it('rejects imports with only unresolved relative addresses without creating an empty workspace', async () => {
  chrome.tabs.create = vi.fn();
  const imported = { ...capture, url: '', baseUrl: '', images: [{ ...capture.images[0]!, source: 'photos/a.jpg', declared: [] }] };
  expect(await send({ type: 'IMPORT_CAPTURE', capture: imported })).toMatchObject({ ok: false, message: expect.stringContaining('1 个相对图像地址') });
  expect(chrome.tabs.create).not.toHaveBeenCalled();
});
it('ignores an old selection received while a newer analysis is capturing', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const oldJob = saved['analysis:1']!.job;
  let release!: (result: unknown) => void;
  execute.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const analysis = send({ type: 'ANALYZE', tabId: 1 });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await send({ type: 'SELECT', job: oldJob, selected: [] });
  expect(saved['analysis:1']!.status).toBe('running');
  release([{ result: capture }]); await analysis;
  expect(saved['analysis:1']!.job).not.toBe(oldJob);
  expect(saved['analysis:1']!.selected).toEqual([]);
});

/* ---- E: SELECT reports every rejected request; F: selection filtering uses an id set ---- */
function seedResults(ids = ['a', 'b', 'c', 'd', 'e', 'f']) {
  const state = saved['analysis:1']!;
  state.results = ids.map(id => ({ id, url: `https://images.example.org/${id}.jpg`, source: '', label: id, reason: '', candidate: true, width: 0, height: 0 }));
  state.selected = []; state.selectionMode = 'custom'; state.selectionFilter = 'large';
  return state;
}
it.each([
  ['an unknown job', () => ({ type: 'SELECT', job: 'missing', selected: ['0'] }), '结果已变化'],
  ['a missing job id', () => ({ type: 'SELECT', selected: ['0'] }), '选择参数无效'],
  ['a non-array selection', (job: string) => ({ type: 'SELECT', job, selected: '0' }), '选择参数无效'],
  ['non-string ids', (job: string) => ({ type: 'SELECT', job, selected: [0, null] }), '选择参数无效'],
  ['an unknown mode', (job: string) => ({ type: 'SELECT', job, selected: ['0'], mode: 'everything' }), '选择参数无效'],
  ['an unknown filter', (job: string) => ({ type: 'SELECT', job, selected: ['0'], filter: 'huge' }), '选择参数无效'],
])('rejects SELECT with %s instead of reporting success', async (_name, build, expected) => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const before = structuredClone(saved['analysis:1']);
  const response = await send(build(saved['analysis:1']!.job) as unknown as Request);
  expect(response).toMatchObject({ ok: false, message: expect.stringContaining(expected) });
  expect(saved['analysis:1']).toEqual(before);
});
it('rejects SELECT while the analysis for that job is still running', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  saved['analysis:1'] = { ...saved['analysis:1']!, status: 'running' };
  const before = structuredClone(saved['analysis:1']);
  expect(await send({ type: 'SELECT', job: before!.job, selected: ['0'] })).toMatchObject({ ok: false, message: '分析尚未完成，请稍后再选择。' });
  expect(saved['analysis:1']).toEqual(before);
});
it('rejects an old selection that was queued behind a newer analysis and never overwrites the newer job', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const oldJob = saved['analysis:1']!.job;
  const originalSet = chrome.storage.session.set;
  let release!: () => void;
  chrome.storage.session.set = vi.fn(async value => {
    const state = value['analysis:1'] as AnalysisState | undefined;
    if (state?.job === oldJob && state.selected.length === 1) await new Promise<void>(resolve => { release = resolve; });
    await originalSet(value);
  });
  const first = send({ type: 'SELECT', job: oldJob, selected: ['1'] });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const queued = send({ type: 'SELECT', job: oldJob, selected: ['0'] });
  const analysis = send({ type: 'ANALYZE', tabId: 1 });
  release();
  expect(await first).toEqual({ ok: true });
  expect(await analysis).toMatchObject({ ok: true });
  expect(await queued).toMatchObject({ ok: false, message: expect.stringContaining('结果已变化') });
  expect(saved['analysis:1']!.job).not.toBe(oldJob);
  expect(saved['analysis:1']!.selected).toEqual([]);
});
it('rejects a selection for a page that was cleared by navigation', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const job = saved['analysis:1']!.job;
  updated(1, { status: 'loading' });
  await vi.waitFor(() => expect(saved['analysis:1']).toBeUndefined());
  expect(await send({ type: 'SELECT', job, selected: ['0'] })).toMatchObject({ ok: false, message: expect.stringContaining('结果已变化') });
  expect(saved['analysis:1']).toBeUndefined();
});
it('keeps selections isolated per tab and still accepts a valid SELECT', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  await send({ type: 'ANALYZE', tabId: 2 });
  const before2 = structuredClone(saved['analysis:2']);
  expect(await send({ type: 'SELECT', job: saved['analysis:1']!.job, selected: ['1'], mode: 'custom', filter: 'small' })).toEqual({ ok: true });
  expect(saved['analysis:1']).toMatchObject({ selected: ['1'], selectionMode: 'custom', selectionFilter: 'small' });
  expect(saved['analysis:2']).toEqual(before2);
  // The optional fields stay optional.
  expect(await send({ type: 'SELECT', job: saved['analysis:1']!.job, selected: [] })).toEqual({ ok: true });
  expect(saved['analysis:1']).toMatchObject({ selected: [], selectionMode: 'custom', selectionFilter: 'small' });
});
it('SELECT keeps result order, drops unknown ids and removes duplicates', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  seedResults();
  expect(await send({ type: 'SELECT', job: saved['analysis:1']!.job, selected: ['e', 'a', 'a', 'zz', 'c', 'e', '__proto__'] })).toEqual({ ok: true });
  expect(saved['analysis:1']!.selected).toEqual(['a', 'c', 'e']);
});
it('SELECT and both download paths preserve a 2000-image selection from 12000 results', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const ids = Array.from({ length: 12000 }, (_, index) => `id${index}`);
  seedResults(ids);
  await grantDownloads();
  chrome.tabs.create = vi.fn(async () => ({ id: 71 } as chrome.tabs.Tab));
  const wanted = ids.filter((_, index) => index % 6 === 0); // 2000: the ZIP limit
  const selected = [...wanted].reverse();
  expect(await send({ type: 'SELECT', job: saved['analysis:1']!.job, selected })).toEqual({ ok: true });
  expect(saved['analysis:1']!.selected).toEqual(wanted);
  expect(await send({ type: 'DOWNLOAD_ZIP', job: saved['analysis:1']!.job, selected })).toMatchObject({ ok: true });
  expect(await send({ type: 'DOWNLOAD', job: saved['analysis:1']!.job, selected })).toEqual({ ok: true });
  expect(saved.downloadBatch?.jobs.map(job => job.url)).toEqual(wanted.map(id => `https://images.example.org/${id}.jpg`));
});
async function grantDownloads() {
  const handle = exposeDownloads();
  permissionContains.mockResolvedValue(true);
  permissionAdded({ permissions: ['downloads'] });
  return handle;
}
it('DOWNLOAD_ZIP packs only known ids once, in result order', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  seedResults();
  await grantDownloads();
  chrome.tabs.create = vi.fn(async () => ({ id: 70 } as chrome.tabs.Tab));
  expect(await send({ type: 'DOWNLOAD_ZIP', job: saved['analysis:1']!.job, selected: ['f', 'b', 'b', 'nope', 'd'] })).toMatchObject({ ok: true, tabId: 70 });
  const set = vi.mocked(chrome.storage.local.set);
  const batch = set.mock.calls.map(([values]) => Object.values(values as Record<string, { items: { id: string; url: string }[] }>)[0]!).find(value => value?.items)!;
  expect(batch.items.map(item => item.id)).toEqual(['b', 'd', 'f']);
  expect(batch.items.map(item => item.url)).toEqual(['b', 'd', 'f'].map(id => `https://images.example.org/${id}.jpg`));
});
it('legacy DOWNLOAD starts only known ids once, in result order', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  seedResults();
  await grantDownloads();
  expect(await send({ type: 'DOWNLOAD', job: saved['analysis:1']!.job, selected: ['e', 'c', 'c', 'nope', 'a'] })).toEqual({ ok: true });
  expect(saved.downloadBatch?.jobs.map(job => job.url)).toEqual(['a', 'c', 'e'].map(id => `https://images.example.org/${id}.jpg`));
});
it('downloads one known image directly and permits another native download without an archive or queue', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const state = seedResults();
  const { download } = await grantDownloads();
  chrome.tabs.create = vi.fn();
  const before = [...state.selected];
  expect(await send({ type: 'DOWNLOAD', job: state.job, selected: ['a', 'a', 'unknown'] })).toMatchObject({ ok: true, downloadId: 1 });
  expect(await send({ type: 'DOWNLOAD', job: state.job, selected: ['b'] })).toMatchObject({ ok: true, downloadId: 2 });
  expect(download).toHaveBeenNthCalledWith(1, { url: state.results[0]!.url, conflictAction: 'uniquify', saveAs: false });
  expect(download).toHaveBeenNthCalledWith(2, { url: state.results[1]!.url, conflictAction: 'uniquify', saveAs: false });
  expect(chrome.tabs.create).not.toHaveBeenCalled();
  expect(saved.downloadBatch).toBeUndefined();
  expect(state.selected).toEqual(before);
});
it('reports a native image download failure without creating an archive task', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const state = seedResults();
  const { download } = await grantDownloads();
  download.mockRejectedValueOnce(new Error('native download rejected'));
  expect(await send({ type: 'DOWNLOAD', job: state.job, selected: ['a'] })).toEqual({ ok: false, message: 'native download rejected' });
  expect(saved.downloadBatch).toBeUndefined();
});
it('page downloads exclude generated URLs and number actual URLs in page discovery order', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  const state = seedResults(['original', 'thumb', 'photo']);
  state.selectionFilter = 'page';
  state.results[0] = { ...state.results[0]!, pageImage: false };
  state.results[1] = { ...state.results[1]!, pageImage: true, pageOrder: 1 };
  state.results[2] = { ...state.results[2]!, pageImage: true, pageOrder: 0 };
  await grantDownloads();
  chrome.tabs.create = vi.fn(async () => ({ id: 70 } as chrome.tabs.Tab));
  const selected = state.results.map(item => item.id);
  expect(await send({ type: 'DOWNLOAD_ZIP', job: state.job, selected })).toMatchObject({ ok: true });
  const batch = vi.mocked(chrome.storage.local.set).mock.calls.map(([values]) => Object.values(values as Record<string, { items: { id: string; kind: string }[] }>)[0]!).find(value => value?.items)!;
  expect(batch.items.map(item => [item.id, item.kind])).toEqual([['photo', 'small'], ['thumb', 'small']]);
});
it('DOWNLOAD_ZIP and DOWNLOAD still reject an unknown job, an unfinished analysis and a non-array selection', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  await grantDownloads();
  const job = saved['analysis:1']!.job;
  for (const type of ['DOWNLOAD', 'DOWNLOAD_ZIP'] as const) {
    expect(await send({ type, job: 'missing', selected: ['0'] })).toMatchObject({ ok: false, message: expect.stringContaining('结果已变化') });
    expect(await send({ type, job, selected: '0' } as unknown as Request)).toMatchObject({ ok: false, message: expect.stringContaining('结果已变化') });
  }
  saved['analysis:1'] = { ...saved['analysis:1']!, status: 'running' };
  expect(await send({ type: 'DOWNLOAD_ZIP', job, selected: ['0'] })).toMatchObject({ ok: false, message: expect.stringContaining('结果已变化') });
});

it('enables every optional image source by default', async () => {
  await send({ type: 'ANALYZE', tabId: 1 });
  expect(execute.mock.calls[0]![0].args).toEqual([{ css: true, icons: true, inline: true }]);
});
it('preserves saved opt-outs when extracting a page', async () => {
  Object.assign(chrome.storage.local, { get: async () => ({ collectOptions: { css: false, icons: false } }) });
  await send({ type: 'ANALYZE', tabId: 1 });
  expect(execute.mock.calls[0]![0].args).toEqual([{ css: false, icons: false, inline: true }]);
});
it('stores recognized detail pages and only appends provider-scoped originals to the current job', async () => {
  const pageUrl = 'https://www.imagebam.com/view/MABC123';
  const source = 'https://thumbs.imagebam.com/sample.jpg';
  execute.mockResolvedValue([{ result: { ...capture, images: [{ ...capture.images[0], source, declared: [], link: pageUrl }] } }]);
  await send({ type: 'ANALYZE', tabId: 1 });
  const state = saved['analysis:1']!;
  expect(state.hostedPages).toEqual([{ url: pageUrl, source, label: 'Landscape' }]);
  state.selected = ['0'];
  const job = state.job;
  const url = 'https://images4.imagebam.com/test.jpg';
  expect(await send({ type: 'HOSTED_ORIGINAL', job, pageUrl, url: 'https://evil.test/test.jpg' })).toMatchObject({ ok: false });
  expect(await send({ type: 'HOSTED_ORIGINAL', job, pageUrl: 'https://www.imagebam.com/view/MOTHER', url })).toMatchObject({ ok: false });
  expect(await send({ type: 'HOSTED_ORIGINAL', job, pageUrl, url })).toMatchObject({ ok: false, message: '图床访问权限已失效。' });
  expect(saved['analysis:1']?.results).toHaveLength(1);
  permissionContains.mockResolvedValue(true);
  expect(await send({ type: 'HOSTED_ORIGINAL', job, pageUrl, url })).toMatchObject({ ok: true });
  expect(saved['analysis:1']?.results.at(-1)).toMatchObject({ url, source, candidate: true, pageImage: false });
  expect(saved['analysis:1']?.selected).toEqual(['0']);
  expect(saved['analysis:1']?.hostedPages).toEqual([]);
  expect(await send({ type: 'HOSTED_ORIGINAL', job, pageUrl, url })).toMatchObject({ ok: false });
  await send({ type: 'ANALYZE', tabId: 1 });
  expect(await send({ type: 'HOSTED_ORIGINAL', job, pageUrl, url })).toMatchObject({ ok: false });
  expect(saved['analysis:1']?.results).toHaveLength(1);
});
