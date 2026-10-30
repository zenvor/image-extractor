import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, FileArchive, FolderOpen, Gauge, ListTodo, LoaderCircle, Play, RotateCw, Square, ExternalLink, Search, Trash2 } from 'lucide-react';
import { Brand } from '../../components/Brand';
import { useDownloadSpeed } from '../../components/DownloadSpeedControl';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Skeleton } from '../../components/ui/skeleton';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../components/ui/select';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '../../components/ui/table';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '../../components/ui/empty';
import { ArchiveProgress, ArchiveProgressLegend } from '../../components/ArchiveProgress';
import { useLocale } from '../../lib/useLocale';
import { getLocale, t, translateMessage } from '../../lib/i18n';
import { runArchive } from '../../lib/archive';
import { DOWNLOAD_SPEEDS } from '../../lib/downloadSpeed';
import { archiveActive, archivesFromStorage, isArchiveKey, canResumeArchive, canRetryArchive } from '../../lib/archiveState';
import { archiveFeedback } from '../../lib/archiveFeedback';
import { requestArchiveRetry, requestArchiveResume } from '../../lib/requestArchiveRetry';
import type { ArchiveBatch, Request } from '../../lib/types';

type TaskFilter = 'all' | 'active' | 'complete' | 'partial' | 'failed' | 'cancelled';

