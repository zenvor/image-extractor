import { orderedAnalysis } from './analysisQueue';
import { readAnalysis } from './analysisState';
import { popupViewKey, readPopupView, type PopupViewState } from './popupViewState';

const pending = new Map<string, { view: PopupViewState; saved: Promise<void>; flush(): void }>();
const inflight = new Map<string, Promise<void>>();

/** Batch scroll bursts in the worker so closing the popup cannot discard a timer. */
export async function persistPopupView(tabId: number, value: PopupViewState): Promise<void> {
  if (!value || typeof value.job !== 'string' || !value.job) throw new Error('图像列表状态无效。');
  const view = readPopupView(value, value.job)!;
  // Different extraction jobs must never replace each other's pending snapshot.
  const key = `${tabId}:${view.job}`;
  const previous = pending.get(key);
  if (previous) { previous.view = view; return previous.saved; }
  const entry = { view, saved: Promise.resolve(), flush: () => {} };
  entry.saved = new Promise<void>((resolve, reject) => {
    // The open message response keeps this short-lived write alive. Session storage
    // remains authoritative; navigation and new jobs are checked when the timer fires.
    entry.flush = () => {
      if (pending.get(key) !== entry) return;
      clearTimeout(timer);
      pending.delete(key);
      const writing = orderedAnalysis(tabId, async () => {
        const analysis = await readAnalysis(tabId);
        if (analysis?.status !== 'done' || analysis.job !== entry.view.job) throw new Error('结果已变化，请重新提取图像。');
        await chrome.storage.session.set({ [popupViewKey(tabId)]: entry.view });
      });
      inflight.set(key, writing);
      const cleanup = () => { if (inflight.get(key) === writing) inflight.delete(key); };
      void writing.then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
    };
    const timer = setTimeout(entry.flush, 100);
  });
  pending.set(key, entry);
  return entry.saved;
}

/** A rapidly reopened popup must see the final pending position before mounting. */
export async function readSavedPopupView(tabId: number, job: string): Promise<PopupViewState | undefined> {
  const key = `${tabId}:${job}`;
  pending.get(key)?.flush();
  await inflight.get(key)?.catch(() => {});
  const values = await chrome.storage.session.get([popupViewKey(tabId)]);
  return readPopupView(values[popupViewKey(tabId)], job);
}
