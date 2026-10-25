import sharp from 'sharp';
import { locks } from 'node:worker_threads';
import { afterEach, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { buildArchive, publishArchive, runArchive, opfsDirectory, type ArchiveDirectory, type ArchiveDependencies } from '../lib/archive';
import { startArchive, requiredOrigins, recoverArchive, archiveKey, readArchive, readArchives, saveArchive, archiveForPage, interruptArchive, openArchivePage } from '../lib/archiveState';
import type { ArchiveBatch, ImageResult } from '../lib/types';

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="green"/></svg>';
function fixture(count = 2) {
  const batch: ArchiveBatch = { id: 'local-test', filename: '山与海.zip', title: '山与海', pageUrl: 'https://example.org/', status: 'queued', started: Date.now(), updated: Date.now(), bytes: 0, message: '', items: Array.from({ length: count }, (_, i) => ({ id: String(i), url: `https://images.example.org/${i}.jpg`, kind: i % 2 ? 'small' : 'large', filename: `${i % 2 ? '小图' : '大图'}/${String((i >> 1) + 1).padStart(3, '0')}_${i}.jpg`, status: 'pending' })) };
  const files = new Map<string, File>();
  let published: File | undefined;
  const directory: ArchiveDirectory = {
    async write(name, stream, signal) {
      const chunks: Uint8Array[] = [];
      await stream.pipeTo(new WritableStream({ write(chunk) { chunks.push(chunk); } }), { signal });
      files.set(name, new File(chunks as BlobPart[], name));
    },
    async file(name) { const file = files.get(name); if (!file) throw new Error('Missing file'); return file; },
    async remove(name) { files.delete(name); },
    cleanup: vi.fn(async () => { files.clear(); }),
  };
  const dependencies: ArchiveDependencies = {
    directory: async () => directory,
    fetch: vi.fn(async () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } })),
    persist: vi.fn(async () => {}), publish: vi.fn(async file => { published = file; }),
  };
  return { batch, files, directory, dependencies, published: () => published };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('a single task prepares thirty bounded workers and still produces a valid ZIP', async () => {
  const test = fixture(32);
  let starts = 0;
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let ready!: () => void;
  const allStarted = new Promise<void>(resolve => { ready = resolve; });
  test.dependencies.fetch = vi.fn(async () => {
    if (++starts === 30) ready();
    await hold;
    return new Response(svg);
  });
  const result = buildArchive(test.batch, test.dependencies, new AbortController().signal);
  await allStarted;
  expect(starts).toBe(30);
  release(); await result;
  expect(starts).toBe(32);
  expect(test.batch.status).toBe('complete');
  const zip = await JSZip.loadAsync(await test.published()!.arrayBuffer());
  expect(Object.values(zip.files).filter(entry => !entry.dir)).toHaveLength(32);
});

