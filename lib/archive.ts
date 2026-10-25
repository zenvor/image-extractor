import { makeZip } from 'client-zip';
import { imageExtension } from './outputNaming.js';
import { detectImageExtension } from './imageFormat';
import { archiveActive, interruptBatch, readArchive, saveArchive } from './archiveState';
import { archiveParent, purgeStaleArchiveDirectories } from './archiveFiles';
import type { ArchiveBatch } from './types';
import { withDownloadSlot, noteDownloadResponse, MAX_GLOBAL_DOWNLOADS } from './downloadSpeed';
import { responseImageName } from './responseNaming';

export interface ArchiveDirectory {
  write(name: string, stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<void>;
  file(name: string): Promise<File>;
  remove(name: string): Promise<void>;
  cleanup(): Promise<void>;
}
export interface ArchiveDependencies {
  directory(id: string): Promise<ArchiveDirectory>;
  fetch: typeof fetch;
  persist(batch: ArchiveBatch): Promise<void>;
  publish(file: File, batch: ArchiveBatch, signal: AbortSignal): Promise<void>;
  schedule?<T>(url: string, signal: AbortSignal, work: () => Promise<T>): Promise<T>;
  response?(url: string, response: Response): Promise<void>;
  /** Transfer workers; the shared scheduler still enforces current policy and cooldowns. */
  concurrency?: number;
  /** Milliseconds to wait for response headers, and between body chunks. Tests inject short values. */
  timeouts?: { headers: number; stall: number };
}

const MAX_IMAGE_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_TIMEOUTS = { headers: 30000, stall: 30000 };

/**
 * One image attempt has no total deadline: only a missing response (headers) or a body that stops
 * making progress (stall, including a stuck OPFS write) aborts it. Every chunk re-arms the stall timer.
 */
function transferGuard(signal: AbortSignal, limits: { headers: number; stall: number }) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number, reason: () => Error) => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(reason()), ms);
  };
  const headerTimeout = () => new DOMException('The operation timed out', 'TimeoutError');
  const stallTimeout = () => Object.assign(new Error('图像下载停滞，30 秒内没有收到数据，请检查网络后重试。'), { name: 'StallError' });
  arm(limits.headers, headerTimeout);
  return {
    signal: AbortSignal.any([signal, controller.signal]),
    /** Response headers arrived: from here on only silence between chunks counts. */
    started: () => arm(limits.stall, stallTimeout),
    progress: () => arm(limits.stall, stallTimeout),
    dispose() { clearTimeout(timer); controller.abort(); },
  };
}

async function guarded<T>(signal: AbortSignal, limits: { headers: number; stall: number }, work: (guard: ReturnType<typeof transferGuard>) => Promise<T>) {
  const guard = transferGuard(signal, limits);
  try { return await work(guard); } finally { guard.dispose(); }
}

function message(error: unknown) {
  if (!(error instanceof Error)) return '下载失败，请重试。';
  if (error.name === 'TimeoutError') return '图像请求超时（30 秒），请检查网络后重试。';
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return '无法连接图像地址，请检查网络或网站访问限制。';
  return error.message;
}
function abortReason(signal: AbortSignal) { return signal.reason instanceof Error ? signal.reason : new Error('下载已取消。'); }

