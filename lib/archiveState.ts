import { isInlineImage } from './imageSource';
import { allocateImageNames, archiveFilename, MAX_ARCHIVE_IMAGES } from './outputNaming.js';
import type { ArchiveBatch, ImageResult } from './types';

export const ARCHIVE_KEY = 'archiveBatch';
export function archiveActive(batch?: ArchiveBatch) {
  return !!batch && ['queued', 'fetching', 'packing', 'saving'].includes(batch.status);
}
export const archiveKey = (id: string) => `${ARCHIVE_KEY}:${id}`;
export const isArchiveKey = (key: string) => key === ARCHIVE_KEY || key.startsWith(`${ARCHIVE_KEY}:`);

/**
 * Retention for finished task records in chrome.storage.local (10 MiB quota; a 2000-image record is
 * about 300 KiB). A source batch and its retry batches form one chain that is kept or removed whole.
 * Chains with an active task or an unexpired resumable cache are never removed. Cleanup runs
 * opportunistically (task launch, popup open) rather than on a timer, so age is a lower bound only.
 */
export const ARCHIVE_HISTORY = { maxAgeMs: 7 * 86400000, maxChains: 20 } as const;
const LAUNCH_GRACE_MS = 15000;
// A resumed task keeps its original `started`; its page is judged by when it was last launched.
const launching = (batch: ArchiveBatch) => Date.now() - (batch.launched ?? batch.started) < LAUNCH_GRACE_MS;

export function archivesFromStorage(values: Record<string, unknown>): ArchiveBatch[] {
  const batches = new Map<string, ArchiveBatch>();
  const legacy = values[ARCHIVE_KEY] as ArchiveBatch | undefined;
  if (legacy?.id) batches.set(legacy.id, legacy);
  for (const [key, value] of Object.entries(values)) {
    const batch = value as ArchiveBatch | undefined;
    if (key.startsWith(`${ARCHIVE_KEY}:`) && batch?.id) batches.set(batch.id, batch);
  }
  return [...batches.values()];
}
export function archiveForPage(batches: ArchiveBatch[], tabId: number | undefined, url: string) {
  return batches.filter(batch => tabId !== undefined && batch.sourceTabId === tabId && batch.pageUrl === url)
    .sort((a, b) => Number(archiveActive(b)) - Number(archiveActive(a)) || b.started - a.started)[0];
}
export async function readArchives(): Promise<ArchiveBatch[]> {
  return archivesFromStorage(await chrome.storage.local.get(null));
}
export async function readArchive(id: string): Promise<ArchiveBatch | undefined> {
  const values = await chrome.storage.local.get([archiveKey(id), ARCHIVE_KEY]);
  const batch = (values[archiveKey(id)] || values[ARCHIVE_KEY]) as ArchiveBatch | undefined;
  return batch?.id === id ? batch : undefined;
}
export async function saveArchive(batch: ArchiveBatch) {
  await chrome.storage.local.set({ [archiveKey(batch.id)]: { ...batch, updated: Date.now() } });
}

export async function removeArchiveRecords(ids: string[], completedOnly = false) {
  const values = await chrome.storage.local.get(null);
  const requested = new Set(ids);
  const removable = new Set(archivesFromStorage(values)
    .filter(batch => requested.has(batch.id) && !archiveActive(batch) && (!completedOnly || batch.status === 'complete'))
    .map(batch => batch.id));
  const keys = Object.entries(values).filter(([key, value]) => isArchiveKey(key) && removable.has((value as ArchiveBatch | undefined)?.id || '')).map(([key]) => key);
  if (keys.length) await chrome.storage.local.remove(keys);
  return removable.size;
}

let archivePageTabId: number | undefined;
let openingArchivePage: Promise<chrome.tabs.Tab> | undefined;

