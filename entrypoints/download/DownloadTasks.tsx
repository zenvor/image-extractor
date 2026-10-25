import { useEffect, useRef, useState } from 'react';
import { FolderOpen, ListTodo, LoaderCircle, Play, RotateCw, Square, ExternalLink } from 'lucide-react';
import { Brand } from '../../components/Brand';
import { useDownloadSpeed } from '../../components/DownloadSpeedControl';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '../../components/ui/table';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '../../components/ui/empty';
import { ArchiveProgress, ArchiveProgressLegend } from '../../components/ArchiveProgress';
import { useLocale } from '../../lib/useLocale';
import { t, translateMessage } from '../../lib/i18n';
import { runArchive } from '../../lib/archive';
import { DOWNLOAD_SPEEDS } from '../../lib/downloadSpeed';
import { archiveActive, archivesFromStorage, isArchiveKey, canResumeArchive, canRetryArchive } from '../../lib/archiveState';
import { archiveFeedback } from '../../lib/archiveFeedback';
import { requestArchiveRetry, requestArchiveResume } from '../../lib/requestArchiveRetry';
import type { ArchiveBatch } from '../../lib/types';

function issueSummary(error?: string) {
  if (/HTTP\s*(429|503)/i.test(error || '')) return t('网站繁忙或请求受限，可稍后重试。');
  if (/timeout|timed out|超时/i.test(error || '')) return t('图像请求超时，可稍后重试。');
  return t('部分图像无法获取，原因见下载结果。');
}

