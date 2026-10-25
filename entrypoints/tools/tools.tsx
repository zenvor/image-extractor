import { Card } from '../../components/ui/card';
import { Alert } from '../../components/ui/alert';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '../../components/ui/empty';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useLocale } from '../../lib/useLocale';
import { t, translateMessage } from '../../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Download, ExternalLink, FileCode2, Files, Link, LoaderCircle, Square, Upload, X } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Checkbox } from '../../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { unresolvedImageMessage } from '../../lib/imageDiagnostics';
import { Progress } from '../../components/ui/progress';
import './tools.css';
import { Brand } from '../../components/Brand';
import { Button } from '../../components/ui/button';
import { normalizeCollectOptions } from '../../lib/collectOptions';
import { collectPage } from '../../lib/collect';
import { analysisKey, readAnalysis } from '../../lib/analysisState';
import { analysisFilter, chosenAnalysisImages, filterImageResults } from '../../lib/selection';
import { archiveActive, archivesFromStorage, readArchives, requiredOrigins } from '../../lib/archiveState';
import { withTimeout } from '../../lib/timeout';
import { parsePageUrls, sortHtmlFiles, type HtmlFileOrder } from '../../lib/batchInputs';
import type { AnalysisState, ArchiveBatch } from '../../lib/types';

type Row = { file?: File; warning?: string; phase?: 'queued' | 'running' | 'done' | 'failed' | 'stopped'; id: string; url: string; title: string; tabId?: number; resultCount?: number; count?: number; error?: string; launchError?: string; batchId?: string; archive?: ArchiveBatch; analysisStatus?: AnalysisState['status'] };
type Plan = { rowId: string; job: string; selected: string[] };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : t("操作失败，请重试。");

const preview = typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && new URLSearchParams(location.search).has('preview');
const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
function validateUrls(value: string) {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return t("请先填写网页地址，每行一个。");
  const invalid = lines.findIndex(line => { try { const url = new URL(line); return !/^https?:$/.test(url.protocol) || !!url.username || !!url.password; } catch { return true; } });
  if (invalid >= 0) return t("第 {0} 个地址无效，请填写完整的 HTTP / HTTPS 网址。", [invalid + 1]);
  try { parsePageUrls(value); return ''; } catch { return t("每次最多提取 20 个不同的网页地址。"); }
}