/** The background queue shares one owner page, including concurrent launches while it loads. */
export async function openArchivePage(active = true): Promise<chrome.tabs.Tab> {
  if (!openingArchivePage) {
    openingArchivePage = (async () => {
      const url = chrome.runtime.getURL('/download.html');
      if (archivePageTabId !== undefined) {
        try {
          const tab = await chrome.tabs.get(archivePageTabId);
          if (tab.url === url) return tab;
        } catch { /* closed: discover another manager or create one */ }
        archivePageTabId = undefined;
      }
      const contexts = await chrome.runtime.getContexts?.({ contextTypes: ['TAB'], documentUrls: [url] }) || [];
      for (const context of contexts) {
        if (context.tabId < 0) continue;
        try {
          const tab = await chrome.tabs.get(context.tabId);
          if (tab.url === url) { archivePageTabId = tab.id; return tab; }
        } catch { /* closed between discovery and activation */ }
      }
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab.id === undefined) throw new Error('无法打开下载任务页，请重试。');
      archivePageTabId = tab.id;
      return tab;
    })().finally(() => { openingArchivePage = undefined; });
  }
  const tab = await openingArchivePage;
  if (active) await chrome.tabs.update(tab.id!, { active: true });
  return tab;
}

/** Removes old terminal task chains; returns how many records were removed. */
export async function pruneArchives(options: { aggressive?: boolean; protect?: string[] } = {}) {
  const now = Date.now();
  const copies = new Map<string, { keys: string[]; batches: ArchiveBatch[] }>();
  for (const [key, value] of Object.entries(await chrome.storage.local.get(null))) {
    const batch = value as ArchiveBatch | undefined;
    if (!isArchiveKey(key) || !batch?.id) continue;
    const entry = copies.get(batch.id) || { keys: [], batches: [] };
    entry.keys.push(key); entry.batches.push(batch); copies.set(batch.id, entry);
  }
  const parent = new Map<string, string>();
  const root = (id: string): string => (parent.get(id) && parent.get(id) !== id ? root(parent.get(id)!) : id);
  for (const [id, { batches }] of copies) {
    for (const link of batches.flatMap(batch => [batch.retryOf, batch.retryBatchId])) {
      if (link && copies.has(link) && root(link) !== root(id)) parent.set(root(link), root(id));
    }
  }
  const chains = new Map<string, string[]>();
  for (const id of copies.keys()) chains.set(root(id), [...(chains.get(root(id)) || []), id]);
  const keep = new Set(options.protect);
  const candidates = [...chains.values()].map(ids => {
    const batches = ids.flatMap(id => copies.get(id)!.batches);
    return {
      ids, updated: Math.max(...batches.map(batch => batch.updated || batch.started || 0)),
      protectedChain: ids.some(id => keep.has(id)) || batches.some(batch => archiveActive(batch) || (batch.cacheUntil || 0) > now),
    };
  }).filter(chain => !chain.protectedChain).sort((a, b) => b.updated - a.updated);
  // Under quota pressure even one large terminal record can block a new task. Protected chains
  // were excluded above; reclaim every remaining chain before retrying the failed write once.
  const limit = options.aggressive ? 0 : ARCHIVE_HISTORY.maxChains;
  const doomed = candidates.filter((chain, index) => index >= limit || now - chain.updated > ARCHIVE_HISTORY.maxAgeMs);
  const keys = doomed.flatMap(chain => chain.ids.flatMap(id => copies.get(id)!.keys));
  if (keys.length) await chrome.storage.local.remove(keys);
  return doomed.reduce((total, chain) => total + chain.ids.length, 0);
}
export function requiredOrigins(urls: string[]): string[] {
  return [...new Set(urls.filter(value => !isInlineImage(value)).map(value => {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('图像地址无效。');
    // Match patterns grant a hostname, including all ports on that hostname.
    return `${url.protocol}//${url.hostname}/*`;
  }))];
}
export async function startArchive(results: ImageResult[], title: string, pageUrl: string, sourceTabId: number, sourceUrl?: string) {
  const previous = archiveForPage(await readArchives(), sourceTabId, pageUrl);
  if (archiveActive(previous)) {
    let live = false;
    if (previous?.tabId !== undefined) {
      try { live = !!(await chrome.tabs.get(previous.tabId)); } catch { /* closed */ }
    } else live = !!previous && launching(previous);
    if (live) throw new Error('当前页面已有 ZIP 任务正在进行，请查看下载任务页。');
  }
  const seen = new Set<string>();
  const unique = results.filter(item => {
    if (seen.has(item.url)) return false;
    requiredOrigins([item.url]); seen.add(item.url); return true;
  });
  if (!unique.length) throw new Error('请先选择要下载的图像。');
  if (unique.length > MAX_ARCHIVE_IMAGES) throw new Error(`每次最多下载 ${MAX_ARCHIVE_IMAGES} 张图像，请减少选择。`);
  if (!(await chrome.permissions.contains({ permissions: ['downloads'], origins: requiredOrigins(unique.map(item => item.url)) }))) {
    throw new Error('请允许下载权限和所选图像网站的访问权限。');
  }
  const names = allocateImageNames(unique.map(item => ({ url: item.url, kind: item.candidate ? 'large' : 'small' })));
  const batch: ArchiveBatch = {
    id: crypto.randomUUID(), title, pageUrl, sourceTabId, sourceUrl, filename: archiveFilename(title, new URL(pageUrl).hostname),
    started: Date.now(), updated: Date.now(), status: 'queued', bytes: 0, message: '准备下载图像…',
    items: unique.map((item, index) => ({ id: item.id, url: item.url, kind: item.candidate ? 'large' : 'small', filename: names[index]!, status: 'pending' })),
  };
  return await launchArchive(batch);
}

