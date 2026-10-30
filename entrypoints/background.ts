import { hostedImagePages, hostedOriginalUrl, hostedPageRequestUrl } from '../lib/hostedImageHosts';
import { unresolvedImageMessage } from '../lib/imageDiagnostics';
import { orderedAnalysis } from '../lib/analysisQueue';
import { scrollPage } from '../lib/scrollPage';
import { normalizeCollectOptions } from '../lib/collectOptions';
import { collectPage } from '../lib/collect';
import { resolveImages, resolveImagesWithDiagnostics } from '../lib/resolve';
import { EXTRACTION_VERSION as ORIGINAL_RESOLVER_VERSION } from '../lib/extractionVersion';
import type { AnalysisState, ImageResult, Request, SelectionMode } from '../lib/types';
import { advanceDownloads, downloadSingleImage, failDownloads, startDownloads } from '../lib/downloads';
import { withTimeout } from '../lib/timeout';
import { analysisFilter, defaultImageFilter, filterImageResults, selectBySize } from '../lib/selection';
import { resumeArchive, retryArchive, startArchive, interruptArchive, recoverArchive, pruneArchives, openArchivePage, removeArchiveRecords } from '../lib/archiveState';
import { readAnalysis, findAnalysis, saveAnalysis, clearAnalysis } from '../lib/analysisState';
import { persistPopupView, readSavedPopupView } from '../lib/popupViewPersistence';

const SELECTION_MODES = new Set<string>(['page', 'large', 'small', 'all', 'custom']);
const SELECTION_FILTERS = new Set<string>(['page', 'large', 'small', 'all']);
// One pass over the results with an id set: keeps result order, drops unknown ids, and each id appears once.
function selectedResults(results: ImageResult[], ids: string[]) {
  const wanted = new Set(ids);
  return results.filter(item => wanted.has(item.id));
}
const selectedIds = (results: ImageResult[], ids: string[]) => selectedResults(results, ids).map(item => item.id);

async function analyze(tabId: number, preferredMode?: SelectionMode, scroll = false) {
  const requestedMode = preferredMode === 'page' || preferredMode === 'large' || preferredMode === 'small' || preferredMode === 'all' ? preferredMode : undefined;
  const state = await orderedAnalysis(tabId, async () => {
    const previous = await readAnalysis(tabId);
    if (previous?.resolverVersion === ORIGINAL_RESOLVER_VERSION && previous.status === 'running' && Date.now() - previous.started < 15000) {
      throw new Error('已有分析正在进行，请稍后重试。');
    }
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !/^https?:\/\//.test(tab.url)) throw new Error('此页面无法读取，请切换到普通 HTTP / HTTPS 网页。');
    const mode = requestedMode || 'page';
    const state: AnalysisState = {
      job: crypto.randomUUID(), resolverVersion: ORIGINAL_RESOLVER_VERSION, tabId, url: tab.url, status: 'running', started: Date.now(),
      message: '正在读取当前页面…', total: 0, truncated: false, results: [], selected: [], selectionMode: mode, selectionFilter: mode,
    };
    await saveAnalysis(state);
    return state;
  });
  try {
    if (scroll) {
      const [document] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {}, injectImmediately: true });
      await orderedAnalysis(tabId, async () => {
        if ((await readAnalysis(tabId))?.job !== state.job) throw new Error('页面或分析任务已变化，请重新提取图像。');
        state.documentId = document?.documentId;
        await saveAnalysis(state);
      });
      await chrome.scripting.executeScript({ target: { tabId, ...(state.documentId ? { documentIds: [state.documentId] } : {}) }, func: scrollPage });
    }
    const options = normalizeCollectOptions((await chrome.storage.local.get('collectOptions')).collectOptions);
    const captures = await withTimeout(
      chrome.scripting.executeScript({ target: { tabId, ...(state.documentId ? { documentIds: [state.documentId] } : {}) }, func: collectPage, args: [options], injectImmediately: true }),
      5000, '页面读取超时，请重新点击工具栏图标后重试。',
    );
    const page = captures[0]?.result;
    if (!page) throw new Error('未能读取页面，请重新点击工具栏图标后重试。');
    return await orderedAnalysis(tabId, async () => {
      if ((await readAnalysis(tabId))?.job !== state.job) throw new Error('页面或分析任务已变化，请重新提取图像。');
      if ((await chrome.tabs.get(tabId)).url !== page.url || page.url !== state.url) {
        throw new Error('页面已变化，请重新分析。');
      }
      if (page.challenged) throw new Error('页面仍在验证中，请在网页完成验证后重新分析。');
      state.documentId = captures[0]?.documentId;
      state.results = resolveImages(page);
      state.hostedPages = hostedImagePages(page);
      state.title = page.title;
      const resolvedMode = requestedMode || defaultImageFilter(state.results);
      state.selected = [];
      state.selectionMode = 'custom';
      state.selectionFilter = resolvedMode;
      state.total = page.total;
      state.truncated = page.truncated || state.results.length >= 12000;
      state.status = 'done';
      state.message = state.results.length ? `找到 ${state.results.length} 个图像地址` : '未发现可导出的图像地址。可先滚动加载图像后重试。';
      await saveAnalysis(state);
      return state;
    });
  } catch (error) {
    return orderedAnalysis(tabId, async () => {
      if ((await readAnalysis(tabId))?.job !== state.job) throw new Error('页面或分析任务已变化，请重新提取图像。');
      state.status = 'error';
      state.message = error instanceof Error && !/Cannot access|Missing host permission|extensions gallery/i.test(error.message)
        ? error.message : '此页面受限或访问权限已失效，请切换普通网页，重新点击工具栏图标。';
      await saveAnalysis(state);
      return state;
    });
  }
}

