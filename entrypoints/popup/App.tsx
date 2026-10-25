import { noteDownloadResponse, withDownloadSlot } from '../../lib/downloadSpeed';
import { hostedPageRequestUrl } from '../../lib/hostedImageHosts';
import { resolveHostedPages } from '../../lib/resolveHostedPages';
import { InputGroup, InputGroupInput, InputGroupAddon, InputGroupButton } from '../../components/ui/input-group';
import { Badge } from '../../components/ui/badge';
import { Alert } from '../../components/ui/alert';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '../../components/ui/empty';
import { Label } from '../../components/ui/label';
import { useLocale } from '../../lib/useLocale';
import { t, translateMessage } from '../../lib/i18n';
import { previewArchive, previewNotice, previewState } from './preview';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Check, CheckCheck, CircleAlert, CircleMinus, Globe2, Images, LoaderCircle, ScanSearch, X, Copy, FileText, ChevronsDown, Layers, ListTodo, Play, RotateCw } from 'lucide-react';
import { LanguageControl } from '../../components/LanguageControl';
import { Checkbox } from '../../components/ui/checkbox';
import { ExtractionOptions } from '../../components/ExtractionOptions';
import { DownloadSpeedControl } from '../../components/DownloadSpeedControl';
import { Brand } from '../../components/Brand';
import { Button } from '../../components/ui/button';
import { ArchiveProgress } from '../../components/ArchiveProgress';
import { Switch } from '../../components/ui/switch';
import { ANALYSIS_KEY, analysisKey } from '../../lib/analysisState';
import { ImageList } from '../../components/ImageList';
import { ImagePreview } from '../../components/ImagePreview';
import { archiveFeedback } from '../../lib/archiveFeedback';
import { requestArchiveRetry, requestArchiveResume } from '../../lib/requestArchiveRetry';
import { purgeStaleArchiveFiles } from '../../lib/archiveFiles';
import { canResumeArchive, canRetryArchive, archiveActive, archiveForPage, archivesFromStorage, isArchiveKey, requiredOrigins, ARCHIVE_KEY } from '../../lib/archiveState';
import { analysisFilter, filterImageResults, userSelectedIds, updateVisibleSelection } from '../../lib/selection';
import { imageFormat, imageFormats, type ImageFormat } from '../../lib/urlImageFormat';
import { withTimeout } from '../../lib/timeout';
import { archiveFilename, pageFolderName } from '../../lib/outputNaming.js';
import { EXTRACTION_VERSION as ORIGINAL_RESOLVER_VERSION } from '../../lib/extractionVersion';
import type { AnalysisState, ImageFilter, ImageResult, ImageView, Request, SelectionMode } from '../../lib/types';

const workspace = new URLSearchParams(location.search).has('workspace');
const preview = new URLSearchParams(location.search).has('preview');