// Cleanup never blocks a task; only a still-full storage after an aggressive prune does.
async function saveNewArchive(batch: ArchiveBatch) {
  const protect = batch.retryOf ? [batch.id, batch.retryOf] : [batch.id];
  await pruneArchives({ protect }).catch(() => {});
  try { await saveArchive(batch); } catch (error) {
    if (!/quota/i.test(error instanceof Error ? error.message : '')) throw error;
    await pruneArchives({ aggressive: true, protect }).catch(() => {});
    try { await saveArchive(batch); } catch (retryError) {
      if (!/quota/i.test(retryError instanceof Error ? retryError.message : '')) throw retryError;
      throw new Error('浏览器存储空间不足，无法启动下载，请稍后重试。');
    }
  }
}

async function launchArchive(source: ArchiveBatch) {
  const batch = { ...source, launched: Date.now() };
  await saveNewArchive(batch);
  try {
    const tab = await openArchivePage(false);
    // A very fast task page can already have advanced its state. Only patch tabId.
    const current = await readArchive(batch.id);
    if (current?.id === batch.id) await saveArchive({ ...current, tabId: tab.id });
    return { batchId: batch.id, tabId: tab.id };
  } catch (error) {
    await saveArchive({ ...batch, status: 'failed', message: '无法打开下载任务页，请重试。' });
    throw error;
  }
}
export function canRetryArchive(batch?: ArchiveBatch) {
  return !!batch && !batch.retryBatchId && batch.items.some(item => item.status === 'failed') &&
    (batch.status === 'partial' || (batch.status === 'failed' && batch.items.every(item => item.status === 'failed')));
}

// Called through the background's ordered download queue, never concurrently.
export async function retryArchive(id: string) {
  const previous = await readArchive(id);
  if (previous?.retryBatchId) throw new Error('已发起重试，请查看重试任务。');
  if (!canRetryArchive(previous)) throw new Error('此任务没有可单独重试的失败图像。');
  const source = previous!;
  const active = (await readArchives()).find(batch => archiveActive(batch) && batch.sourceTabId === source.sourceTabId && batch.pageUrl === source.pageUrl);
  if (active) throw new Error('当前页面已有下载任务进行中，请等待完成。');
  const failed = source.items.filter(item => item.status === 'failed');
  if (!(await chrome.permissions.contains({ permissions: ['downloads'], origins: requiredOrigins(failed.map(item => item.url)) }))) {
    throw new Error('请允许下载权限和失败图像网站的访问权限。');
  }
  const batch: ArchiveBatch = {
    id: crypto.randomUUID(), retryOf: source.id, title: source.title, pageUrl: source.pageUrl, sourceTabId: source.sourceTabId, sourceUrl: source.sourceUrl,
    filename: archiveFilename(source.title, new URL(source.pageUrl).hostname).replace(/\.zip$/, '-失败图片.zip'),
    started: Math.max(Date.now(), source.started + 1), updated: Date.now(), status: 'queued', bytes: 0,
    message: `准备重试 ${failed.length} 张失败图像…`,
    // Keep original numbering and mixed-size subfolders; never reallocate names.
    items: failed.map(({ error: _error, ...item }) => ({ ...item, status: 'pending' })),
  };
  const created = await launchArchive(batch);
  await saveArchive({ ...source, retryBatchId: batch.id });
  return created;
}