it('produces a real ZIP with correct grouped names, image bytes and title; cleans temporary files', async () => {
  const test = fixture();
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(test.batch.status).toBe('complete');
  const zip = await JSZip.loadAsync(await test.published()!.arrayBuffer());
  expect(Object.keys(zip.files)).toEqual(['大图/001_0.svg', '小图/001_1.svg']);
  for (const entry of Object.values(zip.files)) expect(await entry.async('string')).toBe(svg);
  expect(test.directory.cleanup).toHaveBeenCalledOnce();
  expect(test.files.size).toBe(0);
});
it('retries one failed image, reports partial success in the ZIP, and never stores an HTML challenge as an image', async () => {
  const test = fixture();
  test.dependencies.fetch = vi.fn(async url => String(url).endsWith('/1.jpg') ? new Response('<html>verify</html>', { headers: { 'content-type': 'text/html' } }) : new Response(svg));
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(test.dependencies.fetch).toHaveBeenCalledTimes(3);
  expect(test.batch.status).toBe('partial');
  const zip = await JSZip.loadAsync(await test.published()!.arrayBuffer());
  expect(Object.keys(zip.files)).toEqual(['大图/001_0.svg', '下载失败.txt']);
  expect(await zip.file('下载失败.txt')!.async('string')).toContain('验证页');
});
it('does not publish a ZIP or claim success when all images fail', async () => {
  const test = fixture();
  test.dependencies.fetch = vi.fn(async () => new Response('no', { status: 403 }));
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(test.batch.status).toBe('failed'); expect(test.dependencies.publish).not.toHaveBeenCalled();
  expect(test.directory.cleanup).toHaveBeenCalledOnce();
});
it('retries a broken response stream and includes only complete bytes in the final ZIP', async () => {
  const test = fixture(1);
  const broken = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('<svg>')); controller.error(new Error('连接中断')); } });
  test.dependencies.fetch = vi.fn().mockResolvedValueOnce(new Response(broken)).mockResolvedValueOnce(new Response(svg));
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  const zip = await JSZip.loadAsync(await test.published()!.arrayBuffer());
  expect(await zip.file('大图/001_0.svg')!.async('string')).toBe(svg);
  expect(test.batch.status).toBe('complete');
  expect(test.dependencies.fetch).toHaveBeenCalledTimes(2);
});
it('keeps concurrency bounded for a thousand files and preserves filename ordering despite reversed completion', async () => {
  const test = fixture(1000);
  let live = 0, maximum = 0;
  test.dependencies.fetch = vi.fn(async () => {
    live++; maximum = Math.max(live, maximum);
    await new Promise(resolve => setTimeout(resolve, 0)); live--;
    return new Response(svg);
  });
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  const zip = await JSZip.loadAsync(await test.published()!.arrayBuffer());
  expect(Object.keys(zip.files)).toHaveLength(1000);
  expect(Object.keys(zip.files).slice(0, 4)).toEqual(['大图/001_0.svg', '小图/001_1.svg', '大图/002_2.svg', '小图/002_3.svg']);
  expect(maximum).toBe(30);
}, 15000);
it('reserves the total byte budget atomically after concurrent response callbacks', async () => {
  const test = fixture(33);
  const readFile = test.directory.file;
  // Simulate file metadata instead of allocating four GiB in the test process.
  test.directory.file = async name => {
    const file = await readFile(name);
    Object.defineProperty(file, 'size', { value: 128 * 1024 * 1024 });
    return file;
  };
  test.dependencies.response = async () => { await new Promise(resolve => setTimeout(resolve, 5)); };
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(test.batch.bytes).toBeLessThanOrEqual(4 * 1024 * 1024 * 1024);
  expect(test.batch.status).toBe('failed');
  expect(test.batch.message).toContain('4 GB');
  expect(test.dependencies.publish).not.toHaveBeenCalled();
});
it('cancels streaming transfers, cleans partial files and never publishes cancelled work', async () => {
  const test = fixture(); const controller = new AbortController();
  test.dependencies.fetch = vi.fn(async () => { controller.abort(new Error('用户取消')); return new Response(svg); });
  await buildArchive(test.batch, test.dependencies, controller.signal);
  expect(test.batch.status).toBe('cancelled'); expect(test.dependencies.publish).not.toHaveBeenCalled();
  expect(test.directory.cleanup).toHaveBeenCalledOnce();
});
it('requests only selected image hostnames and deduplicates origins, independent of ports', () => {
  expect(requiredOrigins(['https://a.test/1.jpg', 'https://a.test/2.jpg', 'http://127.0.0.1:5180/a.svg'])).toEqual(['https://a.test/*', 'http://127.0.0.1/*']);
  expect(() => requiredOrigins(['https://user:password@a.test/a.jpg'])).toThrow();
});
it('snapshots selection and opens an independent task only after checking all permissions', async () => {
  let stored: Record<string, ArchiveBatch> = {};
  const create = vi.fn(async () => ({ id: 99 }));
  const contains = vi.fn(async () => true);
  vi.stubGlobal('chrome', { permissions: { contains }, runtime: { getURL: (url: string) => `chrome-extension://test${url}` }, storage: { local: { get: async () => structuredClone(stored), set: async (value: typeof stored) => { Object.assign(stored, structuredClone(value)); } } }, tabs: { create, get: vi.fn() } });
  const image: ImageResult = { id: '0', url: 'https://a.test/a.jpg', source: '', label: '', reason: '', candidate: true, width: 0, height: 0 };
  await startArchive([image, image], '山与海', 'https://example.org/', 7);
  expect(Object.values(stored)[0]).toMatchObject({ filename: '山与海.zip', sourceTabId: 7, tabId: 99, status: 'queued', items: [{ filename: '001_a.jpeg', url: image.url }] });
  expect(contains).toHaveBeenCalledWith({ permissions: ['downloads'], origins: ['https://a.test/*'] });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
});
it('waits for Chrome to finish writing before reporting ZIP success', async () => {
  const test = fixture(); const states = ['in_progress', 'complete'];
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:chrome-extension://test/archive');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const download = vi.fn(async () => 7);
  const search = vi.fn(async () => [{ state: states.shift() }]);
  vi.stubGlobal('chrome', { permissions: { contains: async () => true }, storage: { local: { get: async () => ({}) } }, downloads: { download, search, cancel: vi.fn() } });
  await publishArchive(new File([svg], 'archive.zip'), test.batch, new AbortController().signal);
  expect(search).toHaveBeenCalledTimes(2);
  expect(download).toHaveBeenCalledWith(expect.objectContaining({ filename: '山与海.zip' }));
  expect(revoke).toHaveBeenCalledOnce();
});
it('handles revoked permission with an absent downloads API without throwing a startup TypeError', async () => {
  vi.stubGlobal('chrome', { permissions: { contains: async () => false } });
  const test = fixture();
  await expect(publishArchive(new File([svg], 'archive.zip'), test.batch, new AbortController().signal)).rejects.toThrow('权限已失效');
});
it('opening a copy of a running task only views it and cannot restart or invalidate the owner', async () => {
  const batch = { ...fixture().batch, status: 'fetching', tabId: 99 };
  const set = vi.fn();
  vi.stubGlobal('chrome', { storage: { local: { get: async () => ({ archiveBatch: structuredClone(batch) }), set } }, tabs: { getCurrent: async () => ({ id: 100 }) } });
  await runArchive(batch.id, new AbortController().signal);
  expect(set).not.toHaveBeenCalled();
});