export default defineBackground(() => {
  // Only event ordering is in memory; all authoritative download state is in storage.
  let previousDownloadEvent = Promise.resolve();
  async function orderedDownload(work: () => Promise<void>) {
    const previous = previousDownloadEvent;
    let release!: () => void;
    previousDownloadEvent = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { await work(); } finally { release(); }
  }
  let downloadListenerRegistered = false;
  function downloadChanged(delta: chrome.downloads.DownloadDelta) {
    if (!delta.state || delta.state.current === 'in_progress') return;
    orderedDownload(async () => {
      if (await chrome.permissions.contains({ permissions: ['downloads'] }) && chrome.downloads) await advanceDownloads();
    }).catch(console.error);
  }
  function attachDownloadListener(): boolean {
    // Chrome omits this namespace until the optional permission is granted.
    const event = chrome.downloads?.onChanged;
    if (!event) return false;
    if (!downloadListenerRegistered) {
      event.addListener(downloadChanged);
      downloadListenerRegistered = true;
    }
    return true;
  }
  async function resumeDownloads() {
    await recoverArchive();
    // Old finished records are trimmed here (inside the ordered queue, after recovery); failure is harmless.
    await pruneArchives().catch(console.error);
    if (await chrome.permissions.contains({ permissions: ['downloads'] }) && attachDownloadListener()) await advanceDownloads(true);
  }
  chrome.runtime.onMessage.addListener((message: Request, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message || !['ANALYZE', 'SAVE_POPUP_VIEW', 'LOAD_POPUP_VIEW', 'IMPORT_CAPTURE', 'HOSTED_ORIGINAL', 'SELECT', 'DOWNLOAD', 'DOWNLOAD_ZIP', 'RETRY_ARCHIVE', 'RESUME_ARCHIVE', 'REMOVE_ARCHIVE_RECORDS', 'OPEN_ARCHIVES', 'RESUME_DOWNLOADS'].includes(message.type)) return;
    (async () => {
      try {
        if (message.type === 'ANALYZE') {
          if (!Number.isInteger(message.tabId)) throw new Error('标签页无效。');
          const analysis = await analyze(message.tabId, message.mode, message.scroll === true);
          respond({ ok: true, analysis }); return;
        } else if (message.type === 'SAVE_POPUP_VIEW') {
          if (!Number.isInteger(message.tabId) || message.tabId < 0) throw new Error('图像列表状态无效。');
          await persistPopupView(message.tabId, message.view);
          respond({ ok: true }); return;
        } else if (message.type === 'LOAD_POPUP_VIEW') {
          if (!Number.isInteger(message.tabId) || message.tabId < 0 || typeof message.job !== 'string' || !message.job) throw new Error('图像列表状态无效。');
          const view = await readSavedPopupView(message.tabId, message.job);
          respond({ ok: true, view }); return;
        } else if (message.type === 'IMPORT_CAPTURE') {
          const capture = message.capture;
          if (!capture || !Array.isArray(capture.images) || capture.images.length > 2000 || JSON.stringify(capture).length > 4000000) throw new Error('导入内容超过限制。');
          const { results, unresolvedCount } = resolveImagesWithDiagnostics(capture);
          const warning = unresolvedImageMessage(unresolvedCount);
          if (!results.length && unresolvedCount) throw new Error(warning);
          const workspaceUrl = chrome.runtime.getURL('/popup.html?workspace=1');
          const tab = await chrome.tabs.create({ url: workspaceUrl, active: false });
          if (tab.id === undefined) throw new Error('无法创建导入结果页。');
          const mode = defaultImageFilter(results);
          const tabId = tab.id;
          await orderedAnalysis(tabId, () => saveAnalysis({ job: crypto.randomUUID(), resolverVersion: ORIGINAL_RESOLVER_VERSION, tabId, url: workspaceUrl, sourceUrl: /^https?:\/\//.test(capture.url) ? capture.url : undefined, status: 'done', started: Date.now(), title: capture.title, message: warning, unresolvedCount, total: capture.total, truncated: capture.truncated, hostedPages: hostedImagePages(capture), results, selected: [], selectionMode: 'custom', selectionFilter: mode }));
          respond({ ok: true, tabId: tab.id, count: selectBySize(results, mode).length, unresolvedCount, message: warning }); return;
        } else if (message.type === 'HOSTED_ORIGINAL') {
          const found = await findAnalysis(message.job);
          if (!found) throw new Error('结果已变化，请重新提取图像。');
          const analysis = await orderedAnalysis(found.tabId, async () => {
            const state = await readAnalysis(found.tabId);
            if (state?.job !== message.job || state.status !== 'done') throw new Error('结果已变化，请重新提取图像。');
            if ((await chrome.tabs.get(state.tabId)).url !== state.url) throw new Error('结果已变化，请重新提取图像。');
            const page = state.hostedPages?.find(page => page.url === message.pageUrl);
            const url = page && typeof message.url === 'string' ? hostedOriginalUrl(page.url, message.url) : '';
            if (!page || !url) throw new Error('图床原图地址无效。');
            if (!(await chrome.permissions.contains({ origins: [new URL(hostedPageRequestUrl(page.url)).origin + '/*'] }))) throw new Error('图床访问权限已失效。');
            // Do not fetch from a forum-supplied link or accept an unrelated provider's URL.
            if (!state.results.some(item => item.url === url && item.candidate)) {
              if (state.results.length >= 12000) throw new Error('图像地址已达读取上限。');
              state.results.push({ id: 'hosted-' + state.results.length, url, source: page.source, label: page.label,
                candidate: true, pageImage: false, width: 0, height: 0, reason: '大图 · 图床详情页' });
            }
            // A resolved page needs no further network access on subsequent mode switches.
            state.hostedPages = state.hostedPages?.filter(target => target.url !== page.url);
            await saveAnalysis(state);
            return state;
          });
          respond({ ok: true, analysis }); return;
        } else if (message.type === 'SELECT') {
          const { job, selected, mode, filter } = message;
          if (typeof job !== 'string' || !job || !Array.isArray(selected) || selected.some(id => typeof id !== 'string')
            || (mode !== undefined && !SELECTION_MODES.has(mode)) || (filter !== undefined && !SELECTION_FILTERS.has(filter))) {
            throw new Error('选择参数无效，请重新选择。');
          }
          const found = await findAnalysis(job);
          if (!found) throw new Error('结果已变化，请重新选择图像。');
          // Re-check inside the tab's queue: a newer analysis may have replaced this job meanwhile.
          await orderedAnalysis(found.tabId, async () => {
            const state = await readAnalysis(found.tabId);
            if (state?.job !== job) throw new Error('结果已变化，请重新选择图像。');
            if (state.status !== 'done') throw new Error('分析尚未完成，请稍后再选择。');
            state.selected = selectedIds(state.results, selected);
            state.selectionMode = mode || 'custom';
            if (filter) state.selectionFilter = filter;
            await saveAnalysis(state);
          });
        } else if (message.type === 'REMOVE_ARCHIVE_RECORDS') {
          let count = 0;
          await orderedDownload(async () => { count = await removeArchiveRecords(message.ids, message.completedOnly); });
          respond({ ok: true, count }); return;
        } else if (message.type === 'OPEN_ARCHIVES') {
          let tabId: number | undefined;
          await orderedDownload(async () => { tabId = (await openArchivePage()).id; });
          respond({ ok: true, tabId }); return;
        } else if (message.type === 'RETRY_ARCHIVE' || message.type === 'RESUME_ARCHIVE') {
          let created: { batchId: string; tabId?: number } | undefined;
          await orderedDownload(async () => { created = message.type === 'RESUME_ARCHIVE' ? await resumeArchive(message.batchId) : await retryArchive(message.batchId); });
          respond({ ok: true, ...created! });
          return;
        } else if (message.type === 'DOWNLOAD' || message.type === 'DOWNLOAD_ZIP') {
          let created: { batchId?: string; tabId?: number; downloadId?: number } | undefined;
          await orderedDownload(async () => {
            const state = await findAnalysis(message.job);
            if (state?.job !== message.job || state.status !== 'done' || !Array.isArray(message.selected)) throw new Error('结果已变化，请重新选择图像。');
            if (!(await chrome.permissions.contains({ permissions: ['downloads'] }))) throw new Error('请先允许下载权限。');
            if (!attachDownloadListener()) throw new Error('Chrome 下载接口不可用，请重载插件后重试。');
            const pageMode = analysisFilter(state) === 'page';
            const scope = filterImageResults(state.results, analysisFilter(state), '');
            const selected = selectedResults(scope, message.selected).map(item => pageMode ? { ...item, candidate: false } : item);
            if (message.type === 'DOWNLOAD_ZIP') created = await startArchive(selected, state.title || '', state.url, state.tabId, state.sourceUrl);
            else if (selected.length === 1) created = { downloadId: await downloadSingleImage(selected[0]!) };
            else await startDownloads(selected, state.url);
          });
          respond({ ok: true, ...created }); return;
        } else {
          await orderedDownload(resumeDownloads);
        }
        respond({ ok: true });
      } catch (error) { respond({ ok: false, message: error instanceof Error ? error.message : '操作失败，请重试。' }); }
    })();
    return true;
  });
  // Register synchronously on worker startup when permission already exists.
  attachDownloadListener();
  chrome.permissions.onAdded.addListener(permissions => {
    if (!permissions.permissions?.includes('downloads')) return;
    attachDownloadListener();
    orderedDownload(resumeDownloads).catch(console.error);
  });
  chrome.permissions.onRemoved.addListener(permissions => {
    if (!permissions.permissions?.includes('downloads')) return;
    chrome.downloads?.onChanged.removeListener(downloadChanged);
    downloadListenerRegistered = false;
    orderedDownload(() => failDownloads('下载权限已撤回，请在 Chrome 下载列表检查已启动的任务。')).catch(console.error);
  });
  chrome.runtime.onStartup.addListener(() => {
    orderedDownload(async () => { await recoverArchive(true); await resumeDownloads(); }).catch(console.error);
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    orderedDownload(() => interruptArchive(tabId)).catch(console.error);
    orderedAnalysis(tabId, () => clearAnalysis(tabId)).catch(console.error);
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== 'loading' && change.status !== 'complete' && !change.url) return;
    orderedAnalysis(tabId, async () => {
      const url = change.url || (await chrome.tabs.get(tabId)).url || '';
      if (url === chrome.runtime.getURL('/popup.html?workspace=1')) return;
      const state = await readAnalysis(tabId);
      if (state?.documentId && url === state.url) {
        try {
          // Lazy frames can restart tab loading without replacing the extracted document.
          const documents = await chrome.scripting.executeScript({ target: { tabId, documentIds: [state.documentId] }, func: () => {}, injectImmediately: true });
          if (documents.some(document => document.documentId === state.documentId)) return;
        } catch { /* A replaced document is no longer an injection target. */ }
      } else if (change.status === 'complete' && !change.url) return;
      await clearAnalysis(tabId);
    }).catch(console.error);
  });
});