export async function interruptBatch(batch: ArchiveBatch, reason: string) {
  if (!archiveActive(batch)) return;
  if (batch.downloadId !== undefined && chrome.downloads) {
    try {
      const [download] = await chrome.downloads.search({ id: batch.downloadId });
      if (download?.state === 'complete') {
        const partial = batch.items.some(item => item.status === 'failed');
        await saveArchive({ ...batch, status: partial ? 'partial' : 'complete', message: partial ? 'ZIP 已保存，部分图像失败。包内附失败清单。' : 'ZIP 已保存。' });
        return;
      }
      await chrome.downloads.cancel(batch.downloadId);
    } catch { /* permission may already have been revoked */ }
  }
  await saveArchive({ ...batch, status: 'failed', message: reason, cacheUntil: batch.items.some(item => item.status === 'complete' && item.bytes) ? Date.now() + 86400000 : undefined });
}
export async function interruptArchive(tabId: number, reason = '下载任务页已关闭，请重新发起 ZIP 下载。') {
  for (const batch of await readArchives()) {
    if (batch.tabId === tabId) await interruptBatch(batch, reason);
  }
}

export async function recoverArchive(browserRestart = false) {
  for (const batch of await readArchives()) {
    if (!archiveActive(batch)) continue;
    if (!browserRestart && batch.tabId !== undefined) {
      try {
        if (chrome.runtime.getContexts && !(batch.status === 'queued' && launching(batch))) {
          const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [chrome.runtime.getURL('/download.html'), chrome.runtime.getURL(`/download.html?batch=${batch.id}`)] });
          if (contexts.some(context => context.tabId === batch.tabId)) continue;
        } else if (await chrome.tabs.get(batch.tabId)) continue;
      } catch { /* task page no longer exists */ }
    } else if (!browserRestart && launching(batch)) continue;
    // Re-read this task; another task's progress must never be overwritten here.
    const current = await readArchive(batch.id);
    if (current) await interruptBatch(current, batch.tabId === undefined ? '任务未能启动，请重新发起 ZIP 下载。' : '任务已中断，请重新发起 ZIP 下载。');
  }
}

export function canResumeArchive(batch?: ArchiveBatch) {
  return !!batch && !batch.retryBatchId && ['failed', 'cancelled'].includes(batch.status) && (batch.cacheUntil || 0) > Date.now();
}
// Same batch, same filenames; ownership moves to one newly allocated task page.
export async function resumeArchive(id: string) {
  const batch = await readArchive(id);
  if (!canResumeArchive(batch)) throw new Error('此任务没有可恢复的缓存，请重新下载。');
  const source = batch!;
  if ((await readArchives()).some(other => archiveActive(other) && other.sourceTabId === source.sourceTabId && other.pageUrl === source.pageUrl)) throw new Error('当前网页已有下载进行中。');
  if (!(await chrome.permissions.contains({ permissions: ['downloads'], origins: requiredOrigins(source.items.map(item => item.url)) }))) throw new Error('请先允许下载权限。');
  if (source.downloadId !== undefined) {
    const [download] = await chrome.downloads.search({ id: source.downloadId });
    if (download?.state === 'complete') { await saveArchive({ ...source, status: source.items.some(item => item.status === 'failed') ? 'partial' : 'complete' }); throw new Error('原 ZIP 已保存，请查看 Chrome 下载列表。'); }
  }
  const { tabId: _owner, downloadId: _download, ...rest } = source;
  return launchArchive({ ...rest, status: 'queued', message: '正在核验缓存并继续下载…' });
}