it('interrupts only the stale batch runner when several batches share its manager page', async () => {
  const store = storedArchives();
  const a = { ...fixture().batch, id: 'stale-a', tabId: 77, status: 'fetching' } as ArchiveBatch;
  const b = { ...fixture().batch, id: 'live-b', tabId: 77, status: 'fetching' } as ArchiveBatch;
  store.records[archiveKey(a.id)] = a; store.records[archiveKey(b.id)] = b;
  vi.stubGlobal('chrome', { storage: { local: store.local }, tabs: { getCurrent: async () => ({ id: 77 }) } });
  await runArchive(a.id, new AbortController().signal);
  expect((await readArchive(a.id))?.status).toBe('failed');
  expect((await readArchive(b.id))?.status).toBe('fetching');
});

it('reuses an existing manager and replaces a closed or navigated manager without touching source pages', async () => {
  const manager = { id: 700, url: '/download.html' };
  const tabs = new Map([[manager.id, manager]]);
  const create = vi.fn(async ({ url }: { url: string }) => { const tab = { id: 701, url }; tabs.set(tab.id, tab); return tab; });
  const update = vi.fn(async (id: number) => tabs.get(id));
  vi.stubGlobal('chrome', {
    runtime: { getURL: (url: string) => url, getContexts: async () => [{ tabId: 700 }] },
    tabs: { create, update, get: async (id: number) => { const tab = tabs.get(id); if (!tab) throw new Error('closed'); return tab; } },
  });
  expect((await openArchivePage()).id).toBe(700);
  expect(create).not.toHaveBeenCalled(); expect(update).toHaveBeenCalledWith(700, { active: true });
  tabs.set(700, { id: 700, url: 'https://source.test/' });
  expect((await openArchivePage(false)).id).toBe(701);
  expect(create).toHaveBeenCalledWith({ url: '/download.html', active: false });
  expect(tabs.get(700)?.url).toBe('https://source.test/');
});

it('recognizes shared manager contexts when recovering multiple active records', async () => {
  const store = storedArchives();
  for (const id of ['a', 'b']) store.records[archiveKey(id)] = { ...fixture().batch, id, tabId: 77, status: 'fetching' };
  vi.stubGlobal('chrome', { storage: { local: store.local }, runtime: { getURL: (url: string) => url,
    getContexts: async ({ documentUrls }: { documentUrls: string[] }) => documentUrls.includes('/download.html') ? [{ tabId: 77 }] : [] } });
  await recoverArchive();
  expect((await readArchives()).every(batch => batch.status === 'fetching')).toBe(true);
});
it('reopening the popup clears an orphaned task instead of leaving ZIP download disabled forever', async () => {
  let batch = { ...fixture().batch, status: 'fetching', tabId: 99 } as ArchiveBatch;
  vi.stubGlobal('chrome', { runtime: { getURL: (value: string) => value, getContexts: async () => [] }, storage: { local: { get: async () => ({ archiveBatch: structuredClone(batch) }), set: async (value: Record<string, ArchiveBatch>) => { batch = value[archiveKey(batch.id)]!; } } } });
  await recoverArchive();
  expect(batch.status).toBe('failed'); expect(batch.message).toContain('中断');
});
it('restores completed native ZIP status after the task page disappears without repeating downloads', async () => {
  let batch = { ...fixture().batch, status: 'saving', tabId: 99, downloadId: 7 } as ArchiveBatch;
  const cancel = vi.fn();
  vi.stubGlobal('chrome', { runtime: { getURL: (value: string) => value, getContexts: async () => [] }, storage: { local: { get: async () => ({ archiveBatch: structuredClone(batch) }), set: async (value: Record<string, ArchiveBatch>) => { batch = value[archiveKey(batch.id)]!; } } }, downloads: { search: async () => [{ state: 'complete' }], cancel } });
  await recoverArchive();
  expect(batch.status).toBe('complete'); expect(cancel).not.toHaveBeenCalled();
});