function TaskRow({ batch, owner }: { batch: ArchiveBatch; owner?: number }) {
  const controller = useRef<AbortController | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = archiveActive(batch);
  const ownsTask = owner !== undefined && owner === batch.tabId;
  const feedback = archiveFeedback(batch);
  const resumable = canResumeArchive(batch);
  const failures = batch.items.filter(item => item.status === 'failed');
  const firstFailure = failures[0]?.error;
  const source = batch.sourceUrl || (batch.pageUrl.startsWith('chrome-extension:') ? t('本地 HTML：{0}', [batch.title]) : batch.pageUrl);

  useEffect(() => {
    if (owner === undefined || batch.tabId !== owner || !archiveActive(batch)) return;
    const abort = new AbortController(); controller.current = abort;
    let mounted = true;
    const close = () => abort.abort(new Error(t('下载任务页已关闭。')));
    const revoked = () => abort.abort(new Error(t('图像访问或下载权限已撤回，请重新发起下载。')));
    window.addEventListener('beforeunload', close);
    chrome.permissions.onRemoved.addListener(revoked);
    void runArchive(batch.id, abort.signal).catch(cause => {
      if (mounted) setError(cause instanceof Error ? cause.message : t('无法读取下载任务。'));
    });
    return () => {
      mounted = false; close(); window.removeEventListener('beforeunload', close); chrome.permissions.onRemoved.removeListener(revoked);
      if (controller.current === abort) controller.current = undefined;
    };
    // Progress and language updates must not restart an owned transfer.
  }, [batch.id, batch.launched, batch.tabId, owner]);

  async function retry(resume: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try { await (resume ? requestArchiveResume(batch) : requestArchiveRetry(batch)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('操作失败，请重试。')); }
    finally { setBusy(false); }
  }
  async function openOwner() {
    try {
      if (batch.tabId === undefined) throw new Error();
      await chrome.tabs.update(batch.tabId, { active: true });
    } catch { setError(t('正在下载的任务页已关闭，请等待状态更新后继续下载。')); }
  }
  return <TableRow role="row" aria-labelledby={`task-${batch.id}`} data-task-id={batch.id}>
    <TableCell role="cell" headers="tasks-source" className="task-identity">
      <h2 id={`task-${batch.id}`} className="task-row-title" title={batch.title || batch.filename}>{batch.title || batch.filename}</h2>
      <p className="break-all text-xs text-muted-foreground" title={source}>{source}</p>
      <p className="mt-1 break-all text-xs text-muted-foreground">{batch.filename}</p>
      {batch.retryOf && <p className="text-xs text-muted-foreground">{t('补充下载任务')}</p>}
    </TableCell>
    <TableCell role="cell" headers="tasks-progress" className="task-progress">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Badge variant={feedback.tone}>{active && <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}{feedback.title}</Badge>
        <span className="text-xs tabular-nums text-muted-foreground">{t('{0} / {1} 张已处理', [feedback.processed, feedback.total])}</span>
      </div>
      <ArchiveProgress feedback={feedback} status={batch.status} label={t('{0} 的图像处理进度', [batch.title || batch.filename])} />
      <p role="status" className="mt-2 break-words text-xs text-muted-foreground">{feedback.compactDetail}</p>
      {(batch.status === 'failed' || batch.status === 'cancelled') && feedback.detail && <p className={`mt-1 break-words text-xs ${batch.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{feedback.detail}</p>}
      {feedback.failed > 0 && <p className={`task-row-detail text-xs ${batch.status === 'failed' ? 'text-destructive' : 'text-warning-foreground'}`} title={translateMessage(firstFailure)}>{issueSummary(firstFailure)}</p>}
      {error && <p role="alert" className="break-words text-xs text-destructive">{translateMessage(error)}</p>}
    </TableCell>
    <TableCell role="cell" headers="tasks-result" className="task-result">
      <p className="text-xs tabular-nums">{t('{0} 张成功，{1} 张失败', [feedback.complete, feedback.failed])}</p>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">{(batch.bytes / 1024 / 1024).toFixed(1)} MB</p>
      {failures.length > 0 && <div role="region" aria-label={t('{0} 的失败图像', [batch.title || batch.filename])} tabIndex={0} className="task-failures mt-3 max-h-44 overflow-y-auto text-left text-xs">
        <ul className="space-y-3">{failures.map(item => <li key={item.id}>
          <p className="break-all">{item.filename}</p>
          <p className="break-words text-muted-foreground">{translateMessage(item.error)}</p>
          <p className="break-all text-muted-foreground">{item.url}</p>
        </li>)}</ul>
      </div>}
    </TableCell>
    <TableCell role="cell" headers="tasks-actions" className="task-actions">
      <div className="flex flex-wrap items-center gap-2">
      {active && (ownsTask
        ? <Button variant="outline" size="sm" onClick={() => controller.current?.abort(new Error(t('你已取消下载。')))}><Square aria-hidden="true" />{t('取消下载')}</Button>
        : <Button variant="outline" size="sm" onClick={openOwner}><ExternalLink aria-hidden="true" />{t('打开正在下载的任务')}</Button>)}
      {resumable && <Button size="sm" disabled={busy} onClick={() => void retry(true)}><Play aria-hidden="true" />{t('继续未完成下载')}</Button>}
      {canRetryArchive(batch) && <Button variant={resumable ? 'outline' : 'default'} size="sm" disabled={busy} onClick={() => void retry(false)}><RotateCw aria-hidden="true" />{t('仅重试失败图像')}</Button>}
      {!active && !resumable && !canRetryArchive(batch) && <span className="text-muted-foreground">—</span>}
      </div>
    </TableCell>
  </TableRow>;
}

export default function DownloadTasks() {
  useLocale();
  const { speed } = useDownloadSpeed();
  const [records, setRecords] = useState<Record<string, unknown>>({});
  const [owner, setOwner] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function openFolder() {
    try {
      // Request optional access from the click before any other await.
      if (!(await chrome.permissions.request({ permissions: ['downloads'] }))) {
        setError(t('未获得下载权限。')); return;
      }
      await chrome.downloads.showDefaultFolder();
      setError('');
    } catch { setError(t('请在 Chrome 下载列表中查看 ZIP。')); }
  }
  useEffect(() => { document.title = `${t('下载任务')} · Image Extractor`; });
  useEffect(() => {
    let mounted = true;
    function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area !== 'local') return;
      const updates = Object.fromEntries(Object.entries(changes).filter(([key]) => isArchiveKey(key)).map(([key, change]) => [key, change.newValue]));
      if (Object.keys(updates).length) setRecords(current => ({ ...current, ...updates }));
    }
    chrome.storage.onChanged.addListener(changed);
    async function load() {
      try {
        const [stored, tab] = await Promise.all([chrome.storage.local.get(null), chrome.tabs.getCurrent()]);
        if (!mounted) return;
        setRecords(current => ({ ...stored, ...current })); setOwner(tab?.id); setLoading(false);
      } catch { if (mounted) { setError(t('无法读取下载任务。')); setLoading(false); } }
    }
    void load();
    return () => { mounted = false; chrome.storage.onChanged.removeListener(changed); };
  }, []);
  const batches = archivesFromStorage(records).sort((a, b) => Number(archiveActive(b)) - Number(archiveActive(a)) || b.started - a.started || a.id.localeCompare(b.id));
  const active = batches.filter(archiveActive).length;
  const saved = batches.filter(batch => batch.status === 'complete' || batch.status === 'partial').length;
  return <main className="tasks-shell">
    <header className="tasks-header"><Brand subtitle={t('所有网页的下载任务')} /></header>
    <div className="tasks-summary">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('下载任务')}</h1>
        <Button variant="outline" size="sm" onClick={openFolder}><FolderOpen aria-hidden="true" />{t('打开下载文件夹')}</Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('{0} 个任务 · {1} 个进行中 · {2} 个已保存', [batches.length, active, saved])}</p>
      <p className="text-xs text-muted-foreground">{t('所有网页的任务集中在此；下载期间请保持此页打开。')}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t('下载策略')} · {translateMessage(DOWNLOAD_SPEEDS[speed].label)} · {translateMessage(DOWNLOAD_SPEEDS[speed].description)}</p>
        <ArchiveProgressLegend />
      </div>
    </div>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    {loading ? <p role="status">{t('读取下载任务…')}</p> : batches.length ? <section className="tasks-list" aria-label={t('所有网页的下载任务')}>
      <Table role="table" aria-label={t('所有网页的下载任务')} className="tasks-table">
        <TableHeader role="rowgroup"><TableRow role="row">
          <TableHead role="columnheader" scope="col" id="tasks-source">{t('任务与来源')}</TableHead>
          <TableHead role="columnheader" scope="col" id="tasks-progress">{t('状态与进度')}</TableHead>
          <TableHead role="columnheader" scope="col" id="tasks-result">{t('下载结果')}</TableHead>
          <TableHead role="columnheader" scope="col" id="tasks-actions">{t('操作')}</TableHead>
        </TableRow></TableHeader>
        <TableBody role="rowgroup">{batches.map(batch => <TaskRow key={batch.id} batch={batch} owner={owner} />)}</TableBody>
      </Table>
    </section> : <Empty>
      <EmptyMedia variant="icon"><ListTodo /></EmptyMedia><EmptyTitle>{t('还没有下载任务')}</EmptyTitle>
      <EmptyDescription>{t('在任意网页的插件弹窗中下载图像，任务会自动出现在这里。')}</EmptyDescription>
    </Empty>}
  </main>;
}
