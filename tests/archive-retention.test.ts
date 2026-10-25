import { afterEach, expect, it, vi } from 'vitest';
import { ARCHIVE_HISTORY, ARCHIVE_KEY, archiveKey, pruneArchives, readArchive, recoverArchive, resumeArchive, retryArchive, startArchive } from '../lib/archiveState';
import { purgeStaleArchiveFiles } from '../lib/archiveFiles';
import type { ArchiveBatch, ImageResult } from '../lib/types';

const DAY = 86400000;
const now = new Date('2026-06-15T12:00:00Z').getTime();
const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

function record(id: string, patch: Partial<ArchiveBatch> = {}, ageMs = 0): ArchiveBatch {
  return {
    id, title: id, filename: `${id}.zip`, pageUrl: `https://example.org/${id}`, sourceTabId: 1, status: 'complete', started: now - ageMs, updated: now - ageMs, bytes: 1, message: '',
    items: [{ id: '0', url: 'https://images.example.org/0.jpg', kind: 'large', filename: '001_0.jpeg', status: 'complete', bytes: 1 }], ...patch,
  };
}
function store(initial: ArchiveBatch[] = [], legacy?: ArchiveBatch) {
  const data: Record<string, unknown> = Object.fromEntries(initial.map(batch => [archiveKey(batch.id), structuredClone(batch)]));
  if (legacy) data[ARCHIVE_KEY] = structuredClone(legacy);
  const pick = (keys?: string | string[] | null) => {
    const all = structuredClone(data);
    if (keys == null) return all;
    return Object.fromEntries(([] as string[]).concat(keys).filter(key => key in all).map(key => [key, all[key]]));
  };
  const local = {
    get: vi.fn(async (keys?: string | string[] | null) => pick(keys)),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, structuredClone(values)); }),
    remove: vi.fn(async (keys: string | string[]) => { for (const key of ([] as string[]).concat(keys)) delete data[key]; }),
  };
  return { data, local, ids: () => Object.keys(data).map(key => key.replace(`${ARCHIVE_KEY}:`, '')).sort() };
}
function stubChrome(local: ReturnType<typeof store>['local'], extra: Record<string, unknown> = {}) {
  vi.stubGlobal('chrome', { storage: { local }, runtime: { getURL: (value: string) => value }, permissions: { contains: async () => true }, ...extra });
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function freeze() { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); }

it('documents the retention parameters in one place', () => {
  expect(ARCHIVE_HISTORY).toEqual({ maxAgeMs: 7 * DAY, maxChains: 20 });
});

it('removes terminal records older than the retention age and keeps newer ones', async () => {
  freeze();
  const s = store([record('old', {}, 8 * DAY), record('edge', {}, 7 * DAY - 1000), record('fresh', {}, DAY), record('oldfail', { status: 'failed', cacheUntil: now - 1000 }, 9 * DAY), record('oldcancel', { status: 'cancelled' }, 30 * DAY)]);
  stubChrome(s.local);
  expect(await pruneArchives()).toBe(3);
  expect(s.ids()).toEqual(['edge', 'fresh']);
});

it('never removes active tasks, however old, nor unexpired resumable caches', async () => {
  freeze();
  const records = ['queued', 'fetching', 'packing', 'saving'].map(status => record(status, { status: status as ArchiveBatch['status'] }, 40 * DAY));
  records.push(record('resumable', { status: 'failed', cacheUntil: now + 1000 }, 40 * DAY));
  records.push(record('cancelled-resumable', { status: 'cancelled', cacheUntil: now + 1000 }, 40 * DAY));
  const s = store(records);
  stubChrome(s.local);
  expect(await pruneArchives()).toBe(0);
  expect(await pruneArchives({ aggressive: true })).toBe(0);
  expect(s.ids()).toHaveLength(6);
  expect(s.local.remove).not.toHaveBeenCalled();
});

it('keeps only the newest terminal chains beyond the count cap, ordered by last update', async () => {
  freeze();
  const total = ARCHIVE_HISTORY.maxChains + 5;
  const s = store(Array.from({ length: total }, (_, index) => record(`r${String(index).padStart(2, '0')}`, {}, index * 60000)));
  stubChrome(s.local);
  expect(await pruneArchives()).toBe(5);
  expect(s.ids()).toEqual(Array.from({ length: ARCHIVE_HISTORY.maxChains }, (_, index) => `r${String(index).padStart(2, '0')}`));
});

it('count cap ignores protected chains so a running task never evicts history early', async () => {
  freeze();
  const records = Array.from({ length: ARCHIVE_HISTORY.maxChains }, (_, index) => record(`r${index}`, {}, (index + 1) * 60000));
  records.push(record('running', { status: 'fetching' }, 0));
  const s = store(records);
  stubChrome(s.local);
  expect(await pruneArchives()).toBe(0);
  expect(s.ids()).toHaveLength(ARCHIVE_HISTORY.maxChains + 1);
});