it('preserves the original stem and uses the same actual JPEG suffix as the crawler', async () => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const test = fixture(1);
  test.batch.items[0]!.filename = '001_6awtfx.png';
  test.dependencies.fetch = vi.fn(async () => new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/jpeg' } }));
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  const zip = await JSZip.loadAsync(await test.published()!.arrayBuffer());
  expect(Object.keys(zip.files)).toEqual(['001_6awtfx.jpeg']);
  expect(await zip.file('001_6awtfx.jpeg')!.async('uint8array')).toEqual(new Uint8Array(bytes));
});

function storedArchives(initial: ArchiveBatch[] = []) {
  const records: Record<string, ArchiveBatch> = Object.fromEntries(initial.map(batch => [archiveKey(batch.id), structuredClone(batch)]));
  const local = {
    get: async () => structuredClone(records),
    set: async (values: Record<string, ArchiveBatch>) => { Object.assign(records, structuredClone(values)); },
  };
  return { records, local };
}
it('shares one manager while keeping concurrent page batches and selections independent', async () => {
  const store = storedArchives(); let taskTab = 90;
  const tabs = new Map<number, { id: number; url: string }>();
  const create = vi.fn(async ({ url }: { url: string }) => { const tab = { id: ++taskTab, url }; tabs.set(tab.id, tab); return tab; });
  vi.stubGlobal('chrome', {
    storage: { local: store.local }, permissions: { contains: async () => true }, runtime: { getURL: (url: string) => url },
    tabs: { create, get: async (id: number) => { const tab = tabs.get(id); if (!tab) throw new Error('closed'); return tab; } },
  });
  const image: ImageResult = { id: '0', url: 'https://images.example/a.jpg', source: '', label: '', reason: '', candidate: true, width: 0, height: 0 };
  await Promise.all([
    startArchive([image], '页面 A', 'https://example.org/a', 1),
    startArchive([image], '页面 B', 'https://example.org/b', 2),
    startArchive([image], '相同网址另一个标签', 'https://example.org/a', 3),
  ]);
  const batches = await readArchives();
  expect(batches).toHaveLength(3);
  expect(new Set(batches.map(batch => batch.tabId)).size).toBe(1);
  expect(create).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith({ url: '/download.html', active: false });
  const a = archiveForPage(batches, 1, 'https://example.org/a')!;
  const b = archiveForPage(batches, 2, 'https://example.org/b')!;
  await expect(startArchive([image], '重复 A', a.pageUrl, 1)).rejects.toThrow('当前页面已有');
  await Promise.all([saveArchive({ ...a, status: 'fetching', bytes: 10 }), saveArchive({ ...b, status: 'complete', bytes: 20 })]);
  expect(await readArchive(a.id)).toMatchObject({ status: 'fetching', bytes: 10, filename: '页面 A.zip' });
  expect(await readArchive(b.id)).toMatchObject({ status: 'complete', bytes: 20, filename: '页面 B.zip' });
  await interruptArchive(a.tabId!);
  expect((await readArchive(a.id))?.status).toBe('failed');
  expect((await readArchive(b.id))?.status).toBe('complete');
  expect(archiveForPage(await readArchives(), 3, a.pageUrl)?.status).toBe('failed');
  // Navigating the same source tab to a different page can start a new task too.
  await startArchive([image], '页面 C', 'https://example.org/c', 3);
  expect(await readArchives()).toHaveLength(4);
});
it('recovers only orphaned tasks and leaves another page running', async () => {
  const a = { ...fixture().batch, id: 'a', status: 'fetching', tabId: 91 } as ArchiveBatch;
  const b = { ...fixture().batch, id: 'b', status: 'fetching', tabId: 92 } as ArchiveBatch;
  const store = storedArchives([a, b]);
  vi.stubGlobal('chrome', {
    storage: { local: store.local },
    runtime: { getURL: (url: string) => url, getContexts: async ({ documentUrls }: { documentUrls: string[] }) => documentUrls.some(url => url.endsWith('batch=b')) ? [{ tabId: 92 }] : [] },
  });
  await recoverArchive();
  expect((await readArchive('a'))?.status).toBe('failed');
  expect(await readArchive('b')).toEqual(b);
});
it('keeps other active OPFS directories when starting and cleaning a concurrent task', async () => {
  const activeId = '11111111-1111-4111-8111-111111111111';
  const currentId = '22222222-2222-4222-8222-222222222222';
  const staleId = '33333333-3333-4333-8333-333333333333';
  const batch = { ...fixture().batch, id: activeId, status: 'fetching' } as ArchiveBatch;
  const store = storedArchives([batch]);
  const removeEntry = vi.fn(async (_name: string, _options?: { recursive: boolean }) => {});
  const parent = { async *keys() { yield activeId; yield staleId; yield 'unrelated'; }, removeEntry, getDirectoryHandle: vi.fn(async () => ({})) };
  vi.stubGlobal('chrome', { storage: { local: store.local } });
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => parent }) } });
  const directory = await opfsDirectory(currentId);
  expect(removeEntry).toHaveBeenCalledExactlyOnceWith(staleId, { recursive: true });
  await directory.cleanup();
  expect(removeEntry.mock.calls.map(call => call[0])).toEqual([staleId, currentId]);
});