export default function App() {
  useLocale();
  const [state, setState] = useState<AnalysisState>();
  const [page, setPage] = useState({ id: undefined as number | undefined, url: '', title: '' });
  const pageRef = useRef(page);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<ImageFilter>('page');
  const [excludedFormats, setExcludedFormats] = useState<Set<ImageFormat>>(() => new Set());
  const [view, setView] = useState<ImageView>('grid');
  const [darkPreview, setDarkPreview] = useState(false);
  const [query, setQuery] = useState('');
  const [previewItem, setPreviewItem] = useState<ImageResult>();
  const [feedback, setFeedback] = useState(preview ? previewNotice : '');
  const [unavailable, setUnavailable] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [extracted, setExtracted] = useState(false);
  const extracting = useRef(false);
  const hostedController = useRef<AbortController | undefined>(undefined);
  const hostedJob = useRef('');
  const [archiveRecords, setArchiveRecords] = useState<Record<string, unknown>>(() => previewArchive ? { [ARCHIVE_KEY]: previewArchive } : {});
  const archive = archiveForPage(archivesFromStorage(archiveRecords), page.id, page.url);
  const [now, setNow] = useState(Date.now());
  const pending = useRef<Extract<Request, { type: 'SELECT' }>[]>([]);
  const saving = useRef(false);
  const results = useMemo(() => state?.status === 'done' ? state.results : [], [state]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const scoped = useMemo(() => filterImageResults(results, filter, ''), [results, filter]);
  const chosen = useMemo(() => scoped.filter(item => selectedSet.has(item.id)), [scoped, selectedSet]);
  const formatCounts = useMemo(() => {
    const counts = new Map<ImageFormat, number>();
    for (const item of scoped) {
      const format = imageFormat(item.url);
      counts.set(format, (counts.get(format) || 0) + 1);
    }
    return imageFormats.filter(format => counts.has(format)).map(format => ({ format, count: counts.get(format)! }));
  }, [scoped]);
  const visible = useMemo(() => filterImageResults(scoped, 'all', query, excludedFormats), [scoped, query, excludedFormats]);
  const scopeTotal = scoped.length;
  const running = initializing || busy || (state?.status === 'running' && now - state.started < 15000);
  const activeArchive = archiveActive(archive);
  const title = state?.title || page.title;
  let host = t("当前页面");
  try { host = new URL(page.url).hostname; } catch { /* no active tab */ }
  const zipName = archiveFilename(title, host);
  const downloadFeedback = archive ? archiveFeedback(archive) : undefined;
  const status = unavailable ? t("此页面无法读取") : running ? t("正在读取页面…") : state?.status === 'error' ? t("读取失败") : state?.status === 'running' ? t("读取已中断") : state?.status === 'done' ? t('{0} 张图像', [scopeTotal]) + (state.truncated ? t("· 已达读取上限") : '') : t("准备读取页面");

  function restore(value?: AnalysisState) {
    const match = value && value.resolverVersion === ORIGINAL_RESOLVER_VERSION && value.tabId === pageRef.current.id && value.url === pageRef.current.url ? value : undefined;
    // Late events from an older worker/page must not erase a newer result/error.
    if (value && !match) return;
    if (hostedController.current && match?.job !== hostedJob.current) {
      hostedController.current.abort(); hostedController.current = undefined;
      setBusy(false);
    }
    setState(match);
    if (!saving.current || !match || match.status !== 'done') {
      setSelected(userSelectedIds(match));
      setFilter(analysisFilter(match));
    }
  }

  async function performAnalysis(tabId: number, scroll = false) {
    hostedController.current?.abort();
    extracting.current = true; setExtracted(false);
    setBusy(true); setFeedback(''); setPreviewItem(undefined);
    try {
      const response = await withTimeout(chrome.runtime.sendMessage({ type: 'ANALYZE', tabId, ...(filter === 'large' ? { mode: 'large' } : {}), ...(scroll ? { scroll } : {}) }), 8000, t("页面读取超时，请重新打开插件后重试。"));
      if (!response?.ok) throw new Error(response?.message || t("读取失败，请重试。"));
      // A completed message is authoritative even if a storage event was missed.
      // Older workers only return ok; read their persisted result for compatibility.
      const stored = response.analysis ? undefined : await chrome.storage.session.get([analysisKey(tabId), ANALYSIS_KEY]);
      const completed = (response.analysis || stored?.[analysisKey(tabId)] || stored?.[ANALYSIS_KEY]) as AnalysisState | undefined;
      if (completed?.resolverVersion && completed.resolverVersion !== ORIGINAL_RESOLVER_VERSION) {
        throw new Error(t("插件后台与界面版本不一致，请等待下载任务结束，在扩展管理页重新加载插件，再打开本页提取。"));
      }
      if (!completed || completed.resolverVersion !== ORIGINAL_RESOLVER_VERSION || completed.tabId !== tabId || completed.url !== pageRef.current.url || !['done', 'error'].includes(completed.status)) {
        throw new Error(t("页面读取未返回完整结果，页面可能已刷新，请重新点击“提取图像”。"));
      }
      restore(completed);
    } catch (error) {
      extracting.current = false;
      const message = error instanceof Error ? error.message : t("读取中断，请重试。");
      setFeedback(message);
      setState({ job: 'analysis-error', resolverVersion: ORIGINAL_RESOLVER_VERSION, tabId, url: pageRef.current.url, title: pageRef.current.title, status: 'error', started: Date.now(), total: 0, truncated: false, results: [], selected: [], message });
      setSelected([]);
    }
    finally { setBusy(false); }
  }

  useEffect(() => {
    let mounted = true;
    function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (!mounted) return;
      const key = pageRef.current.id === undefined ? '' : analysisKey(pageRef.current.id);
      if (area === 'session' && changes[key]) restore(changes[key]!.newValue as AnalysisState | undefined);
      if (area === 'local') {
        const updates = Object.fromEntries(Object.entries(changes).filter(([key]) => isArchiveKey(key)).map(([key, change]) => [key, change.newValue]));
        if (Object.keys(updates).length) setArchiveRecords(current => ({ ...current, ...updates }));
      }
    }
    async function initialize() {
      if (preview) {
        const context = { id: 1, url: previewState.url, title: previewState.title || '' };
        pageRef.current = context; setPage(context); restore(previewState); setInitializing(false); return;
      }
      try {
        const tab = workspace ? await chrome.tabs.getCurrent() : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        if (!mounted) return;
        const context = { id: tab?.id, url: workspace ? location.href : tab?.url || '', title: tab?.title || '' };
        pageRef.current = context; setPage(context);
        const restricted = !tab?.id || !/^https?:\/\//.test(context.url);
        setUnavailable(restricted && !workspace);
        chrome.storage.onChanged.addListener(changed);
        const [session, local] = await Promise.all([chrome.storage.session.get([analysisKey(context.id ?? -1), ANALYSIS_KEY]), chrome.storage.local.get(null)]);
        if (!mounted) return;
        if (workspace && !session[analysisKey(context.id ?? -1)]) {
          for (let attempt = 0; attempt < 20; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 50));
            Object.assign(session, await chrome.storage.session.get(analysisKey(context.id ?? -1)));
            if (session[analysisKey(context.id ?? -1)]) break;
          }
        }
        const cached = (session[analysisKey(context.id ?? -1)] || session[ANALYSIS_KEY]) as AnalysisState | undefined;
        const matches = !!cached && cached.resolverVersion === ORIGINAL_RESOLVER_VERSION && cached.tabId === context.id && cached.url === context.url;
        restore(cached); setArchiveRecords(current => ({ ...local, ...current }));
        if (local.imageView === 'grid' || local.imageView === 'list') setView(local.imageView);
        setInitializing(false);
        // Recovery and stale-file cleanup are independent of extraction: neither waits for it, and
        // neither may delay or fail it. Failures are ignored; the next popup open retries.
        Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'RESUME_DOWNLOADS' })).catch(() => {});
        purgeStaleArchiveFiles().catch(() => {});
        // Opening the toolbar popup already grants activeTab. Reuse saved results.
        if (!restricted && !matches && context.id !== undefined) await performAnalysis(context.id);
      } catch {
        if (mounted) { setUnavailable(true); setFeedback(t("请在普通网页上，从 Chrome 工具栏打开插件。")); }
      } finally { if (mounted) setInitializing(false); }
    }
    initialize().catch(console.error);
    return () => {
      mounted = false;
      hostedController.current?.abort();
      if (!preview && typeof chrome !== 'undefined') chrome.storage?.onChanged.removeListener(changed);
    };
  }, []);

  useEffect(() => {
    if (!extracting.current || (state?.status !== 'done' && state?.status !== 'error')) return;
    extracting.current = false; setExtracted(state.status === 'done');
  }, [state?.status, state?.job]);
  useEffect(() => {
    if (!extracted) return;
    const timer = setTimeout(() => setExtracted(false), 1200);
    return () => clearTimeout(timer);
  }, [extracted]);

  useEffect(() => {
    if (state?.status !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state?.status]);
  useEffect(() => {
    if (!translateMessage(feedback, 'zh-CN').startsWith('已') && !translateMessage(feedback, 'zh-CN').startsWith('预览模式')) return;
    const timer = setTimeout(() => setFeedback(current => current === feedback ? '' : current), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

  async function persistSelection(ids: string[], nextMode: SelectionMode, scope: ImageFilter) {
    if (preview || !state) return;
    pending.current.push({ type: 'SELECT', job: state.job, selected: ids, mode: nextMode, filter: scope });
    if (saving.current) return;
    saving.current = true;
    try {
      while (pending.current.length) {
        const response = await chrome.runtime.sendMessage(pending.current.shift());
        if (!response?.ok) throw new Error(response?.message || t("选择未能保存，请重试。"));
      }
    } catch (error) {
      // The worker says why it refused (changed results, unfinished analysis); other failures stay generic.
      pending.current = [];
      setFeedback(error instanceof Error && error.message && error.message !== t("选择未能保存，请重试。") ? error.message : t("选择未能保存，请重新选择。"));
    }
    finally { saving.current = false; }
  }
  function select(ids: string[], nextMode: SelectionMode, scope = filter) {
    setSelected(ids); persistSelection(ids, nextMode, scope).catch(console.error);
  }
  function chooseOriginalMode(enabled: boolean) {
    const scope: ImageFilter = enabled ? 'large' : 'page';
    const matchedSources = new Set(state?.results.filter(item => item.candidate).map(item => item.source));
    const targets = enabled && !preview ? (state?.hostedPages || []).filter(page => !matchedSources.has(page.source)) : [];
    // Keep permission acquisition in the original click stack, ahead of persistence or network work.
    let permission: Promise<boolean> | undefined;
    try { permission = targets.length ? chrome.permissions.request({ origins: requiredOrigins(targets.map(page => hostedPageRequestUrl(page.url))) }) : undefined; }
    catch (error) { setFeedback(error instanceof Error ? error.message : t('图床解析失败，请重试。')); return; }
    setFilter(scope); setExcludedFormats(new Set());
    select(selected, 'custom', scope);
    if (!permission || !state) return;
    const job = state.job;
    const controller = new AbortController();
    hostedController.current?.abort(); hostedController.current = controller; hostedJob.current = job;
    setBusy(true); setFeedback(t('正在解析图床原图…'));
    void (async () => {
      try {
        if (!(await permission)) throw new Error(t('未获得图床访问权限，已保留现有匹配结果。'));
        controller.signal.throwIfAborted();
        const outcome = await resolveHostedPages(targets, controller.signal, async (page, url) => {
          controller.signal.throwIfAborted();
          const response = await chrome.runtime.sendMessage({ type: 'HOSTED_ORIGINAL', job, pageUrl: page.url, url } satisfies Request);
          if (!response?.ok) throw new Error(response?.message || t('图床结果保存失败。'));
          if (!controller.signal.aborted) restore(response.analysis);
        }, async (input, init) => {
          const response = await fetch(input, init);
          try { await noteDownloadResponse(String(input), response); }
          catch (error) { await response.body?.cancel(); throw error; }
          return response;
        }, (url, signal, lookup) => withDownloadSlot(url, signal, lookup, undefined, job));
        if (!controller.signal.aborted) setFeedback(t('图床解析完成：成功 {0}，失败 {1}。', [outcome.resolved, outcome.failed]));
      } catch (error) {
        if (!controller.signal.aborted) setFeedback(error instanceof Error ? error.message : t('图床解析失败，请重试。'));
      } finally {
        if (hostedController.current === controller) {
          hostedController.current = undefined;
          if (!controller.signal.aborted) setBusy(false);
        }
      }
    })();
  }
  function toggleFormat(format: ImageFormat) {
    setExcludedFormats(current => {
      const next = new Set(current);
      if (next.has(format)) next.delete(format); else next.add(format);
      return next;
    });
  }
  function toggle(id: string) { select(selectedSet.has(id) ? selected.filter(value => value !== id) : [...selected, id], 'custom'); }
  function selectVisible() { select(updateVisibleSelection(selected, visible, 'select'), 'custom'); }
  function clearSelection() { select([], 'custom'); }
  async function changeView(next: ImageView) {
    setView(next);
    if (!preview) { try { await chrome.storage.local.set({ imageView: next }); } catch { /* cosmetic preference */ } }
  }
  async function analyze(scroll = false) {
    setQuery(''); setExcludedFormats(new Set());
    if (preview) {
      setExtracted(true);
      setState({ ...previewState, job: 'preview-' + Date.now(), started: Date.now() });
      select([], 'custom', filter);
      setFeedback(t("已重新读取本地样例")); return;
    }
    if (page.id !== undefined) await performAnalysis(page.id, scroll);
  }
  async function download(items: ImageResult[] = chosen) {
    if (!state || !items.length || starting || activeArchive) return;
    if (preview) { setFeedback(t('预览模式：{0} 张图像将保存为「{1}」。', [items.length, zipName])); return; }
    setStarting(true); setFeedback('');
    try {
      // Keep the permission request as the first async operation of the click.
      const granted = await chrome.permissions.request({ permissions: ['downloads'], origins: requiredOrigins(items.map(item => item.url)) });
      if (!granted) { setFeedback(t("未获得下载权限，可点击「导出选定链接为 TXT」保存图像链接。")); return; }
      const response = await chrome.runtime.sendMessage({ type: 'DOWNLOAD_ZIP', job: state.job, selected: items.map(item => item.id) });
      if (!response?.ok) setFeedback(response?.message || t("下载任务启动失败。"));
    } catch (error) { setFeedback(error instanceof Error ? error.message : t("下载任务启动失败。")); }
    finally { setStarting(false); }
  }
  async function retryFailed() {
    if (!archive || starting || !canRetryArchive(archive)) return;
    if (preview) { setFeedback(t("预览模式：仅重试失败图像，保留原文件名，另存为补充 ZIP。")); return; }
    setStarting(true); setFeedback('');
    try { await requestArchiveRetry(archive); }
    catch (error) { setFeedback(error instanceof Error ? error.message : t("重试启动失败。")); }
    finally { setStarting(false); }
  }
  async function resumeIncomplete() {
    if (preview || !archive || starting) return;
    setStarting(true);
    try { await requestArchiveResume(archive); }
    catch (error) { setFeedback(error instanceof Error ? error.message : t("操作失败，请重试。")); }
    finally { setStarting(false); }
  }
  async function openTools() {
    if (preview) { setFeedback(t("预览模式：辅助工具将在独立页面打开。")); return; }
    try { await chrome.tabs.create({ url: chrome.runtime.getURL('/tools.html') }); }
    catch { setFeedback(t("操作失败，请重试。")); }
  }
  async function copy(item?: ImageResult) {
    const items = item ? [item] : chosen;
    try { await navigator.clipboard.writeText(items.map(item => item.url).join('\n')); setFeedback(t('已复制 {0} 个图像链接', [items.length])); }
    catch { setFeedback(t("无法使用剪贴板，请导出 TXT 链接。")); }
  }
  function exportLinks() {
    if (preview) { setFeedback(t("已导出 TXT 链接文件")); return; }
    const url = URL.createObjectURL(new Blob([chosen.map(item => item.url).join('\n') + '\n'], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = pageFolderName(title, host) + '.txt';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000); setFeedback(t("已导出 TXT 链接文件"));
  }
  async function viewTask() {
    if (preview) { setFeedback(t("预览模式：下载任务总览将在独立页面打开。")); return; }
    try {
      const result = await chrome.runtime.sendMessage({ type: 'OPEN_ARCHIVES' });
      if (!result?.ok) throw new Error(result?.message || t("无法读取下载任务。"));
    } catch (error) { setFeedback(error instanceof Error ? error.message : t("无法读取下载任务。")); }
  }
  const noMatches = !!scoped.length && (!!query || excludedFormats.size > 0);
  return <main className="popup-shell" data-preview={preview} data-dark-preview={darkPreview}>
    <header className="app-header">
      <nav className="extraction-nav" aria-label={t("图像提取器")}><Brand compact />{preview && <Badge variant="secondary" className="preview-label">{t("界面预览")}</Badge>}
      <section className="page-context">
      <div className="page-identity"><h2 title={title}>{title || t("采集当前页图像")}</h2><p><Globe2 aria-hidden="true" /><span title={page.url}>{host}</span><span className="context-divider" /><span role="status" className={state?.status === 'error' ? 'error' : ''}>{running ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : state?.status === 'done' ? <Check aria-hidden="true" /> : null}{status}</span></p></div>
      </section>
      <LanguageControl compact />
      <Button size="sm" className="refresh-button" onClick={() => analyze()} disabled={workspace || unavailable || running} aria-label={t("重新提取当前页图像")} aria-busy={running}>{running ? t("提取中…") : extracted ? t("提取完成") : t("提取图像")}</Button>
      </nav>
    </header>
    <div className="popup-workspace">
      <aside className="workspace-sidebar" aria-label={t("图像操作")}>
        <div className="sidebar-controls">
          <section className="sidebar-group original-mode-control">
            <Label htmlFor="original-mode">{t("匹配原图模式")}</Label>
            <Switch id="original-mode" className="original-mode-switch" checked={filter === 'large'} onCheckedChange={chooseOriginalMode} disabled={running} />
          </section>
          <section className="sidebar-group sidebar-format-group" aria-labelledby="image-format-heading">
            <div className="sidebar-group-heading"><h3 id="image-format-heading">{t("图像格式")}</h3>{excludedFormats.size > 0 && <Button variant="ghost" size="xs" className="reset-formats" onClick={() => setExcludedFormats(new Set())} aria-label={t("显示所有图像格式")}>{t("重置")}</Button>}</div>
            <div className="format-filters" role="group" aria-labelledby="image-format-heading">
              {formatCounts.length ? formatCounts.map(({ format, count }) => <Button key={format} variant="ghost" size="xs" className="format-filter" data-format={format} aria-pressed={!excludedFormats.has(format)} onClick={() => toggleFormat(format)} title={t("筛选显示，不改变勾选")} disabled={running} aria-label={t('{0} 格式，{1} 张', [format, count])}><span>{format}</span><span className="format-count">({count})</span></Button>) : <span className="format-placeholder">{t("暂无图像格式")}</span>}
            </div>
          </section>
          <section className="sidebar-group" aria-labelledby="image-search-heading">
            <Label id="image-search-heading" className="sr-only" htmlFor="image-search">{t("搜索图像")}</Label>
            <InputGroup className="image-search"><InputGroupInput id="image-search" name="image-search" type="search" aria-label={t("搜索图像名称或链接")} placeholder={t("图像名称或链接")} value={query} onChange={event => setQuery(event.target.value)} disabled={running || !results.length} />{query && <InputGroupAddon align="inline-end"><InputGroupButton variant="ghost" size="icon-xs" aria-label={t("清除搜索")} onClick={() => setQuery('')}><X /></InputGroupButton></InputGroupAddon>}</InputGroup>
          </section>
          <DownloadSpeedControl preview={preview} onError={setFeedback} />
          <ExtractionOptions preview={preview} />
        </div>
        <footer className="download-footer" aria-labelledby="download-heading">
          <div className="sidebar-group download-selection">
            <div className="download-section-heading">
              <h3 id="download-heading">{t("下载")}</h3>
              <div className="archive-status-slot">{downloadFeedback && <div className="archive-progress" data-tone={downloadFeedback.tone}>
                <span role="status" title={downloadFeedback.detail}>{downloadFeedback.summary}{archive?.status === 'fetching' ? ` ${downloadFeedback.processed}/${downloadFeedback.total}` : ''}</span>
                <Button variant="ghost" size="xs" onClick={viewTask} disabled={archive?.tabId === undefined} aria-label={t("查看下载详情")} title={downloadFeedback.detail}>{t("详情")}</Button>
                {downloadFeedback.progress !== undefined && <ArchiveProgress feedback={downloadFeedback} status={archive?.status} label={t("图像获取进度")} />}
              </div>}</div>
            </div>
            <div className="bulk-actions" role="group" aria-label={t("批量选择图像")}>
              <Button variant="outline" size="sm" className="select-all-button" onClick={selectVisible} disabled={!visible.length} title={t("选中当前显示的所有图像")}><CheckCheck aria-hidden="true" />{t("全选")}</Button>
              <Button variant="outline" size="sm" className="deselect-all-button" onClick={clearSelection} disabled={!selected.length} title={t("取消所有图像的勾选，包括筛选隐藏的图像")}><CircleMinus aria-hidden="true" />{t("取消全选")}</Button>
            </div>
          </div>
          <Button size="sm" className="zip-button" onClick={() => download()} disabled={starting || running || activeArchive || !chosen.length} aria-label={activeArchive ? t("下载任务进行中") : starting ? t("准备下载") : t('下载所选内容（{0}）', [chosen.length])}>{starting || activeArchive ? <LoaderCircle className="animate-spin" /> : <ArrowDownToLine />}{activeArchive ? downloadFeedback?.title : starting ? t("准备下载…") : t('下载所选内容（{0}）', [chosen.length])}</Button>
          <div className="sidebar-utility-actions">
            <Button size="sm" variant="outline" className="copy-links-button" onClick={() => copy()} disabled={running || !chosen.length} aria-label={t("复制选定的网址")} title={t("复制选定的网址")}><Copy aria-hidden="true" />{t("复制网址")}</Button>
            <Button size="sm" variant="outline" className="export-links-button" onClick={exportLinks} disabled={running || !chosen.length} aria-label={t("导出选定链接为 TXT")} title={t("导出选定链接为 TXT")}><FileText aria-hidden="true" />{t("导出 TXT")}</Button>
            <Button size="sm" variant="outline" className="scroll-extract-button" onClick={() => analyze(true)} disabled={workspace || running || unavailable} aria-label={t("滚动加载后提取")} title={t("滚动加载后提取")}><ChevronsDown aria-hidden="true" />{t("滚动提取")}</Button>
            <Button size="sm" variant="outline" className="batch-tools-button" onClick={openTools} aria-label={t("批量网址 / 导入 HTML")} title={t("批量网址 / 导入 HTML")}><Layers aria-hidden="true" />{t("批量/HTML")}</Button>
            <Button size="sm" variant="outline" className="view-task-button" onClick={viewTask} aria-label={t("查看下载任务")} title={t("查看下载任务")}><ListTodo aria-hidden="true" />{t("下载任务")}</Button>
            <div className="archive-recovery-actions">
              {canResumeArchive(archive) && <Button variant="outline" size={canRetryArchive(archive) ? 'xs' : 'sm'} disabled={starting} onClick={resumeIncomplete} aria-label={t("继续未完成下载")} title={t("继续未完成下载")}><Play aria-hidden="true" />{canRetryArchive(archive) ? t("继续") : t("继续下载")}</Button>}
              {canRetryArchive(archive) && <Button variant="outline" size={canResumeArchive(archive) ? 'xs' : 'sm'} className="retry-failed-button" disabled={starting || activeArchive} onClick={retryFailed} aria-label={t("仅重试失败图像")} title={t("只下载失败图像，保留原文件名，另存为补充 ZIP")}><RotateCw aria-hidden="true" />{canResumeArchive(archive) ? t("重试") : t("重试失败项")}</Button>}
            </div>
          </div>
        </footer>
      </aside>
      <div className="image-workspace">
        <section className="gallery" aria-busy={running}>
          {!!state?.unresolvedCount && <p role="status" className="mx-3 mt-2 text-xs text-destructive">{translateMessage(state.message)}</p>}
          <ImageList showKind={false} header={<div className="workspace-controls">
          <div className="results-toolbar"><span className="visible-count">{t(filter === 'large' ? '{0} 张原图' : '{0} 张图像', [visible.length === scopeTotal ? visible.length : visible.length + ' / ' + scopeTotal])}</span><Label className="preview-background-control"><Checkbox checked={darkPreview} onCheckedChange={value => setDarkPreview(value === true)} />{t("深色图像背景")}</Label><div className="view-options" role="group" aria-label={t("图像显示方式")}><Button variant={view === 'grid' ? 'secondary' : 'ghost'} size="xs" aria-label={t("网格视图")} aria-pressed={view === 'grid'} onClick={() => changeView('grid')}>{t("网格")}</Button><Button variant={view === 'list' ? 'secondary' : 'ghost'} size="xs" aria-label={t("列表视图")} aria-pressed={view === 'list'} onClick={() => changeView('list')}>{t("列表")}</Button></div></div>
        </div>} key={(state?.job || '') + filter + query + view} items={visible} selected={selectedSet} onToggle={toggle} onPreview={setPreviewItem} onCopy={item => copy(item)} onDownload={item => download([item])} downloadDisabled={starting || running || activeArchive} view={view} empty={<Empty className="empty">
            <EmptyMedia variant="icon" className="empty-symbol">{running ? <LoaderCircle className="animate-spin" /> : state?.status === 'error' || unavailable ? <CircleAlert /> : <Images />}</EmptyMedia>
            <EmptyTitle>{running ? t("正在寻找页面中的图像") : unavailable ? t("换一个网页试试") : state?.status === 'error' ? t("暂时无法读取图像") : noMatches ? t("没有符合条件的图像") : filter === 'large' ? t("未匹配到原图") : t("这页还没有可读取的图像")}</EmptyTitle>
            <EmptyDescription>{running ? t("链接转换完成后，图像会立即显示。") : unavailable ? t("请在普通网页上打开插件。") : state?.status === 'error' ? translateMessage(state.message) : noMatches ? t("格式与搜索不会改变勾选结果。") : filter === 'large' ? t("当前页面未命中已适配的原图规则。关闭匹配原图模式可查看页面图像。") : t("先在网页中滚动加载图像，再重新分析。")}</EmptyDescription>
            {!running && !unavailable && (noMatches ? <Button variant="outline" size="sm" onClick={() => { setQuery(''); setExcludedFormats(new Set()); }}>{t("清除筛选")}</Button> : filter === 'large' ? <Button variant="outline" size="sm" onClick={() => chooseOriginalMode(false)}>{t("查看页面图像")}</Button> : <Button size="sm" onClick={() => analyze()}><ScanSearch />{t("提取图像")}</Button>)}
          </Empty>} />
        </section>
      </div>
    </div>
    {feedback && <Alert className="feedback" role="status"><span>{translateMessage(feedback)}</span><Button variant="ghost" size="icon-xs" aria-label={t("关闭提示")} onClick={() => setFeedback('')}><X /></Button></Alert>}
    <ImagePreview darkPreview={darkPreview} item={previewItem} onClose={() => setPreviewItem(undefined)} />
  </main>;
}
