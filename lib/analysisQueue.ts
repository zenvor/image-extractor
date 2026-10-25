// Only serialize short storage mutations, never page capture or network requests.
// Each tab has its own queue; authoritative analysis state stays in session storage.
const queues = new Map<number, Promise<void>>();
export function orderedAnalysis<T>(tabId: number, work: () => Promise<T>): Promise<T> {
  const result = (queues.get(tabId) || Promise.resolve()).then(work);
  const settled = result.then(() => {}, () => {});
  queues.set(tabId, settled);
  void settled.then(() => { if (queues.get(tabId) === settled) queues.delete(tabId); });
  return result;
}