it('aggressive pruning reclaims all terminal chains and still spares protected ones', async () => {
  freeze();
  const records = Array.from({ length: 8 }, (_, index) => record(`r${index}`, {}, index * 60000));
  records.push(record('running', { status: 'saving' }, 5 * DAY), record('resumable', { status: 'failed', cacheUntil: now + 5000 }, 5 * DAY));
  const s = store(records);
  stubChrome(s.local);
  expect(await pruneArchives({ aggressive: true })).toBe(8);
  expect(s.ids()).toEqual(['resumable', 'running']);
});

it('treats a source and its retry batches as one chain protected by any live or recent member', async () => {
  freeze();
  const source = record('src', { status: 'partial', retryBatchId: 'retry', items: [{ id: '0', url: 'https://a/0', kind: 'large', filename: '001_0.jpeg', status: 'failed', error: 'x' }] }, 20 * DAY);
  // Retry is still running: the old source must stay.
  let s = store([source, record('retry', { retryOf: 'src', status: 'fetching' }, 0)]);
  stubChrome(s.local);
  expect(await pruneArchives()).toBe(0);
  // Retry recently finished: chain is as fresh as its newest member.
  s = store([source, record('retry', { retryOf: 'src', status: 'complete' }, DAY)]);
  stubChrome(s.local);
  expect(await pruneArchives()).toBe(0);
  // Retry resumable: protected.
  s = store([source, record('retry', { retryOf: 'src', status: 'failed', cacheUntil: now + 1000 }, 20 * DAY)]);
  stubChrome(s.local);
  expect(await pruneArchives()).toBe(0);
  // Everything old and terminal: the whole chain goes together, never half of it.
  s = store([source, record('retry', { retryOf: 'src', status: 'complete' }, 19 * DAY)]);
  stubChrome(s.local);
  expect(await pruneArchives()).toBe(2);
  expect(s.ids()).toEqual([]);
});

it('honours an explicit protect list for the source of a retry being launched', async () => {
  freeze();
  const s = store([record('src', { status: 'partial' }, 30 * DAY), record('other', {}, 30 * DAY)]);
  stubChrome(s.local);
  expect(await pruneArchives({ protect: ['src'] })).toBe(1);
  expect(s.ids()).toEqual(['src']);
});

it('removes both copies of a record stored under the legacy key and the per-task key', async () => {
  freeze();
  const legacyOld = record('legacy', {}, 30 * DAY);
  const s = store([legacyOld, record('keep', {}, DAY)], legacyOld);
  stubChrome(s.local);
  expect(await pruneArchives()).toBe(1);
  expect(Object.keys(s.data)).toEqual([archiveKey('keep')]);
  // An active legacy record is protected, including its duplicate.
  const active = record('legacy-active', { status: 'fetching' }, 30 * DAY);
  const t = store([active], active);
  stubChrome(t.local);
  expect(await pruneArchives()).toBe(0);
  expect(Object.keys(t.data).sort()).toEqual([ARCHIVE_KEY, archiveKey('legacy-active')].sort());
});

it('does not touch unrelated storage keys', async () => {
  freeze();
  const s = store([record('old', {}, 30 * DAY)]);
  s.data.downloadSpeed = 'low'; s.data.language = 'en'; s.data.collectOptions = { css: true };
  stubChrome(s.local);
  await pruneArchives();
  expect(s.data).toEqual({ downloadSpeed: 'low', language: 'en', collectOptions: { css: true } });
});

const image: ImageResult = { id: '0', url: 'https://a.test/a.jpg', source: '', label: '', reason: '', candidate: true, width: 0, height: 0 };

it('opportunistically prunes old history when a new ZIP task launches', async () => {
  freeze();
  const s = store([record('old', {}, 30 * DAY), record('fresh', {}, DAY)]);
  stubChrome(s.local, { tabs: { create: async () => ({ id: 50 }), get: async () => ({ id: 1 }) } });
  const created = await startArchive([image], '页面', 'https://example.org/new', 9, 'https://source.test/gallery/');
  expect((await readArchive(created.batchId))?.sourceUrl).toBe('https://source.test/gallery/');
  expect((await readArchive(created.batchId))?.pageUrl).toBe('https://example.org/new');
  expect(s.ids()).toEqual(['fresh', created.batchId].sort());
});