it.each(['enumeration', 'history'])('still opens its own OPFS directory when stale cleanup fails during %s', async failure => {
  const currentId = '22222222-2222-4222-8222-222222222222';
  const removeEntry = vi.fn();
  const getDirectoryHandle = vi.fn(async () => ({}));
  const parent = {
    async *keys() {
      if (failure === 'enumeration') throw new Error('Cannot enumerate stale directories');
      yield '33333333-3333-4333-8333-333333333333';
    },
    removeEntry, getDirectoryHandle,
  };
  vi.stubGlobal('chrome', { storage: { local: { get: async () => { throw new Error('Cannot read history'); } } } });
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => parent }) } });
  await expect(opfsDirectory(currentId)).resolves.toBeDefined();
  expect(getDirectoryHandle).toHaveBeenCalledExactlyOnceWith(currentId, { create: true });
  // A failed ownership scan must never lead to deleting directories speculatively.
  expect(removeEntry).not.toHaveBeenCalled();
});

it('runs two task pages through independent OPFS writes, real ZIP creation and Chrome save completion', async () => {
  const a: ArchiveBatch = { ...fixture(1).batch, id: '11111111-1111-4111-8111-111111111111', sourceTabId: 1, tabId: 91, filename: 'A.zip' };
  const b: ArchiveBatch = { ...fixture(1).batch, id: '22222222-2222-4222-8222-222222222222', sourceTabId: 2, tabId: 92, filename: 'B.zip' };
  const store = storedArchives([a, b]);
  const directories = new Map<string, Map<string, File>>();
  const parent = {
    async *keys() { yield* directories.keys(); },
    async removeEntry(id: string) { directories.delete(id); },
    async getDirectoryHandle(id: string) {
      if (!directories.has(id)) directories.set(id, new Map());
      const files = directories.get(id)!;
      return {
        async getFileHandle(name: string) {
          return {
            async createWritable() {
              const chunks: Uint8Array[] = [];
              return new WritableStream<Uint8Array>({ write(chunk) { chunks.push(chunk); }, close() { files.set(name, new File(chunks as BlobPart[], name)); } });
            },
            async getFile() { const file = files.get(name); if (!file) throw new Error('Missing task file'); return file; },
          };
        },
        async removeEntry(name: string) { files.delete(name); },
      };
    },
  };
  const blobs: File[] = [];
  const saved: string[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(file => { blobs.push(file as File); return 'blob:test/' + blobs.length; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('navigator', { locks, storage: { getDirectory: async () => ({ getDirectoryHandle: async () => parent }) } });
  const starts: number[] = [];
  vi.stubGlobal('fetch', vi.fn(async () => { starts.push(Date.now()); return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }); }));
  vi.stubGlobal('chrome', {
    storage: { local: store.local }, permissions: { contains: async () => true },
    tabs: { getCurrent: vi.fn().mockResolvedValueOnce({ id: 91 }).mockResolvedValueOnce({ id: 92 }) },
    downloads: { download: async ({ filename }: { filename: string }) => { saved.push(filename); return saved.length; }, search: async () => [{ state: 'complete' }] },
  });
  await Promise.all([runArchive(a.id, new AbortController().signal), runArchive(b.id, new AbortController().signal)]);
  expect(new Set(saved)).toEqual(new Set(['A.zip', 'B.zip']));
  expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(490);
  expect(await readArchive(a.id)).toMatchObject({ status: 'complete', sourceTabId: 1, tabId: 91 });
  expect(await readArchive(b.id)).toMatchObject({ status: 'complete', sourceTabId: 2, tabId: 92 });
  expect(blobs).toHaveLength(2);
  for (const file of blobs) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    expect(await zip.file('大图/001_0.svg')!.async('string')).toBe(svg);
  }
  expect(directories.size).toBe(0);
});

