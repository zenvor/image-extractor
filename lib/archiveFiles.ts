import { archiveActive, readArchives } from './archiveState';

const TASK_DIRECTORY = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/;

export async function archiveParent() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('thumb2original-archives', { create: true });
}

/**
 * Removes task directories that no active task or unexpired resumable cache owns. Directory names
 * are snapshotted before task records are read, so a task launched meanwhile (record first, page
 * second) cannot be mistaken for an orphan. Only extension pages call this: the service worker's
 * OPFS access is not relied on.
 */
export async function purgeStaleArchiveDirectories(parent: FileSystemDirectoryHandle, keepId?: string) {
  const iterable = parent as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> };
  const names: string[] = [];
  for await (const name of iterable.keys()) names.push(name);
  const activeIds = new Set((await readArchives()).filter(batch => archiveActive(batch) || (batch.cacheUntil || 0) > Date.now()).map(batch => batch.id));
  for (const name of names) {
    if (name === keepId || activeIds.has(name) || !TASK_DIRECTORY.test(name)) continue;
    // Another extension page may be purging at the same moment; a directory already gone is fine.
    try { await parent.removeEntry(name, { recursive: true }); } catch { /* removed concurrently, or retried next time */ }
  }
}

/** Best-effort cleanup for pages that are not running a task themselves (e.g. the popup). */
export async function purgeStaleArchiveFiles() {
  if (!navigator.storage?.getDirectory) return;
  await purgeStaleArchiveDirectories(await archiveParent());
}