it('retries the launch write once after an aggressive prune when storage is full', async () => {
  freeze();
  const s = store(Array.from({ length: 6 }, (_, index) => record(`r${index}`, {}, index * 60000)));
  let full = true;
  const set = s.local.set.getMockImplementation()!;
  s.local.set.mockImplementation(async values => {
    if (full) { full = false; throw new Error('QUOTA_BYTES quota exceeded'); }
    await set(values);
  });
  const create = vi.fn(async () => ({ id: 60 }));
  stubChrome(s.local, { tabs: { create, get: async () => ({ id: 1 }) } });
  const created = await startArchive([image], '页面', 'https://example.org/new', 9);
  expect(create).toHaveBeenCalledOnce();
  expect(s.ids()).toEqual([created.batchId]);
  expect((await readArchive(created.batchId))?.tabId).toBe(60);
});

it('fails the launch with a clear message, without opening a task page, when storage stays full', async () => {
  freeze();
  const s = store([record('r0', { status: 'fetching' }, 0)]);
  s.local.set.mockRejectedValue(new Error('QUOTA_BYTES quota exceeded'));
  const create = vi.fn(async () => ({ id: 60 }));
  stubChrome(s.local, { tabs: { create, get: async () => ({ id: 1 }) } });
  await expect(startArchive([image], '页面', 'https://example.org/new', 9)).rejects.toThrow('浏览器存储空间不足');
  expect(create).not.toHaveBeenCalled();
  expect(s.ids()).toEqual(['r0']);
});

it('reclaims all unprotected history under quota pressure, even when only a few large records remain', async () => {
  freeze();
  const s = store([record('large-old-1'), record('large-old-2')]);
  const set = s.local.set.getMockImplementation()!;
  s.local.set.mockImplementation(async values => {
    if (s.data[archiveKey('large-old-1')] || s.data[archiveKey('large-old-2')]) throw new Error('QUOTA_BYTES quota exceeded');
    await set(values);
  });
  stubChrome(s.local, { tabs: { create: async () => ({ id: 61 }), get: async () => ({ id: 1 }) } });
  const created = await startArchive([image], '页面', 'https://example.org/new', 9);
  expect(s.ids()).toEqual([created.batchId]);
  expect((await readArchive(created.batchId))?.tabId).toBe(61);
});

it('does not retry or mask unrelated storage errors', async () => {
  freeze();
  const s = store();
  s.local.set.mockRejectedValue(new Error('disk exploded'));
  stubChrome(s.local, { tabs: { create: vi.fn(), get: async () => ({ id: 1 }) } });
  await expect(startArchive([image], '页面', 'https://example.org/new', 9)).rejects.toThrow('disk exploded');
  expect(s.local.set).toHaveBeenCalledOnce();
});

it('a failing cleanup never blocks starting the task', async () => {
  freeze();
  const s = store([record('old', {}, 30 * DAY)]);
  s.local.remove.mockRejectedValue(new Error('remove failed'));
  stubChrome(s.local, { tabs: { create: async () => ({ id: 51 }), get: async () => ({ id: 1 }) } });
  const created = await startArchive([image], '页面', 'https://example.org/new', 9);
  expect((await readArchive(created.batchId))?.tabId).toBe(51);
});

it('retrying a failed ZIP is never blocked by pruning its own old source', async () => {
  freeze();
  const source = record('src', { status: 'partial', sourceTabId: 7, sourceUrl: 'https://source.test/imported/', items: [{ id: '0', url: 'https://a.test/a.jpg', kind: 'large', filename: '001_a.jpeg', status: 'failed', error: 'HTTP 503' }] }, 30 * DAY);
  const s = store([source]);
  stubChrome(s.local, { tabs: { create: async () => ({ id: 52 }), get: async () => ({ id: 1 }) } });
  const created = await retryArchive('src');
  expect(s.ids()).toEqual(['src', created.batchId].sort());
  expect((await readArchive('src'))?.retryBatchId).toBe(created.batchId);
  expect((await readArchive(created.batchId))?.sourceUrl).toBe('https://source.test/imported/');
});

function opfs(names: string[]) {
  const removeEntry = vi.fn(async (_name: string, _options?: { recursive: boolean }) => {});
  const parent = { async *keys() { yield* names; }, removeEntry };
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => parent }) } });
  return removeEntry;
}

it('purges only orphaned task directories and never an active, resumable or unrelated one', async () => {
  freeze();
  const active = uuid(1), resumable = uuid(2), orphan = uuid(3), expired = uuid(4);
  const s = store([
    record(active, { status: 'fetching' }, 0),
    record(resumable, { status: 'failed', cacheUntil: now + 1000 }, 0),
    record(expired, { status: 'failed', cacheUntil: now - 1000 }, 0),
  ]);
  stubChrome(s.local);
  const removeEntry = opfs([active, resumable, orphan, expired, 'unrelated']);
  await purgeStaleArchiveFiles();
  expect(removeEntry.mock.calls.map(call => call[0]).sort()).toEqual([orphan, expired].sort());
});

