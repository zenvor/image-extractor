import { canRetryArchive, requiredOrigins } from './archiveState';
import type { ArchiveBatch } from './types';

export async function requestArchiveRetry(batch: ArchiveBatch): Promise<{ batchId: string; tabId?: number }> {
  if (!canRetryArchive(batch)) throw new Error('此任务没有可单独重试的失败图像。');
  // This is the first awaited operation after the user's click.
  const granted = await chrome.permissions.request({ permissions: ['downloads'], origins: requiredOrigins(batch.items.filter(item => item.status === 'failed').map(item => item.url)) });
  if (!granted) throw new Error('未获得权限，未启动重试。');
  const result = await chrome.runtime.sendMessage({ type: 'RETRY_ARCHIVE', batchId: batch.id });
  if (!result?.ok) throw new Error(result?.message || '无法启动重试，请再试一次。');
  return result;
}

export async function requestArchiveResume(batch: ArchiveBatch) {
  const granted = await chrome.permissions.request({ permissions: ['downloads'], origins: requiredOrigins(batch.items.map(item => item.url)) });
  if (!granted) throw new Error('未获得继续下载所需权限。');
  const response = await chrome.runtime.sendMessage({ type: 'RESUME_ARCHIVE', batchId: batch.id });
  if (!response?.ok) throw new Error(response?.message || '继续下载失败。');
  return response as { batchId: string; tabId?: number };
}