it('reports each archive stage and waits for saving before declaring completion', async () => {
  const test = fixture();
  const snapshots: ArchiveBatch[] = [];
  test.dependencies.persist = async batch => { snapshots.push(structuredClone(batch)); };
  test.dependencies.publish = async () => {
    expect(test.batch.status).toBe('saving');
    expect(snapshots.some(batch => batch.status === 'complete')).toBe(false);
  };
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(snapshots.map(batch => batch.status)).toEqual(['fetching', 'packing', 'saving', 'complete']);
});
it('explains timed out images after the automatic retry fails', async () => {
  const test = fixture(1);
  test.dependencies.fetch = vi.fn(async () => { throw new DOMException('The operation timed out', 'TimeoutError'); });
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(test.dependencies.fetch).toHaveBeenCalledTimes(2);
  expect(test.batch.items[0]!.error).toContain('30 秒');
  expect(test.batch.status).toBe('failed');
});

function trickle(text: string, pieces: number, gap: number) {
  const bytes = new TextEncoder().encode(text);
  const size = Math.ceil(bytes.length / pieces);
  const state = { cancelled: false };
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise(resolve => setTimeout(resolve, gap));
      if (offset >= bytes.length) controller.close();
      else controller.enqueue(bytes.slice(offset, offset += size));
    },
    cancel() { state.cancelled = true; },
  });
  return { state, stream };
}
function stalledAfterFirstChunk() {
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('<svg')); },
    cancel() { state.cancelled = true; },
  });
  return { state, stream };
}
const hangUntilAborted = ((_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
  init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
})) as unknown as typeof fetch;

it('lets a slow but steadily progressing image exceed the header and stall limits in total', async () => {
  vi.useFakeTimers();
  try {
    const test = fixture(1);
    test.dependencies.timeouts = { headers: 40, stall: 40 };
    const slow = trickle(svg, 8, 15);
    test.dependencies.fetch = vi.fn(async () => new Response(slow.stream, { headers: { 'content-type': 'image/svg+xml' } }));
    const started = Date.now();
    const operation = buildArchive(test.batch, test.dependencies, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(250);
    await operation;
    expect(Date.now() - started).toBeGreaterThan(80);
    expect(test.dependencies.fetch).toHaveBeenCalledOnce();
    expect(test.batch.status).toBe('complete');
    vi.useRealTimers();
    const zip = await JSZip.loadAsync(await test.published()!.arrayBuffer());
    expect(await zip.file('大图/001_0.svg')!.async('string')).toBe(svg);
  } finally { vi.useRealTimers(); }
});

it('times out only the response headers and keeps the original timeout message', async () => {
  const test = fixture(1);
  test.dependencies.timeouts = { headers: 20, stall: 1000 };
  test.dependencies.fetch = vi.fn(hangUntilAborted);
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(test.dependencies.fetch).toHaveBeenCalledTimes(2);
  expect(test.batch.items[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('请求超时') });
  expect(test.batch.status).toBe('failed');
});

it('aborts a body that stops progressing, cancels the stream and removes the partial file', async () => {
  const test = fixture(1);
  test.dependencies.timeouts = { headers: 1000, stall: 30 };
  const streams = [stalledAfterFirstChunk(), stalledAfterFirstChunk()];
  test.dependencies.fetch = vi.fn().mockImplementation(async () => new Response(streams.shift()!.stream, { headers: { 'content-type': 'image/svg+xml' } }));
  const remove = vi.spyOn(test.directory, 'remove');
  const seen = [...streams];
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(test.dependencies.fetch).toHaveBeenCalledTimes(2);
  expect(seen.every(entry => entry.state.cancelled)).toBe(true);
  expect(remove).toHaveBeenCalledWith('0.image');
  expect(test.files.has('0.image')).toBe(false);
  expect(test.batch.items[0]!.error).toContain('停滞');
  expect(test.batch.items[0]!.error).not.toContain('请求超时');
  expect(test.batch.status).toBe('failed');
});

it('treats a stalled OPFS write like a stalled download and releases the attempt', async () => {
  const test = fixture(1);
  test.dependencies.timeouts = { headers: 1000, stall: 30 };
  const write = vi.fn((_name: string, _stream: ReadableStream<Uint8Array>, signal?: AbortSignal) => new Promise<void>((_, reject) => {
    signal!.addEventListener('abort', () => reject(signal!.reason));
  }));
  test.directory.write = write;
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(write).toHaveBeenCalledTimes(2);
  expect(test.batch.items[0]!.error).toContain('停滞');
  expect(test.batch.status).toBe('failed');
});

it('still honours user cancellation during a slow body without retrying', async () => {
  const test = fixture(1);
  test.dependencies.timeouts = { headers: 1000, stall: 1000 };
  const slow = trickle(svg.repeat(50), 400, 10);
  test.dependencies.fetch = vi.fn(async () => new Response(slow.stream, { headers: { 'content-type': 'image/svg+xml' } }));
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error('下载已取消。')), 40);
  await buildArchive(test.batch, test.dependencies, controller.signal);
  expect(test.dependencies.fetch).toHaveBeenCalledOnce();
  expect(slow.state.cancelled).toBe(true);
  expect(test.batch.status).toBe('cancelled');
});

