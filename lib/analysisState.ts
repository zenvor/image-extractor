import type { AnalysisState } from './types';

export const ANALYSIS_KEY = 'analysis'; // Read older installations without losing their current page.
export const analysisKey = (tabId: number) => `${ANALYSIS_KEY}:${tabId}`;

export async function readAnalysis(tabId: number): Promise<AnalysisState | undefined> {
  const values = await chrome.storage.session.get([analysisKey(tabId), ANALYSIS_KEY]);
  const value = (values[analysisKey(tabId)] || values[ANALYSIS_KEY]) as AnalysisState | undefined;
  return value?.tabId === tabId ? value : undefined;
}

export async function findAnalysis(job: string): Promise<AnalysisState | undefined> {
  if (typeof job !== 'string' || !job) return;
  const values = await chrome.storage.session.get(null);
  const current = Object.entries(values).find(([key, value]) =>
    key.startsWith(`${ANALYSIS_KEY}:`) && (value as AnalysisState)?.job === job,
  )?.[1] as AnalysisState | undefined;
  const legacy = values[ANALYSIS_KEY] as AnalysisState | undefined;
  if (current) return current;
  // Never let a superseded legacy snapshot overwrite a newer tab-scoped result.
  return legacy?.job === job && !values[analysisKey(legacy.tabId)] ? legacy : undefined;
}

export async function saveAnalysis(state: AnalysisState) {
  await chrome.storage.session.set({ [analysisKey(state.tabId)]: state });
}

export async function clearAnalysis(tabId: number) {
  await chrome.storage.session.remove(analysisKey(tabId));
  const legacy = (await chrome.storage.session.get(ANALYSIS_KEY))[ANALYSIS_KEY] as AnalysisState | undefined;
  if (legacy?.tabId === tabId) await chrome.storage.session.remove(ANALYSIS_KEY);
}