/** Scheduled transfers + OPFS files + streaming ZIP. No image-sized arrays. */
export async function buildArchive(batch: ArchiveBatch, dependencies: ArchiveDependencies, signal: AbortSignal) {
  let directory: ArchiveDirectory | undefined;
  // Serialize writes so parallel fetch completions cannot publish stale snapshots.
  let previousSave = Promise.resolve();
  let lastPersist = 0;
  async function persist(force = false) {
    if (!force && Date.now() - lastPersist < 500) return;
    lastPersist = Date.now();
    const previous = previousSave;
    let release!: () => void;
    previousSave = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { await dependencies.persist(structuredClone(batch)); } finally { release(); }
  }
  try {
    signal.throwIfAborted();
    directory = await dependencies.directory(batch.id);
    // Verify retained complete files before reuse. Never trust a status flag alone.
    batch.bytes = 0;
    for (const [index, item] of batch.items.entries()) {
      if (item.status !== 'complete' || !item.bytes) { item.status = 'pending'; continue; }
      try {
        const file = await directory.file(`${index}.image`);
        if (file.size !== item.bytes) throw new Error('缓存大小不匹配');
        const format = detectImageExtension(new Uint8Array(await file.slice(0, 1024).arrayBuffer()));
        if (imageExtension(item.filename) !== imageExtension(format)) throw new Error('缓存格式不匹配');
        batch.bytes += file.size;
      } catch { item.status = 'pending'; delete item.bytes; }
    }
    batch.status = 'fetching'; batch.message = '正在下载图像…';
    await persist(true);
    let next = 0;
    let fatal: unknown;
    async function worker() {
      while (next < batch.items.length && !fatal) {
        signal.throwIfAborted();
        const index = next++;
        const item = batch.items[index]!;
        if (item.status === 'complete') continue;
        const diskName = `${index}.image`;
        for (let attempt = 0; attempt <= 1; attempt++) {
          let received = 0;
          try {
            const transfer = () => guarded(signal, dependencies.timeouts || DEFAULT_TIMEOUTS, async guard => {
              const requestSignal = guard.signal;
              const response = await dependencies.fetch(item.url, { credentials: 'include', signal: requestSignal });
              guard.started();
              if (!response.ok) {
                await response.body?.cancel();
                await dependencies.response?.(item.url, response);
                throw new Error(response.status === 429 || response.status === 503 ? `HTTP ${response.status}：网站繁忙或限流，已降低请求频率并等待后重试。` : `HTTP ${response.status}`);
              }
              if (!response.body) throw new Error('图像响应为空。');
              const contentType = response.headers.get('content-type')?.split(';')[0] || '';
              if (/html|json/i.test(contentType)) { await response.body.cancel(); throw new Error('返回了验证页或错误页面。'); }
              const size = Number(response.headers.get('content-length'));
              if (size > MAX_IMAGE_BYTES) { await response.body.cancel(); throw new Error('单张图像超过 128 MB。'); }
              const header = new Uint8Array(1024);
              let headerSize = 0;
              const inspected = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                  guard.progress();
                  received += chunk.length;
                  if (received > MAX_IMAGE_BYTES) throw new Error('单张图像超过 128 MB。');
                  if (batch.bytes + received > MAX_ARCHIVE_BYTES) throw new Error('本次图像总量超过 4 GB，请减少选择。');
                  const head = chunk.subarray(0, header.length - headerSize);
                  header.set(head, headerSize); headerSize += head.length;
                  controller.enqueue(chunk);
                },
              }));
              await directory!.write(diskName, inspected, requestSignal);
              const extension = detectImageExtension(header.subarray(0, headerSize));
              const file = await directory!.file(diskName);
              if (!file.size) throw new Error('图像文件为空。');
              await dependencies.response?.(item.url, response);
              // Reserve bytes without yielding after the final async callback.
              if (batch.bytes + file.size > MAX_ARCHIVE_BYTES) throw new Error('本次图像总量超过 4 GB，请减少选择。');
              batch.bytes += file.size;
              item.filename = responseImageName(item.filename, item.url, response.headers.get('content-disposition') || '', extension);
              item.status = 'complete'; item.bytes = file.size; delete item.error;
            });
            if (dependencies.schedule) await dependencies.schedule(item.url, signal, transfer);
            else await transfer();
            break;
          } catch (error) {
            try { await directory!.remove(diskName); } catch { /* no partial file */ }
            if (signal.aborted) throw abortReason(signal);
            if (error instanceof Error && /Quota|空间|4 GB/i.test(error.name + error.message)) { fatal = error; break; }
            item.error = message(error);
            if (attempt === 1) item.status = 'failed';
          }
        }
        batch.message = `已处理 ${batch.items.filter(item => item.status !== 'pending').length} / ${batch.items.length} 张`;
        await persist();
      }
    }
    const outcomes = await Promise.allSettled(Array.from({ length: Math.min(dependencies.concurrency ?? MAX_GLOBAL_DOWNLOADS, batch.items.length) }, worker));
    if (fatal) throw fatal;
    signal.throwIfAborted();
    const rejected = outcomes.find(outcome => outcome.status === 'rejected');
    if (rejected?.status === 'rejected') throw rejected.reason;
    const completed = batch.items.filter(item => item.status === 'complete').length;
    if (!completed) throw new Error('所有图像均下载失败，请检查权限、网络或图像网站验证。');
    batch.status = 'packing'; batch.message = '正在生成 ZIP…'; await persist(true);
    async function* entries() {
      for (const [index, item] of batch.items.entries()) {
        signal.throwIfAborted();
        if (item.status === 'complete') yield { name: item.filename, input: await directory!.file(`${index}.image`), lastModified: batch.started };
      }
      const failed = batch.items.filter(item => item.status === 'failed');
      if (failed.length) yield {
        name: '下载失败.txt', lastModified: batch.started,
        input: new TextEncoder().encode(failed.map(item => `${item.filename}\n${item.url}\n${item.error}\n`).join('\n')),
      };
    }
    await directory.write('archive.zip', makeZip(entries()), signal);
    batch.status = 'saving'; batch.message = '正在保存 ZIP…'; await persist(true);
    await dependencies.publish(await directory.file('archive.zip'), batch, signal);
    const failed = batch.items.length - completed;
    delete batch.cacheUntil;
    batch.status = failed ? 'partial' : 'complete';
    batch.message = failed ? `ZIP 已保存：${completed} 张成功，${failed} 张失败。包内附失败清单。` : `ZIP 已保存，共 ${completed} 张图像。`;
    await persist(true);
  } catch (error) {
    batch.status = signal.aborted ? 'cancelled' : 'failed';
    if (batch.items.some(item => item.status === 'complete' && item.bytes)) batch.cacheUntil = Date.now() + 86400000;
    batch.message = message(error); await persist(true);
  } finally {
    try { if (!batch.cacheUntil || batch.status === 'complete' || batch.status === 'partial') await directory?.cleanup(); } catch { /* stale files are reclaimed next run */ }
  }
}