export function Tools() {
  const { locale } = useLocale();
  useEffect(() => { document.title = `Image Extractor · ${t("批量提取图像")}`; }, [locale]);
  const [mode, setMode] = useState('urls');
  const [files, setFiles] = useState<File[]>([]);
  const [fileOrder, setFileOrder] = useState<HtmlFileOrder>('selection');
  const sortedFiles = sortHtmlFiles(files, fileOrder);
  const [inputError, setInputError] = useState('');
  const [baseError, setBaseError] = useState('');
  const [fileError, setFileError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const urlInput = useRef<HTMLTextAreaElement>(null);
  const baseInput = useRef<HTMLInputElement>(null);
  const [urls, setUrls] = useState('');
  const [base, setBase] = useState('');
  const [scroll, setScroll] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [downloadPlan, setDownloadPlan] = useState<Plan[]>([]);
  const [downloadOrigins, setDownloadOrigins] = useState<string[]>([]);
  const operation = useRef<AbortController | null>(null);
  const patch = (id: string, values: Partial<Row>) => setRows(current => current.map(row => row.id === id ? { ...row, ...values } : row));
  function begin() {
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setMessage(''); return controller.signal;
  }
  function finish() {
    operation.current = null; setBusy(false);
    setRows(current => current.map(row => row.phase === 'queued' ? { ...row, phase: 'stopped' } : row));
  }
  function stop() {
    operation.current?.abort(new Error(t("已停止后续操作；当前已提交的操作和下载任务会保留。")));
    setDownloadPlan([]);
    setMessage(t("正在停止后续操作，等待当前操作返回；已启动的下载可在任务页取消。"));
  }
  useEffect(() => {
    if (preview) return;
    function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area === 'session') {
        setDownloadPlan([]);
        setRows(current => current.map(row => {
          if (row.tabId === undefined || !(analysisKey(row.tabId) in changes)) return row;
          const state = changes[analysisKey(row.tabId)]?.newValue as AnalysisState | undefined;
          return { ...row, title: state?.title || row.title, count: state?.status === 'done' ? chosenAnalysisImages(state).length : 0, resultCount: state?.status === 'done' ? filterImageResults(state.results, analysisFilter(state), '').length : 0,
            phase: state?.status === 'done' ? 'done' : state?.status === 'running' ? 'running' : 'failed', analysisStatus: state?.status, warning: unresolvedImageMessage(state?.unresolvedCount || 0), error: !state ? t("页面结果已失效，请重新提取。") : state.status === 'error' ? state.message : undefined };
        }));
      } else if (area === 'local') {
        const batches = archivesFromStorage(Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.newValue])));
        if (batches.length) setRows(current => current.map(row => {
          const archive = batches.find(batch => batch.id === row.batchId);
          return archive ? { ...row, archive } : row;
        }));
      }
    }
    chrome.storage.onChanged.addListener(changed);
    return () => { chrome.storage.onChanged.removeListener(changed); operation.current?.abort(); };
  }, []);

  async function batch() {
    const validation = validateUrls(urls);
    setInputError(validation);
    if (validation) { urlInput.current?.focus(); return; }
    const targets = parsePageUrls(urls);
    if (preview) { setMessage(t("这是界面预览；正式扩展会逐页打开网址并提取图像。")); return; }
    const queue: Row[] = targets.map(url => ({ id: crypto.randomUUID(), url, title: url, phase: 'queued' }));
    const signal = begin(); setDownloadPlan([]); setRows(queue);
    try {
      // Request in the original click stack, before any other await.
      if (!(await chrome.permissions.request({ origins: requiredOrigins(targets) }))) throw new Error(t("未获得网页访问权限。"));
      signal.throwIfAborted();
      for (const row of queue) {
        signal.throwIfAborted();
        const { url } = row;
        patch(row.id, { phase: 'running' });
        try {
          const tab = await chrome.tabs.create({ url, active: false }); patch(row.id, { tabId: tab.id });
          signal.throwIfAborted();
          if (tab.id === undefined) throw new Error(t("无法打开网页"));
          const until = Date.now() + 20000;
          let loaded = false;
          while (Date.now() < until) {
            signal.throwIfAborted();
            if ((await chrome.tabs.get(tab.id)).status === 'complete') { loaded = true; break; }
            await new Promise(resolve => setTimeout(resolve, 250));
          }
          signal.throwIfAborted();
          if (!loaded) throw new Error(t("网页加载超时，请打开网页后手动提取"));
          const response = await withTimeout(chrome.runtime.sendMessage({ type: 'ANALYZE', tabId: tab.id, scroll }), 15000, t("提取超时"));
          if (!response?.ok) throw new Error(response?.message || t("提取失败"));
          const state = await readAnalysis(tab.id);
          if (state?.status !== 'done') throw new Error(state?.message || t("未获得结果"));
          patch(row.id, { title: state.title || url, count: chosenAnalysisImages(state).length, resultCount: filterImageResults(state.results, analysisFilter(state), '').length, phase: 'done', analysisStatus: state.status, error: undefined });
        } catch (error) { patch(row.id, { phase: signal.aborted ? 'stopped' : 'failed', error: signal.aborted ? t("已停止") : errorMessage(error) }); }
        signal.throwIfAborted();
      }
      setMessage(t("提取完成。请打开各页，通过插件勾选图像或全选，再返回这里下载。"));
    } catch (error) { setMessage(errorMessage(error)); }
    finally { finish(); }
  }
  function addFiles(incoming: File[]) {
    const invalid = incoming.find(file => !/\.html?$/i.test(file.name) || file.size > 16 * 1024 * 1024);
    if (invalid) { setFileError(t("{0}：请选择不超过 16 MB 的 HTML / HTM 文件。", [invalid.name])); return; }
    const combined = [...new Map([...files, ...incoming].map(file => [fileKey(file), file])).values()];
    if (combined.length > 20) { setFileError(t("每次最多导入 20 个 HTML 文件，请减少文件数量。")); return; }
    setFiles(combined); setFileError('');
  }
  async function importFiles(retry?: Row) {
    const importingFiles = retry?.file ? [retry.file] : sortedFiles;
    if (!importingFiles.length) { setFileError(t("请先选择 HTML 文件。")); fileInput.current?.focus(); return; }
    const sourceUrl = base.trim();
    const validation = sourceUrl ? validateUrls(sourceUrl) || (sourceUrl.split(/\r?\n/).filter(Boolean).length !== 1 ? t("请填写一个原网页地址。") : '') : '';
    setBaseError(validation);
    if (validation) { baseInput.current?.focus(); return; }
    if (preview) { setMessage(t("这是界面预览；正式扩展会解析文件并创建图像结果页。")); return; }
    const queue: Row[] = importingFiles.map(file => ({ id: retry?.id || crypto.randomUUID(), file, title: file.name, url: sourceUrl, phase: 'queued' }));
    const signal = begin(); setDownloadPlan([]);
    setRows(current => retry ? current.map(row => row.id === retry.id ? queue[0]! : row) : queue);
    try {
      if (importingFiles.length > 20) throw new Error(t("每次最多导入 20 个 HTML 文件。"));
      const options = normalizeCollectOptions((await chrome.storage.local.get('collectOptions')).collectOptions);
      signal.throwIfAborted();
      for (const [index, file] of importingFiles.entries()) {
        signal.throwIfAborted();
        const row = queue[index]!;
        patch(row.id, { phase: 'running' });
        try {
          if (file.size > 16 * 1024 * 1024) throw new Error(t("单个 HTML 文件超过 16 MB。"));
          const html = await file.text(); signal.throwIfAborted();
          const capture = collectPage(options, { html, url: sourceUrl, title: file.name });
          signal.throwIfAborted();
          const result = await chrome.runtime.sendMessage({ type: 'IMPORT_CAPTURE', capture });
          if (!result?.ok) throw new Error(result?.message || t("导入失败"));
          const state = await readAnalysis(result.tabId);
          patch(row.id, { tabId: result.tabId, title: capture.title, count: state ? chosenAnalysisImages(state).length : 0, resultCount: state ? filterImageResults(state.results, analysisFilter(state), '').length : result.count, warning: unresolvedImageMessage(state?.unresolvedCount ?? result.unresolvedCount ?? 0), phase: 'done', analysisStatus: 'done' });
        } catch (error) { patch(row.id, { phase: signal.aborted ? 'stopped' : 'failed', error: signal.aborted ? t("已停止") : errorMessage(error) }); }
        signal.throwIfAborted();
      }
      setMessage(t("本轮导入结束。请检查各文件的结果；相对链接无法解析时，补充原网页地址后可单独重试该文件。"));
    } catch (error) { setMessage(errorMessage(error)); }
    finally { finish(); }
  }
  async function downloadAll() {
    const signal = begin();
    try {
      const plans: Plan[] = [], addresses: string[] = [];
      for (const row of rows.filter(row => !row.batchId && row.tabId !== undefined)) {
        signal.throwIfAborted();
        const state = await readAnalysis(row.tabId!); signal.throwIfAborted();
        if (state?.status !== 'done') continue;
        patch(row.id, { count: chosenAnalysisImages(state).length, resultCount: filterImageResults(state.results, analysisFilter(state), '').length, title: state.title || row.title, error: undefined, launchError: undefined, analysisStatus: state.status });
        const chosen = chosenAnalysisImages(state);
        if (!chosen.length) continue;
        plans.push({ rowId: row.id, job: state.job, selected: chosen.map(item => item.id) });
        addresses.push(...chosen.map(item => item.url));
      }
      setDownloadPlan(plans); setDownloadOrigins(requiredOrigins(addresses));
      setMessage(plans.length ? t("已核对选定图像，请点击“允许并开始下载”。每个网页分别保存 ZIP。") : t("没有可下载的选定图像，请打开结果页选择图像后重试。"));
    } catch (error) { setMessage(errorMessage(error)); }
    finally { finish(); }
  }
  async function confirmDownload() {
    const signal = begin();
    const plans = downloadPlan; setDownloadPlan([]);
    try {
      if (!(await chrome.permissions.request({ permissions: ['downloads'], origins: downloadOrigins }))) throw new Error(t("未获得下载权限。"));
      signal.throwIfAborted();
      for (const plan of plans) {
        signal.throwIfAborted();
        try {
          const response = await chrome.runtime.sendMessage({ type: 'DOWNLOAD_ZIP', job: plan.job, selected: plan.selected });
          if (!response?.ok || !response.batchId) throw new Error(response?.message || t("未能创建下载任务。"));
          patch(plan.rowId, { batchId: response.batchId, launchError: undefined });
          // Catch completion that preceded the message response / row update.
          const archive = (await readArchives()).find(batch => batch.id === response.batchId);
          patch(plan.rowId, { archive });
        } catch (error) { patch(plan.rowId, { launchError: errorMessage(error) }); }
        signal.throwIfAborted();
      }
      setMessage(t("下载任务已提交。下方会持续显示处理进度和最终保存结果。"));
    } catch (error) { setMessage(errorMessage(error)); }
    finally { finish(); }
  }
  const launched = rows.filter(row => row.batchId);
  const completed = launched.filter(row => row.archive?.status === 'complete').length;
  const partial = launched.filter(row => row.archive?.status === 'partial').length;
  const failed = launched.filter(row => row.archive && ['failed', 'cancelled'].includes(row.archive.status)).length;
  const pending = launched.length - completed - partial - failed;
  const processed = rows.filter(row => row.phase && !['queued', 'running'].includes(row.phase)).length;
  const extracted = rows.filter(row => row.phase === 'done').length;
  const errors = rows.filter(row => row.phase === 'failed').length;
  const stopped = rows.filter(row => row.phase === 'stopped').length;
  const lineCount = urls.split(/\r?\n/).filter(line => line.trim()).length;
  let uniqueCount = 0;
  try { uniqueCount = parsePageUrls(urls).length; } catch { /* Feedback appears on blur or submit. */ }
  const eligible = rows.some(row => !row.error && !row.batchId && row.count && row.analysisStatus === 'done');
  const openTab = (id: number) => { if (!preview) void chrome.tabs.update(id, { active: true }).catch(error => setMessage(errorMessage(error))); };

  return <div className="tools-page">
    <header className="tools-header"><div><Brand /></div></header>
    <main className="tools-main">
      <div className="tools-intro"><h2>{t("批量提取图像")}</h2><p>{t("从多个网页或已保存的 HTML 中提取图像，检查结果后再下载。")}</p></div>
      <div className="tools-workspace">
        <Card className="tools-input-panel" aria-label={t("提取来源")}>
          <Tabs value={mode} onValueChange={setMode}>
            <TabsList className="w-full"><TabsTrigger value="urls" disabled={busy}><Link aria-hidden="true" />{t("批量网址")}</TabsTrigger><TabsTrigger value="html" disabled={busy}><FileCode2 aria-hidden="true" />{t("本地 HTML")}</TabsTrigger></TabsList>
            <TabsContent value="urls">
              <form className="tools-form" noValidate onSubmit={event => { event.preventDefault(); void batch(); }}>
                <div className="tools-field">
                  <div className="tools-label-row"><Label htmlFor="batch-urls">{t("网页地址")}</Label><span>{t("每行一个 · 最多 20 页")}</span></div>
                  <Textarea ref={urlInput} id="batch-urls" name="urls" rows={7} value={urls} placeholder={'https://example.org/gallery/1\nhttps://example.org/gallery/2'} spellCheck={false} autoCapitalize="none" aria-invalid={!!inputError} aria-describedby="urls-feedback" disabled={busy} onChange={event => { setUrls(event.target.value); setInputError(''); }} onBlur={() => { if (urls.trim()) setInputError(validateUrls(urls)); }} />
                  <div className="tools-input-feedback"><p id="urls-feedback" className={inputError ? 'error' : ''} aria-live="polite">{translateMessage(inputError) || (uniqueCount ? t("{0} 个网页{1}", [uniqueCount, lineCount > uniqueCount ? t(" · 已忽略 {0} 个重复地址", [lineCount - uniqueCount]) : '']) : t("支持 HTTP / HTTPS 网址，重复地址会自动合并。"))}</p><Button type="button" variant="ghost" size="sm" disabled={busy || !urls} onClick={() => { setUrls(''); setInputError(''); urlInput.current?.focus(); }}>{t("清空")}</Button></div>
                </div>
                <div className="tools-option"><Checkbox id="batch-scroll" checked={scroll} onCheckedChange={value => setScroll(value === true)} disabled={busy} /><div><Label htmlFor="batch-scroll">{t("加载页面中的懒加载图像")}</Label><p>{t("提取前滚动最多 10 步，完成后恢复位置。")}</p></div></div>
                <Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Link aria-hidden="true" />}{t("批量提取")}</Button>
                <p className="tools-hint">{t("网页将依次在后台打开，提取后保留，方便你检查。")}</p>
              </form>
            </TabsContent>
            <TabsContent value="html">
              <form className="tools-form" noValidate onSubmit={event => { event.preventDefault(); void importFiles(); }}>
                <div className="tools-field">
                  <div className="tools-label-row"><Label htmlFor="html-files">{t("HTML 文件")}</Label><span>{files.length} {t("/ 20 个")}</span></div>
                  <div className="tools-file-picker" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) addFiles([...event.dataTransfer.files]); }}>
                    <Upload aria-hidden="true" /><strong>{t("将文件拖到这里")}</strong><p>{t("支持 HTML / HTM，单个文件不超过 16 MB")}</p>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>{t("选择 HTML 文件")}</Button>
                    <Input ref={fileInput} id="html-files" name="files" className="sr-only" type="file" accept=".html,.htm,text/html" multiple disabled={busy} aria-invalid={!!fileError} aria-describedby="files-feedback" onChange={event => { addFiles([...(event.target.files || [])]); event.target.value = ''; }} />
                  </div>
                  <p id="files-feedback" className="error" aria-live="polite">{translateMessage(fileError)}</p>
                  {!!files.length && <div className="tools-field"><Label htmlFor="html-order">{t("文件处理顺序")}</Label><Select value={fileOrder} onValueChange={value => setFileOrder(value as HtmlFileOrder)} disabled={busy}><SelectTrigger id="html-order"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="selection">{t("选择顺序")}</SelectItem><SelectItem value="name">{t("文件名（自然排序）")}</SelectItem><SelectItem value="mtime-asc">{t("修改时间（从旧到新）")}</SelectItem><SelectItem value="mtime-desc">{t("修改时间（从新到旧）")}</SelectItem></SelectContent></Select></div>}
                  {!!files.length && <ul className="tools-file-list" aria-label={t("待导入文件")}>{sortedFiles.map(file => <li key={fileKey(file)}><FileCode2 aria-hidden="true" /><span title={file.name}>{file.name}<small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small></span><Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label={t("移除 {0}", [file.name])} onClick={() => { setFiles(current => current.filter(item => fileKey(item) !== fileKey(file))); setFileError(''); }}><X aria-hidden="true" /></Button></li>)}</ul>}
                </div>
                <div className="tools-field"><Label htmlFor="html-base">{t("原网页地址")} <span className="tools-optional">{t("选填")}</span></Label><Input ref={baseInput} id="html-base" name="base" type="url" value={base} placeholder="https://example.org/gallery/" spellCheck={false} autoCapitalize="none" disabled={busy} aria-invalid={!!baseError} aria-describedby="base-feedback" onChange={event => { setBase(event.target.value); setBaseError(''); }} /><p id="base-feedback" className={baseError ? 'error' : 'tools-hint'}>{translateMessage(baseError) || t("用于补全相对图像链接，应用于本次全部文件；文件自带有效 base 地址时可留空。")}</p></div>
                <Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}{t("开始导入")}</Button><p className="tools-hint">{t("只读取文件内容，不执行 HTML 中的脚本。")}</p>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
        <Card className="tools-results" aria-labelledby="results-heading">
          <div className="tools-results-heading"><div><h3 id="results-heading">{t("提取结果")}</h3><p>{rows.length ? t("{0} 页成功 · {1} 页失败{2}", [extracted, errors, stopped ? t(" · {0} 页未完成", [stopped]) : '']) : t("提取完成后，在这里检查并下载图像")}</p></div>{busy && <Button variant="outline" size="sm" onClick={stop}><Square aria-hidden="true" />{t("停止后续操作")}</Button>}</div>
          {!!rows.length && <div className="tools-progress"><div><span>{busy ? t("正在处理") : t("本轮处理结束")}</span><span>{processed} / {rows.length} {t("页")}</span></div><Progress value={processed / rows.length * 100} aria-label={t("网页处理进度")} /></div>}
          {message && <Alert role="status" className="tools-notice">{translateMessage(message)}</Alert>}
          {!rows.length ? <Empty className="tools-empty"><EmptyMedia variant="icon"><Files aria-hidden="true" /></EmptyMedia><EmptyTitle>{t("等待添加内容")}</EmptyTitle><EmptyDescription>{t("粘贴网址或选择 HTML 文件，")}<br />{t("然后开始提取。")}</EmptyDescription><ol><li>{t("添加来源")}</li><li>{t("检查图像")}</li><li>{t("下载所选")}</li></ol></Empty> : <>
            <ul className="tools-result-list">{rows.map((row, index) => <li key={row.id}>
              <div className="tools-row-heading"><span className="tools-row-index">{index + 1}</span><p title={row.title}>{row.title}</p><Badge variant="secondary" className="tools-row-state" data-state={row.phase}>{row.phase === 'running' ? <><LoaderCircle className="animate-spin" />{t("处理中")}</> : row.phase === 'failed' ? <><CircleAlert />{t("失败")}</> : row.phase === 'done' ? <><Check />{t("已提取")}</> : row.phase === 'stopped' ? t("未完成") : t("等待中")}</Badge></div>
              {row.warning && <Alert className="tools-notice" role="status">{translateMessage(row.warning)}</Alert>}
              {row.url && <p className="tools-row-url" title={row.url}>{row.url}</p>}
              <div className="tools-row-details"><p className={row.error || row.launchError ? 'error' : ''}>{row.archive ? t("{0}（{1} 成功 / {2} 失败）", [translateMessage(row.archive.message), row.archive.items.filter(item => item.status === 'complete').length, row.archive.items.filter(item => item.status === 'failed').length]) : translateMessage(row.launchError || row.error) || (row.batchId ? t("下载已启动") : row.phase === 'stopped' ? t("本轮未完成，可重新提取。") : row.phase === 'queued' ? t("等待前面的网页处理完成") : row.analysisStatus === 'running' || row.count === undefined ? t("正在读取图像…") : t('发现 {0} 张图像，已选 {1} 张', [row.resultCount ?? 0, row.count]))}</p><div>{row.file && (row.error || row.warning) && !row.batchId && <Button variant="outline" size="sm" disabled={busy} onClick={() => { setMode('html'); if (!base.trim()) { setBaseError(t("请填写原网页地址，再点击此文件的重试按钮。")); requestAnimationFrame(() => baseInput.current?.focus()); } else void importFiles(row); }}>{t("补充地址后重试")}</Button>}{row.archive?.tabId !== undefined && <Button variant="outline" size="sm" onClick={() => openTab(row.archive!.tabId!)}>{archiveActive(row.archive) ? t("下载进度") : t("下载结果")}</Button>}{row.tabId !== undefined && <Button variant="ghost" size="sm" onClick={() => openTab(row.tabId!)}>{t("打开")}<ExternalLink aria-hidden="true" /></Button>}</div></div>
            </li>)}</ul>
            <div className="tools-results-actions"><p>{downloadPlan.length ? t("已核对 {0} 页，请确认下载权限。", [downloadPlan.length]) : t("使用各页当前选定的图像，每个网页分别保存 ZIP。")}</p><Button disabled={busy || !eligible} onClick={downloadPlan.length ? confirmDownload : downloadAll}><Download aria-hidden="true" />{downloadPlan.length ? t("允许并开始下载") : t("下载各页选定图像")}</Button></div>
          </>}
          {!!launched.length && <Alert role="status" aria-live="polite" className="tools-notice">{t('下载汇总：{0} 页全部保存，{1} 页部分成功，{2} 页失败或取消，{3} 页进行中', [completed, partial, failed, pending])}</Alert>}
        </Card>
      </div>
    </main>
  </div>;
}
