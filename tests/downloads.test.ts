import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceDownloads, batchActive, downloadFilename, downloadSingleImage, readBatch, startDownloads } from '../lib/downloads';
import { selectBySize } from '../lib/selection';
import type { DownloadBatch, ImageResult } from '../lib/types';

const results: ImageResult[] = [
  { id: '0', url: 'https://example.org/full.jpg', source: '', label: '大图', reason: '大图 · 路径规则', candidate: true, width: 100, height: 100 },
  { id: '1', url: 'https://example.org/thumb.jpg', source: '', label: '小图', reason: '小图 · 页面源图', candidate: false, width: 100, height: 100 },
];
let stored: { downloadBatch?: DownloadBatch };
let download: ReturnType<typeof vi.fn>;
let states: Record<number, string>;
beforeEach(() => {
  stored = {};
  states = {};
  let nextId = 1;
  download = vi.fn(async () => { const id = nextId++; states[id] = 'in_progress'; return id; });
  vi.stubGlobal('chrome', {
    permissions: { contains: async () => true },
    storage: { session: { get: async () => structuredClone(stored), set: async (value: typeof stored) => { Object.assign(stored, structuredClone(value)); } } },
    downloads: { download, search: async ({ id }: { id: number }) => [{ id, state: states[id], error: states[id] === 'interrupted' ? 'SERVER_FORBIDDEN' : undefined }] },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('size selection and download paths', () => {
  it('replaces the selection with large, small or both, rather than hiding still-selected rows', () => {
    expect(selectBySize(results, 'large')).toEqual(['0']);
    expect(selectBySize(results, 'small')).toEqual(['1']);
    expect(selectBySize(results, 'all')).toEqual(['0', '1']);
  });
  it('returns an empty selection when the requested group has no images', () => {
    expect(selectBySize(results.filter(item => !item.candidate), 'large')).toEqual([]);
  });
  it('separates large/small files and prefixes numbers to avoid filename collisions', () => {
    expect(downloadFilename(results[0]!, 0, 'https://example.org/album')).toBe('thumb2original/example.org/large/001_full.jpeg');
    expect(downloadFilename(results[1]!, 1, 'https://example.org/album')).toBe('thumb2original/example.org/small/002_thumb.jpeg');
  });
});
describe('durable browser download queue', () => {
  it('downloads only the supplied selection, starting one file at a time', async () => {
    await startDownloads(results.filter(item => selectBySize(results, 'small').includes(item.id)), 'https://example.org/');
    expect(download).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: 'https://example.org/thumb.jpg', saveAs: false, conflictAction: 'uniquify' }));
    expect(stored.downloadBatch?.jobs).toHaveLength(1);
  });
  it('continues queued files on download completion after popup/worker state has disappeared', async () => {
    await startDownloads(results, 'https://example.org/');
    expect(download).toHaveBeenCalledTimes(1);
    states[1] = 'complete';
    await advanceDownloads(true);
    expect(download).toHaveBeenCalledTimes(2);
    expect((await readBatch())?.jobs.map(job => job.status)).toEqual(['complete', 'in_progress']);
    states[2] = 'complete';
    await advanceDownloads();
    expect(batchActive(await readBatch())).toBe(false);
  });
  it('does not restart a still-running file when popup reopens', async () => {
    await startDownloads(results, 'https://example.org/');
    await advanceDownloads(true);
    expect(download).toHaveBeenCalledTimes(1);
  });
  it('records interrupted files as failures and continues the remaining selection', async () => {
    await startDownloads(results, 'https://example.org/');
    states[1] = 'interrupted';
    await advanceDownloads();
    expect((await readBatch())?.jobs[0]).toMatchObject({ status: 'failed', error: 'SERVER_FORBIDDEN' });
    expect(download).toHaveBeenCalledTimes(2);
  });
  it('records initiation failure without reporting success', async () => {
    download.mockRejectedValueOnce(new Error('network unavailable'));
    await startDownloads(results, 'https://example.org/');
    expect((await readBatch())?.jobs[0]).toMatchObject({ status: 'failed', error: 'network unavailable' });
    expect((await readBatch())?.jobs[1]?.status).toBe('in_progress');
  });
  it('avoids automatic duplicate downloads when a worker died between request and id storage', async () => {
    stored.downloadBatch = { id: 'interrupted', jobs: [{ url: results[0]!.url, filename: 'image.jpg', status: 'starting' }] };
    await advanceDownloads(true);
    expect(download).not.toHaveBeenCalled();
    expect(stored.downloadBatch?.jobs[0]?.status).toBe('failed');
  });
  it('rejects duplicate batches while downloads are running', async () => {
    await startDownloads(results, 'https://example.org/');
    await expect(startDownloads(results, 'https://example.org/')).rejects.toThrow('已有下载');
  });
});

describe('single image native downloads', () => {
  it('hands the original URL to Chrome without a ZIP, blob or a forced remote filename', async () => {
    expect(await downloadSingleImage({ ...results[0]!, source: 'https://example.org/thumb.jpg' })).toBe(1);
    expect(download).toHaveBeenCalledExactlyOnceWith({ url: results[0]!.url, conflictAction: 'uniquify', saveAs: false });
    expect(stored.downloadBatch).toBeUndefined();
  });
  it('gives inline SVG a safe image filename', async () => {
    const url = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E';
    await downloadSingleImage({ ...results[0]!, url, label: '../inline.svg' });
    expect(download).toHaveBeenCalledWith({ url, filename: 'inline.svg', conflictAction: 'uniquify', saveAs: false });
  });
  it.each(['javascript:alert(1)', 'data:text/html;base64,AA==', 'https://user:password@example.org/a.jpg'])('rejects an unsafe image URL without starting a download: %s', async url => {
    await expect(downloadSingleImage({ ...results[0]!, url })).rejects.toThrow('图像地址无效');
    expect(download).not.toHaveBeenCalled();
  });
  it('propagates native download initiation failures', async () => {
    download.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(downloadSingleImage(results[0]!)).rejects.toThrow('network unavailable');
  });
});
