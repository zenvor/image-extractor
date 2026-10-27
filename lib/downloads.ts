import type { DownloadBatch, ImageResult } from './types';
import { imageExtension, numberedImageName } from './outputNaming.js';
import { imageUrl, isInlineImage } from './imageSource';

/** Let Chrome stream a single image to disk; no ZIP, fetch/blob buffer or task tab. */
export async function downloadSingleImage(item: ImageResult): Promise<number> {
  const url = imageUrl(item.url, item.url);
  if (!url) throw new Error('图像地址无效，无法下载。');
  const options: chrome.downloads.DownloadOptions = { url, conflictAction: 'uniquify', saveAs: false };
  if (isInlineImage(url)) {
    const mime = /^data:([^;,]+)/i.exec(url)![1]!;
    options.filename = numberedImageName(1, imageExtension('', mime), item.label || 'image').slice(4);
  }
  // For remote files Chrome uses the response filename/type, including Content-Disposition.
  return chrome.downloads.download(options);
}

export const DOWNLOAD_KEY = 'downloadBatch';
export function downloadFilename(item: ImageResult, index: number, pageUrl: string): string {
  const clean = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 100) || 'image';
  return `thumb2original/${clean(new URL(pageUrl).host)}/${item.candidate ? 'large' : 'small'}/${numberedImageName(index + 1, imageExtension(item.url), item.url)}`;
}
export async function readBatch(): Promise<DownloadBatch | undefined> {
  return (await chrome.storage.session.get(DOWNLOAD_KEY))[DOWNLOAD_KEY] as DownloadBatch | undefined;
}
async function saveBatch(batch: DownloadBatch) {
  await chrome.storage.session.set({ [DOWNLOAD_KEY]: batch });
}
export function batchActive(batch?: DownloadBatch): boolean {
  return !!batch?.jobs.some(item => ['pending', 'starting', 'in_progress'].includes(item.status));
}
export async function failDownloads(message: string) {
  const batch = await readBatch();
  if (!batchActive(batch) || !batch) return;
  for (const job of batch.jobs) {
    if (!['pending', 'starting', 'in_progress'].includes(job.status)) continue;
    job.status = 'failed';
    job.error = message;
  }
  await saveBatch(batch);
}

// Called in sequence by the worker. Durable job state survives popup/worker closure.
export async function advanceDownloads(recover = false) {
  const batch = await readBatch();
  if (!batch) return;
  for (const job of batch.jobs) {
    if (job.status === 'starting' && recover) {
      job.status = 'failed';
      job.error = '启动状态无法确认，请在 Chrome 下载列表检查后手动重试。';
    }
    if (job.status === 'in_progress' && job.downloadId !== undefined) {
      const [item] = await chrome.downloads.search({ id: job.downloadId });
      if (item?.state === 'in_progress') { await saveBatch(batch); return; }
      job.status = item?.state === 'complete' ? 'complete' : 'failed';
      if (job.status === 'failed') job.error = item?.error || '下载任务已移除或中断';
    }
    if (job.status === 'starting') return;
  }
  await saveBatch(batch);
  for (const job of batch.jobs) {
    if (job.status !== 'pending') continue;
    job.status = 'starting';
    await saveBatch(batch);
    try {
      job.downloadId = await chrome.downloads.download({ url: job.url, filename: job.filename, conflictAction: 'uniquify', saveAs: false });
      job.status = 'in_progress';
      await saveBatch(batch);
      // Fast local downloads may finish before their id is stored. Reconcile here.
      const [item] = await chrome.downloads.search({ id: job.downloadId });
      if (item?.state === 'in_progress') return;
      job.status = item?.state === 'complete' ? 'complete' : 'failed';
      if (job.status === 'failed') job.error = item?.error || '下载启动后未找到任务';
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : '下载启动失败';
    }
    await saveBatch(batch);
  }
}

export async function startDownloads(results: ImageResult[], pageUrl: string) {
  if (!(await chrome.permissions.contains({ permissions: ['downloads'] }))) throw new Error('请先允许下载权限。');
  if (batchActive(await readBatch())) throw new Error('已有下载正在进行，请在 Chrome 下载列表查看进度。');
  const urls = new Set<string>();
  const jobs = results.filter(item => {
    const url = new URL(item.url);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || urls.has(item.url)) return false;
    urls.add(item.url);
    return true;
  }).map((item, index) => ({ url: item.url, filename: downloadFilename(item, index, pageUrl), status: 'pending' as const }));
  if (!jobs.length) throw new Error('请先选择要下载的图像。');
  await saveBatch({ id: crypto.randomUUID(), jobs });
  await advanceDownloads();
}
