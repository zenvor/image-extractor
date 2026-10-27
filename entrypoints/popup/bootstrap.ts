import { ANALYSIS_KEY, analysisKey } from '../../lib/analysisState';
import { EXTRACTION_VERSION } from '../../lib/extractionVersion';
import { popupViewKey, readPopupView, type PopupViewState } from '../../lib/popupViewState';
import { ARCHIVE_KEY } from '../../lib/archiveState';
import type { AnalysisState, Request } from '../../lib/types';
import { previewArchive, previewNotice, previewState } from './preview';

export const workspace = new URLSearchParams(location.search).has('workspace');
export const preview = new URLSearchParams(location.search).has('preview');

export type PopupSnapshot = {
  page: { id: number | undefined; url: string; title: string };
  analysis?: AnalysisState;
  view?: PopupViewState;
  local: Record<string, unknown>;
  unavailable: boolean;
  shouldAnalyze: boolean;
  feedback: string;
};

export function matchingAnalysis(value: AnalysisState | undefined, page: PopupSnapshot['page']) {
  return value?.resolverVersion === EXTRACTION_VERSION && value.tabId === page.id && value.url === page.url ? value : undefined;
}

/** Restore before mounting the workspace, so its first frame contains real data. */
export async function loadPopupSnapshot(): Promise<PopupSnapshot> {
  if (preview) return {
    page: { id: 1, url: previewState.url, title: previewState.title || '' },
    analysis: previewState, local: previewArchive ? { [ARCHIVE_KEY]: previewArchive } : {},
    unavailable: false, shouldAnalyze: false, feedback: previewNotice,
  };
  try {
    const contextPromise = (async () => {
      const tab = workspace ? await chrome.tabs.getCurrent() : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      const page = { id: tab?.id, url: workspace ? location.href : tab?.url || '', title: tab?.title || '' };
      const key = analysisKey(page.id ?? -1);
      const session = await chrome.storage.session.get([key, ANALYSIS_KEY, popupViewKey(page.id ?? -1)]);
      return { page, key, session };
    })();
    const [{ page, key, session }, local] = await Promise.all([contextPromise, chrome.storage.local.get(null)]);
    if (workspace && !session[key]) {
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        Object.assign(session, await chrome.storage.session.get(key));
        if (session[key]) break;
      }
    }
    const cached = (session[key] || session[ANALYSIS_KEY]) as AnalysisState | undefined;
    const analysis = matchingAnalysis(cached, page);
    const restricted = page.id === undefined || !/^https?:\/\//.test(page.url);
    let view = analysis ? readPopupView(session[popupViewKey(analysis.tabId)], analysis.job) : undefined;
    if (analysis?.status === 'done') {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'LOAD_POPUP_VIEW', tabId: analysis.tabId, job: analysis.job } satisfies Request);
        if (response?.ok) view = readPopupView(response.view, analysis.job);
      } catch { /* Older workers can still restore the stored snapshot. */ }
    }
    return {
      page, analysis, local,
      view,
      unavailable: restricted && !workspace,
      shouldAnalyze: !restricted && !analysis,
      feedback: '',
    };
  } catch {
    return { page: { id: undefined, url: '', title: '' }, local: {}, unavailable: true, shouldAnalyze: false, feedback: '请在普通网页上，从 Chrome 工具栏打开插件。' };
  }
}