it('skips directory cleanup quietly where OPFS is unavailable', async () => {
  const s = store();
  stubChrome(s.local);
  vi.stubGlobal('navigator', {});
  await expect(purgeStaleArchiveFiles()).resolves.toBeUndefined();
});

/* ---- C: resumed tasks get a fresh launch grace without rewriting the task's own time ---- */
function resumable(startedAgo: number, patch: Partial<ArchiveBatch> = {}) {
  return record('resume-me', { status: 'failed', cacheUntil: now + 3600000, tabId: 5, started: now - startedAgo, updated: now - startedAgo, message: '任务已中断', ...patch }, startedAgo);
}

it('gives a resumed task a fresh launch grace even though its original start is old', async () => {
  freeze();
  const old = resumable(3 * 3600000);
  const s = store([old]);
  stubChrome(s.local, {
    // The new task page exists but has not registered its document context yet.
    tabs: { create: async () => ({ id: 77 }), get: vi.fn(async () => ({ id: 77 })) },
    runtime: { getURL: (value: string) => value, getContexts: async () => [] },
  });
  const created = await resumeArchive('resume-me');
  expect(created.tabId).toBe(77);
  const resumed = (await readArchive('resume-me'))!;
  expect(resumed).toMatchObject({ status: 'queued', tabId: 77, started: old.started });
  expect(resumed.launched).toBe(now);
  await recoverArchive();
  expect((await readArchive('resume-me'))?.status).toBe('queued');
});

it('does not misjudge a resumed task before its tab id is recorded', async () => {
  freeze();
  const s = store([resumable(3 * 3600000)]);
  let during: string | undefined;
  stubChrome(s.local, {
    tabs: { create: async () => { await recoverArchive(); during = (await readArchive('resume-me'))?.status; return { id: 78 }; }, get: async () => { throw new Error('No tab'); } },
    runtime: { getURL: (value: string) => value, getContexts: async () => [] },
  });
  await resumeArchive('resume-me');
  expect(during).toBe('queued');
  expect((await readArchive('resume-me'))?.tabId).toBe(78);
});

it('still recovers a resumed task whose page never appeared once the grace has passed', async () => {
  freeze();
  const s = store([resumable(3 * 3600000)]);
  stubChrome(s.local, {
    tabs: { create: async () => ({ id: 79 }), get: async () => ({ id: 79 }) },
    runtime: { getURL: (value: string) => value, getContexts: async () => [] },
  });
  await resumeArchive('resume-me');
  vi.setSystemTime(now + 14000);
  await recoverArchive();
  expect((await readArchive('resume-me'))?.status).toBe('queued');
  vi.setSystemTime(now + 16000);
  await recoverArchive();
  expect(await readArchive('resume-me')).toMatchObject({ status: 'failed', message: expect.stringContaining('任务已中断'), started: now - 3 * 3600000 });
});

it('applies the same launch grace when Chrome has no getContexts and the tab id is missing', async () => {
  freeze();
  const s = store([resumable(3 * 3600000, { tabId: undefined })]);
  // Simulate a task that was launched but never got a tab: no tabId, old start, recent launch.
  s.data[archiveKey('resume-me')] = { ...(s.data[archiveKey('resume-me')] as ArchiveBatch), status: 'queued', launched: now - 1000, cacheUntil: undefined };
  stubChrome(s.local, { runtime: { getURL: (value: string) => value } });
  await recoverArchive();
  expect((await readArchive('resume-me'))?.status).toBe('queued');
  vi.setSystemTime(now + 20000);
  await recoverArchive();
  expect((await readArchive('resume-me'))?.status).toBe('failed');
});

it('keeps the legacy behaviour for a record without a launch time', async () => {
  freeze();
  const fresh = record('fresh-queued', { status: 'queued', started: now - 5000 }, 5000);
  const stale = record('stale-queued', { status: 'queued', started: now - 60000 }, 60000);
  const s = store([fresh, stale]);
  stubChrome(s.local);
  await recoverArchive();
  expect((await readArchive('fresh-queued'))?.status).toBe('queued');
  expect((await readArchive('stale-queued'))?.status).toBe('failed');
});

it('a directory removed concurrently by another page does not fail the purge or the task start', async () => {
  freeze();
  const a = uuid(5), b = uuid(6);
  const s = store();
  stubChrome(s.local);
  const removeEntry = vi.fn(async (name: string) => { if (name === a) throw new DOMException('gone', 'NotFoundError'); });
  const parent = { async *keys() { yield a; yield b; }, removeEntry };
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => parent }) } });
  await expect(purgeStaleArchiveFiles()).resolves.toBeUndefined();
  expect(removeEntry.mock.calls.map(call => call[0])).toEqual([a, b]);
});