it('uses 30 second header and stall limits by default and leaves no timers behind', async () => {
  vi.useFakeTimers();
  try {
    const test = fixture(1);
    test.dependencies.fetch = vi.fn()
      .mockImplementationOnce(hangUntilAborted)
      .mockImplementationOnce(async () => new Response(stalledAfterFirstChunk().stream, { headers: { 'content-type': 'image/svg+xml' } }));
    const done = buildArchive(test.batch, test.dependencies, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(29000);
    expect(test.dependencies.fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1100);
    expect(test.dependencies.fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29000);
    expect(test.batch.status).toBe('fetching');
    await vi.advanceTimersByTimeAsync(1100);
    await done;
    expect(test.batch.status).toBe('failed');
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('retries only failed URLs, preserves original names and skips successes on the next retry', async () => {
  const source = fixture(4).batch;
  source.status = 'partial'; source.sourceTabId = 7;
  source.items.forEach((item, index) => { item.status = index % 2 ? 'failed' : 'complete'; item.error = index % 2 ? 'HTTP 503' : undefined; });
  const stored: Record<string, ArchiveBatch> = { [archiveKey(source.id)]: structuredClone(source) };
  const contains = vi.fn(async () => true);
  const create = vi.fn(async () => ({ id: 99 }));
  vi.stubGlobal('chrome', { permissions: { contains }, runtime: { getURL: (value: string) => value }, tabs: { create }, storage: { local: {
    get: async () => structuredClone(stored), set: async (values: typeof stored) => { Object.assign(stored, structuredClone(values)); },
  } } });
  const { retryArchive } = await import('../lib/archiveState');
  const first = await retryArchive(source.id);
  const retry = stored[archiveKey(first.batchId)]!;
  expect(retry.items.map(item => item.filename)).toEqual([source.items[1]!.filename, source.items[3]!.filename]);
  expect(retry.items.every(item => item.status === 'pending' && !item.error)).toBe(true);
  expect(retry).toMatchObject({ sourceTabId: 7, pageUrl: source.pageUrl, retryOf: source.id, filename: '山与海-失败图片.zip' });
  const test = fixture();
  test.dependencies.persist = async batch => { stored[archiveKey(batch.id)] = structuredClone(batch); };
  test.dependencies.fetch = vi.fn(async url => String(url).endsWith('/3.jpg') ? new Response('no', { status: 503 }) : new Response(svg));
  await buildArchive(retry, test.dependencies, new AbortController().signal);
  expect(test.dependencies.fetch).toHaveBeenCalledTimes(3);
  expect(new Set(vi.mocked(test.dependencies.fetch).mock.calls.map(([url]) => url))).toEqual(new Set([source.items[1]!.url, source.items[3]!.url]));
  const zip = await JSZip.loadAsync(await test.published()!.arrayBuffer());
  expect(Object.keys(zip.files)).toEqual([source.items[1]!.filename.replace(/\.jpg$/, '.svg'), '下载失败.txt']);
  await expect(retryArchive(source.id)).rejects.toThrow('已发起重试');
  expect(create).toHaveBeenCalledTimes(1);
  const second = await retryArchive(retry.id);
  expect(stored[archiveKey(second.batchId)]!.items.map(item => item.url)).toEqual([source.items[3]!.url]);
  expect(stored[archiveKey(source.id)]!.items).toEqual(source.items);
});

it('rejects retries while active, without failed images, or without permissions', async () => {
  const source = fixture().batch;
  const stored = { [archiveKey(source.id)]: source };
  const create = vi.fn();
  vi.stubGlobal('chrome', { permissions: { contains: async () => false }, tabs: { create }, storage: { local: { get: async () => structuredClone(stored) } } });
  const { retryArchive } = await import('../lib/archiveState');
  await expect(retryArchive(source.id)).rejects.toThrow('没有可单独重试');
  source.status = 'complete'; source.items.forEach(item => item.status = 'complete');
  await expect(retryArchive(source.id)).rejects.toThrow('没有可单独重试');
  source.status = 'partial'; source.items[1]!.status = 'failed';
  await expect(retryArchive(source.id)).rejects.toThrow('请允许下载权限');
  expect(create).not.toHaveBeenCalled();
});

it('resumes verified completed files without fetching successes again', async () => {
  const test = fixture(3);
  test.batch.items[0]!.status = 'complete'; test.batch.items[0]!.filename = '大图/001_0.svg';
  const cached = new File([svg], '0.image'); test.files.set('0.image', cached); test.batch.items[0]!.bytes = cached.size;
  test.batch.bytes = 99999; test.batch.cacheUntil = Date.now() + 10000;
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(test.dependencies.fetch).toHaveBeenCalledTimes(2);
  expect((test.dependencies.fetch as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0])).not.toContain(test.batch.items[0]!.url);
  expect(test.batch.bytes).toBe(cached.size * 3); expect(test.batch.cacheUntil).toBeUndefined();
  const zip = await JSZip.loadAsync(await test.published()!.arrayBuffer());
  expect(Object.keys(zip.files)).toHaveLength(3);
});
it('redownloads missing or corrupt retained files instead of trusting completion state', async () => {
  const test = fixture(2);
  for (const item of test.batch.items) { item.status = 'complete'; item.bytes = 999; }
  test.files.set('0.image', new File(['bad'], '0.image'));
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(test.dependencies.fetch).toHaveBeenCalledTimes(2); expect(test.batch.status).toBe('complete');
});
it('retains completed files when ZIP publishing fails and reuses them on resume', async () => {
  const test = fixture(2);
  test.dependencies.publish = vi.fn(async () => { throw new Error('保存失败'); });
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(test.batch.status).toBe('failed'); expect(test.batch.cacheUntil).toBeGreaterThan(Date.now());
  expect(test.directory.cleanup).not.toHaveBeenCalled();
  test.dependencies.publish = vi.fn(async () => {});
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(test.dependencies.fetch).toHaveBeenCalledTimes(2); expect(test.batch.status).toBe('complete');
});
it('validates and packs an inline SVG without a host permission or HTTP request', async () => {
  const test = fixture(1); const url = 'data:image/svg+xml,' + encodeURIComponent(svg);
  test.batch.items[0]!.url = url; test.dependencies.fetch = globalThis.fetch;
  expect(requiredOrigins([url])).toEqual([]);
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  const zip = await JSZip.loadAsync(await test.published()!.arrayBuffer());
  expect(await Object.values(zip.files)[0]!.async('string')).toBe(svg);
});

it('normalizes jpg/jpeg when validating retained JPEG files', async () => {
  const test = fixture(1); const jpeg = new Uint8Array([255, 216, 255, 224, 0, 0]);
  const file = new File([jpeg], '0.image'); test.files.set('0.image', file);
  Object.assign(test.batch.items[0]!, { status: 'complete', bytes: file.size, filename: '001_photo.jpeg' });
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(test.dependencies.fetch).not.toHaveBeenCalled(); expect(test.batch.status).toBe('complete');
});

it('routes every attempt including retries through the scheduler and reports throttling responses', async () => {
  const test = fixture(1);
  let inside = false;
  const scheduled: string[] = [];
  test.dependencies.schedule = async (url, _signal, work) => {
    scheduled.push(url); inside = true;
    try { return await work(); } finally { inside = false; }
  };
  test.dependencies.response = vi.fn(async () => {});
  let attempts = 0;
  test.dependencies.fetch = vi.fn(async () => {
    expect(inside).toBe(true);
    return attempts++ === 0 ? new Response(null, { status: 429, headers: { 'retry-after': '90' } }) : new Response(svg);
  });
  const write = test.directory.write;
  test.directory.write = async (name, stream, signal) => {
    if (name.endsWith('.image')) expect(inside).toBe(true);
    await write(name, stream, signal);
  };
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  expect(scheduled).toEqual([test.batch.items[0]!.url, test.batch.items[0]!.url]);
  expect(vi.mocked(test.dependencies.response!).mock.calls.map(([, response]) => response.status)).toEqual([429, 200]);
  expect(test.batch.status).toBe('complete');
});
it('uses real chpic response names inside the ZIP, with unique variant names and original numbers', async () => {
  const test = fixture(2);
  for (const [index, item] of test.batch.items.entries()) {
    item.url = `https://chpic.su/save2/pack?type=${index ? 'white' : 'transparent'}`;
    item.filename = `${String(index + 9).padStart(3, '0')}_image.bin`;
  }
  test.dependencies.fetch = vi.fn(async () => new Response(svg, { headers: { 'content-disposition': 'attachment; filename="Pack_-_flower.png"' } }));
  await buildArchive(test.batch, test.dependencies, new AbortController().signal);
  const zip = await JSZip.loadAsync(await test.published()!.arrayBuffer());
  expect(Object.keys(zip.files)).toEqual(['009_transparent_flower.svg', '010_white_flower.svg']);
});