export async function opfsDirectory(id: string): Promise<ArchiveDirectory> {
  if (!navigator.storage?.getDirectory) throw new Error('浏览器不支持临时文件，请更新 Chrome。');
  const parent = await archiveParent();
  // Cleanup is opportunistic: an unreadable history or directory listing must not block this task.
  // Concurrent task pages own separate directories; only orphans and expired caches are purged.
  await purgeStaleArchiveDirectories(parent, id).catch(() => {});
  const directory = await parent.getDirectoryHandle(id, { create: true });
  return {
    async write(name, stream, signal) {
      const handle = await directory.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await stream.pipeTo(writable, { signal });
    },
    async file(name) { return (await directory.getFileHandle(name)).getFile(); },
    async remove(name) { await directory.removeEntry(name); },
    async cleanup() { await parent.removeEntry(id, { recursive: true }); },
  };
}

export async function publishArchive(file: File, batch: ArchiveBatch, signal: AbortSignal) {
  if (!(await chrome.permissions.contains({ permissions: ['downloads'] })) || !chrome.downloads) throw new Error('下载权限已失效，请重新允许后重试。');
  const url = URL.createObjectURL(file);
  let id: number | undefined;
  try {
    signal.throwIfAborted();
    id = await chrome.downloads.download({ url, filename: batch.filename, conflictAction: 'uniquify', saveAs: false });
    batch.downloadId = id;
    const current = await readArchive(batch.id);
    if (current?.id === batch.id && current.status === 'saving') await saveArchive({ ...current, downloadId: id });
    while (true) {
      signal.throwIfAborted();
      if (!chrome.downloads) throw new Error('下载权限已撤回。');
      const [download] = await chrome.downloads.search({ id });
      if (download?.state === 'complete') break;
      if (!download || download.state === 'interrupted') throw new Error(download?.error || 'ZIP 保存已中断。');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) {
    if (id !== undefined && chrome.downloads) { try { await chrome.downloads.cancel(id); } catch { /* already stopped */ } }
    throw error;
  } finally { URL.revokeObjectURL(url); }
}

export async function runArchive(id: string, signal: AbortSignal) {
  let batch = await readArchive(id);
  for (let tries = 0; batch?.id === id && batch.status === 'queued' && batch.tabId === undefined && tries < 50; tries++) {
    signal.throwIfAborted();
    await new Promise(resolve => setTimeout(resolve, 50));
    batch = await readArchive(id);
  }
  if (batch?.id !== id || !archiveActive(batch)) return;
  if (batch.tabId === undefined) { await saveArchive({ ...batch, status: 'failed', message: '下载任务页初始化失败，请重试。' }); return; }
  const owner = await chrome.tabs.getCurrent();
  if (owner?.id !== batch.tabId) return;
  if (batch.status !== 'queued') {
    await interruptBatch(batch, '任务已中断，请从弹窗重新发起下载。'); return;
  }
  await buildArchive(batch, {
    directory: opfsDirectory, fetch: globalThis.fetch.bind(globalThis), publish: publishArchive,
    schedule: (url, signal, work) => withDownloadSlot(url, signal, work, undefined, batch!.id), response: noteDownloadResponse,
    concurrency: MAX_GLOBAL_DOWNLOADS,
    async persist(updated) {
      const current = await readArchive(id);
      if (current?.id !== id || (!archiveActive(current) && archiveActive(updated))) throw new Error('任务已结束。');
      await saveArchive({ ...updated, tabId: current.tabId });
    },
  }, signal);
}