function TaskListSkeleton() {
  return <section className="tasks-list [&_[data-slot=skeleton]]:motion-reduce:animate-none" role="status" aria-label={t('读取下载任务…')}>
    <span className="sr-only">{t('读取下载任务…')}</span>
    <div aria-hidden="true">
      <div className="tasks-toolbar">
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-2"><Skeleton className="h-3.5 w-24" /><Skeleton className="h-9 w-full" /></div>
          <div className="flex flex-col gap-2"><Skeleton className="h-3.5 w-20" /><Skeleton className="h-9 w-36" /></div>
          <Skeleton className="h-9 w-44" />
        </div>
        <div className="flex w-full flex-wrap justify-between gap-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-4 w-64 max-w-full" /></div>
      </div>
      <div className="tasks-toolbar"><div className="flex min-w-0 flex-col gap-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-80 max-w-full" /></div><Skeleton className="h-4 w-48" /></div>
      <Table className="tasks-table">
        <TableHeader><TableRow>{[0, 1, 2, 3].map(column => <TableHead key={column}><Skeleton className="h-3 w-20 max-w-full" /></TableHead>)}</TableRow></TableHeader>
        <TableBody>{[0, 1, 2].map(row => <TableRow key={row}>
          <TableCell className="task-identity"><div className="task-identity-content"><Skeleton className="size-8 shrink-0" /><div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-3/4" /></div></div></TableCell>
          <TableCell className="task-progress"><Skeleton className="mb-2 h-5 w-24" /><Skeleton className="h-2 w-full" /><Skeleton className="mt-2 h-3 w-3/4" /></TableCell>
          <TableCell className="task-result"><Skeleton className="h-4 w-32 max-w-full" /><Skeleton className="mt-2 h-3 w-12" /></TableCell>
          <TableCell className="task-actions"><Skeleton className="h-8 w-28 max-w-full" /></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>
  </section>;
}

function TaskRow({ batch, owner, hidden, removing, onRemove }: { batch: ArchiveBatch; owner?: number; hidden: boolean; removing: boolean; onRemove: (ids: string[], completedOnly?: boolean) => Promise<void> }) {
  const controller = useRef<AbortController | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = archiveActive(batch);
  const ownsTask = owner !== undefined && owner === batch.tabId;
  const feedback = archiveFeedback(batch);
  const resumable = canResumeArchive(batch);
  const failures = batch.items.filter(item => item.status === 'failed');
  const taskDetail = batch.status === 'failed' || batch.status === 'cancelled' ? feedback.detail : '';
  const source = batch.sourceUrl || (batch.pageUrl.startsWith('chrome-extension:') ? t('本地 HTML：{0}', [batch.title]) : batch.pageUrl);
  const created = new Date(batch.started);
  const createdLabel = created.toLocaleString(getLocale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

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
  return <TableRow role="row" aria-labelledby={`task-${batch.id}`} data-task-id={batch.id} hidden={hidden}>
    <TableCell role="cell" headers="tasks-source" className="task-identity">
      <div className="task-identity-content">
        <span className="task-file-icon" aria-hidden="true"><FileArchive /></span>
        <div className="min-w-0">
          <h2 id={`task-${batch.id}`} className="task-row-title" title={batch.title || batch.filename}>{batch.title || batch.filename}</h2>
          <p className="truncate text-xs text-muted-foreground" title={source}>{source}</p>
          <p className="task-filename mt-1 truncate text-xs text-muted-foreground" title={batch.filename}>{batch.filename}</p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">{t('创建时间')}: <time dateTime={created.toISOString()}>{createdLabel}</time></p>
          {batch.retryOf && <p className="text-xs text-muted-foreground">{t('补充下载任务')}</p>}
        </div>
      </div>
    </TableCell>
    <TableCell role="cell" headers="tasks-progress" className="task-progress">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Badge variant={feedback.tone} className="task-state" data-tone={feedback.tone}>
          {active ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : feedback.warning ? <AlertCircle aria-hidden="true" /> : batch.status === 'complete' ? <Check aria-hidden="true" /> : null}
          {feedback.title}
        </Badge>
        <span className="text-xs tabular-nums text-muted-foreground">{t('{0} / {1} 张已处理', [feedback.processed, feedback.total])}</span>
      </div>
      <ArchiveProgress feedback={feedback} status={batch.status} label={t('{0} 的图像处理进度', [batch.title || batch.filename])} />
      <p role="status" className="mt-2 break-words text-xs text-muted-foreground">{feedback.compactDetail}</p>
      {taskDetail && !failures.length && <p className="task-row-detail mt-1 break-words text-xs text-muted-foreground" title={taskDetail}>{taskDetail}</p>}
      {error && <p role="alert" className="break-words text-xs text-destructive">{translateMessage(error)}</p>}
    </TableCell>
    <TableCell role="cell" headers="tasks-result" className="task-result">
      <p className="text-sm tabular-nums">{t('{0} 张成功，{1} 张失败', [feedback.complete, feedback.failed])}</p>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">{(batch.bytes / 1024 / 1024).toFixed(1)} MB</p>
      {failures.length > 0 && <Dialog>
        <DialogTrigger asChild><Button variant="ghost" size="sm" className="task-failure-toggle">{t('失败详情（{0}）', [failures.length])}</Button></DialogTrigger>
        <DialogContent className="task-failure-dialog">
          <DialogHeader className="min-w-0 pe-6 text-left">
            <DialogTitle className="leading-snug">{t('失败详情（{0}）', [failures.length])}</DialogTitle>
            <DialogDescription className="break-all">{batch.title || batch.filename}</DialogDescription>
          </DialogHeader>
          <div role="region" aria-label={t('{0} 的失败图像', [batch.title || batch.filename])} tabIndex={0} className="task-failures">
            {taskDetail && <p className="mb-4 break-words text-sm text-muted-foreground">{taskDetail}</p>}
            <ul className="space-y-4">{failures.map(item => <li key={item.id}>
              <p className="break-all text-sm font-medium">{item.filename}</p>
              <p className="mt-1 break-words text-sm text-muted-foreground">{translateMessage(item.error)}</p>
              <p className="mt-2 break-all text-xs text-muted-foreground">{item.url}</p>
            </li>)}</ul>
          </div>
          <DialogFooter><DialogClose asChild><Button variant="outline">{t('关闭')}</Button></DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>}
    </TableCell>
    <TableCell role="cell" headers="tasks-actions" className="task-actions">
      <div className="flex flex-wrap items-center gap-2">
      {active && (ownsTask
        ? <Button variant="outline" size="sm" onClick={() => controller.current?.abort(new Error(t('你已取消下载。')))}><Square aria-hidden="true" />{t('取消下载')}</Button>
        : <Button variant="outline" size="sm" onClick={openOwner}><ExternalLink aria-hidden="true" />{t('打开正在下载的任务')}</Button>)}
      {resumable && <Button size="sm" disabled={busy || removing} onClick={() => void retry(true)}><Play aria-hidden="true" />{t('继续未完成下载')}</Button>}
      {canRetryArchive(batch) && <Button variant="outline" size="sm" disabled={busy || removing} onClick={() => void retry(false)}><RotateCw aria-hidden="true" />{t('仅重试失败图像')}</Button>}
      {!active && <Button variant="outline" size="sm" disabled={busy || removing} onClick={() => void onRemove([batch.id])} aria-label={t('删除任务记录：{0}', [batch.title || batch.filename])}><Trash2 aria-hidden="true" />{t('删除记录')}</Button>}
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
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<TaskFilter>('all');
  const [removing, setRemoving] = useState(false);
  const removingRef = useRef(false);
  const [notice, setNotice] = useState('');
  async function removeRecords(ids: string[], completedOnly = false) {
    if (removingRef.current) return;
    removingRef.current = true; setRemoving(true); setError(''); setNotice('');
    try {
      const result = await chrome.runtime.sendMessage({ type: 'REMOVE_ARCHIVE_RECORDS', ids, completedOnly } satisfies Request);
      if (!result?.ok) throw new Error(result?.message);
      setNotice(t('已删除 {0} 条任务记录', [result.count]));
    } catch { setError(t('无法删除任务记录，请重试。')); }
    finally { removingRef.current = false; setRemoving(false); }
  }
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
  const completed = batches.filter(batch => batch.status === 'complete');
  const search = query.trim().toLocaleLowerCase();
  const visible = batches.filter(batch => (status === 'all' || (status === 'active' ? archiveActive(batch) : batch.status === status)) &&
    (!search || [batch.title, batch.filename, batch.sourceUrl, batch.pageUrl].some(value => value?.toLocaleLowerCase().includes(search))));
  const visibleIds = new Set(visible.map(batch => batch.id));
  const filters: { value: TaskFilter; label: string }[] = [
    { value: 'all', label: t('全部任务') }, { value: 'active', label: t('进行中') },
    { value: 'complete', label: t('已完成') }, { value: 'partial', label: t('部分失败') },
    { value: 'failed', label: t('失败') }, { value: 'cancelled', label: t('已取消') },
  ];
  return <main className="tasks-shell" aria-busy={loading}>
    <header className="tasks-header"><Brand subtitle={t('所有网页的下载任务')} /></header>
    <div className="tasks-summary">
      <div className="tasks-summary-heading">
        <div>
          <h1 className="text-xl font-semibold">{t('下载任务')}</h1>
          <p className="tasks-description mt-2 text-xs text-muted-foreground">{t('所有网页的任务集中在此；下载期间请保持此页打开。')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={openFolder}><FolderOpen aria-hidden="true" />{t('打开下载文件夹')}</Button>
      </div>
    </div>
    <dl className="tasks-stats" aria-label={t('下载任务统计')}>
      <div><dt>{t('全部任务')}</dt><dd>{loading ? <Skeleton className="h-7 w-8 motion-reduce:animate-none" aria-hidden="true" /> : batches.length}</dd></div>
      <div><dt>{t('进行中')}</dt><dd data-active={active > 0}>{loading ? <Skeleton className="h-7 w-8 motion-reduce:animate-none" aria-hidden="true" /> : active}</dd></div>
      <div><dt>{t('已保存')}</dt><dd>{loading ? <Skeleton className="h-7 w-8 motion-reduce:animate-none" aria-hidden="true" /> : saved}</dd></div>
    </dl>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{translateMessage(error)}</p>}
    {notice && <p role="status" className="mb-4 text-sm text-muted-foreground">{translateMessage(notice)}</p>}
    {loading ? <TaskListSkeleton /> : batches.length ? <section className="tasks-list" aria-label={t('所有网页的下载任务')}>
      <div className="tasks-toolbar">
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-2">
            <Label htmlFor="task-search">{t('搜索任务')}</Label>
            <Input id="task-search" name="task-search" type="search" placeholder={t('标题、文件名或来源网址')} value={query} onChange={event => setQuery(event.target.value)} autoCapitalize="none" spellCheck={false} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-status">{t('任务状态')}</Label>
            <Select value={status} onValueChange={value => setStatus(value as TaskFilter)}>
              <SelectTrigger id="task-status" className="min-w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{filters.map(filter => <SelectItem key={filter.value} value={filter.value}>{filter.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button variant="outline" disabled={removing || !completed.length} onClick={() => void removeRecords(completed.map(batch => batch.id), true)} title={t('清理全部已完成任务的记录，不删除下载文件。')}><Trash2 aria-hidden="true" />{t('清理已完成记录（{0}）', [completed.length])}</Button>
        </div>
        <div className="flex w-full flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <p role="status">{t('显示 {0} / {1} 个任务', [visible.length, batches.length])}</p>
          <p>{t('仅删除记录，保留下载文件。')}</p>
        </div>
      </div>
      <div className="tasks-toolbar">
        <div className="tasks-policy">
          <p className="flex items-center gap-2 text-xs"><Gauge aria-hidden="true" className="size-3.5 text-muted-foreground" />{t('下载策略')}<Badge variant="secondary">{translateMessage(DOWNLOAD_SPEEDS[speed].label)}</Badge></p>
          <p className="text-xs text-muted-foreground">{translateMessage(DOWNLOAD_SPEEDS[speed].description)}</p>
        </div>
        <ArchiveProgressLegend />
      </div>
      <Table role="table" aria-label={t('所有网页的下载任务')} className="tasks-table" style={visible.length ? undefined : { display: 'none' }}>
        <TableHeader role="rowgroup"><TableRow role="row">
          <TableHead role="columnheader" scope="col" id="tasks-source">{t('任务与来源')}</TableHead>
          <TableHead role="columnheader" scope="col" id="tasks-progress">{t('状态与进度')}</TableHead>
          <TableHead role="columnheader" scope="col" id="tasks-result">{t('下载结果')}</TableHead>
          <TableHead role="columnheader" scope="col" id="tasks-actions">{t('操作')}</TableHead>
        </TableRow></TableHeader>
        {/* TaskRow owns the transfer controller; filtering must hide rows without unmounting them. */}
        <TableBody role="rowgroup">{batches.map(batch => <TaskRow key={batch.id} batch={batch} owner={owner} hidden={!visibleIds.has(batch.id)} removing={removing} onRemove={removeRecords} />)}</TableBody>
      </Table>
      {!visible.length && <Empty><EmptyHeader><EmptyMedia variant="icon"><Search aria-hidden="true" /></EmptyMedia><EmptyTitle>{t('没有符合条件的任务')}</EmptyTitle><EmptyDescription>{t('试试其他关键词或任务状态。')}</EmptyDescription></EmptyHeader><Button variant="outline" onClick={() => { setQuery(''); setStatus('all'); }}>{t('清除筛选')}</Button></Empty>}
    </section> : <Empty className="tasks-empty"><EmptyHeader>
      <EmptyMedia variant="icon"><ListTodo aria-hidden="true" /></EmptyMedia><EmptyTitle>{t('还没有下载任务')}</EmptyTitle>
      <EmptyDescription>{t('在任意网页的插件弹窗中下载图像，任务会自动出现在这里。')}</EmptyDescription>
    </EmptyHeader></Empty>}
  </main>;
}
