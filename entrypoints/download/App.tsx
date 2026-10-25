import { Card } from '../../components/ui/card';
import { useLocale } from '../../lib/useLocale';
import { t, translateMessage } from '../../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { Check, FileArchive, LoaderCircle, Square, RotateCw, AlertCircle } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Brand } from '../../components/Brand';
import { useDownloadSpeed } from '../../components/DownloadSpeedControl';
import { DOWNLOAD_SPEEDS } from '../../lib/downloadSpeed';
import { ArchiveProgress, ArchiveProgressLegend } from '../../components/ArchiveProgress';
import { requestArchiveRetry, requestArchiveResume } from '../../lib/requestArchiveRetry';
import { canResumeArchive, canRetryArchive, archiveActive, archiveKey, ARCHIVE_KEY, readArchive } from '../../lib/archiveState';
import { archiveFeedback } from '../../lib/archiveFeedback';
import { runArchive } from '../../lib/archive';
import type { ArchiveBatch } from '../../lib/types';
import DownloadTasks from './DownloadTasks';

const id = new URLSearchParams(location.search).get('batch') || '';
function SingleTask() {
  useLocale();
  const { speed } = useDownloadSpeed();
  const [batch, setBatch] = useState<ArchiveBatch>();
  const [currentTabId, setCurrentTabId] = useState<number>();
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    const close = () => abort.abort(new Error(t("下载任务页已关闭。")));
    function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      const value = (changes[archiveKey(id)] || changes[ARCHIVE_KEY])?.newValue as ArchiveBatch | undefined;
      if (area === 'local' && value?.id === id) setBatch(value);
    }
    function revoked() { abort.abort(new Error(t("图像访问或下载权限已撤回，请重新发起下载。"))); }
    async function start() {
      try {
        chrome.storage.onChanged.addListener(changed);
        chrome.permissions.onRemoved.addListener(revoked);
        const owner = await chrome.tabs.getCurrent();
        if (abort.signal.aborted) return;
        setCurrentTabId(owner?.id);
        const value = await readArchive(id);
        if (value?.id !== id) { setError(t("此下载任务已过期，请从插件弹窗重新发起下载。")); return; }
        setBatch(value); document.title = value.filename;
        await runArchive(id, abort.signal);
      } catch (cause) { setError(cause instanceof Error ? cause.message : t("无法读取下载任务。")); }
    }
    start().catch(console.error); window.addEventListener('beforeunload', close);
    return () => { close(); window.removeEventListener('beforeunload', close); if (typeof chrome !== 'undefined') { chrome.storage?.onChanged.removeListener(changed); chrome.permissions?.onRemoved.removeListener(revoked); } };
  }, []);
  async function retryFailed() {
    if (!batch || retrying || !canRetryArchive(batch)) return;
    setRetrying(true); setError('');
    try {
      const created = await requestArchiveRetry(batch);
      setBatch(current => current ? { ...current, retryBatchId: created.batchId } : current);
      if (created.tabId !== undefined) await chrome.tabs.update(created.tabId, { active: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("重试启动失败。")); }
    finally { setRetrying(false); }
  }
  async function viewRetry() {
    try {
      const retry = batch?.retryBatchId ? await readArchive(batch.retryBatchId) : undefined;
      if (!retry) throw new Error(t("找不到重试任务。"));
      if (retry.tabId !== undefined) {
        try { await chrome.tabs.update(retry.tabId, { active: true }); return; } catch { /* closed: show saved result */ }
      }
      await chrome.tabs.create({ url: chrome.runtime.getURL(`/download.html?batch=${retry.id}`) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("无法打开重试任务。")); }
  }
  const completed = batch?.items.filter(item => item.status === 'complete').length || 0;
  const failed = batch?.items.filter(item => item.status === 'failed') || [];
  const total = batch?.items.length || 0;
  const active = archiveActive(batch);
  const ownsTask = currentTabId !== undefined && currentTabId === batch?.tabId;
  const feedback = batch ? archiveFeedback(batch) : undefined;
  const saved = batch?.status === 'complete' || batch?.status === 'partial';
  return <main className="task-shell">
    <header className="flex items-center justify-between gap-4"><Brand subtitle={t("图集下载")} /><Button variant="outline" onClick={async () => {
      try { const result = await chrome.runtime.sendMessage({ type: 'OPEN_ARCHIVES' }); if (!result?.ok) throw new Error(result?.message || t('无法读取下载任务。')); }
      catch (cause) { setError(cause instanceof Error ? cause.message : t('无法读取下载任务。')); }
    }}>{t('所有网页的下载任务')}</Button></header>
    <Card className="task-card">
      <div className="archive-state mb-4 flex items-center gap-2 text-sm text-brand-strong" data-tone={error ? 'destructive' : feedback?.tone}>{saved && !feedback?.warning ? <Check size={19} /> : active ? <LoaderCircle size={19} className="animate-spin" /> : <AlertCircle size={19} />}<span>{error ? t("下载未完成") : feedback?.title || t("读取下载任务…")}</span></div>
      <h2 className="task-heading">{batch?.filename || t("下载任务")}</h2>
      <p className="task-description">{active ? ownsTask ? t("可以关闭插件弹窗，请保持本任务页打开。") : t("下载正在另一个任务页中进行，请前往该页查看或取消。") : saved ? t("按三位序号排列，可以直接解压查看。") : canResumeArchive(batch) ? t("缓存保留 24 小时；继续下载会核验并复用已完成图像。") : t("从插件弹窗重新选择图像后，可再次发起下载。")}</p>
      {active && <p className="mb-4 text-xs text-muted-foreground">{translateMessage(DOWNLOAD_SPEEDS[speed].label)}: {translateMessage(DOWNLOAD_SPEEDS[speed].description)}{t("。所有任务共享总并发上限，各图像来源独立计时；限流后自动等待并降档，稳定成功后逐步恢复。可在插件左侧“下载策略”切换。")}</p>}
      <div className="task-counts"><div><strong>{total}</strong><span>{t("选中图像")}</span></div><div><strong>{completed}</strong><span>{t("已获取图像")}</span></div><div><strong className={failed.length ? 'text-warning-foreground' : ''}>{failed.length}</strong><span>{t("失败图像")}</span></div></div>
      <ArchiveProgress feedback={feedback} status={batch?.status} />
      <div className="mt-2"><ArchiveProgressLegend /></div>
      <div className="mt-3 flex items-center justify-between gap-4 text-xs text-muted-foreground"><p role="status" aria-live="polite">{translateMessage(error) || feedback?.detail}</p><span className="shrink-0">{((batch?.bytes || 0) / 1024 / 1024).toFixed(1)} MB</span></div>
      {(canRetryArchive(batch) || batch?.retryOf) && <p className="mt-4 text-xs text-muted-foreground">{t("仅下载失败图像，保留原序号和文件名，另存为补充 ZIP；解压到原文件夹即可合并。")}</p>}
      <div className="mt-6 flex justify-end gap-2">{canResumeArchive(batch) && <Button disabled={retrying} onClick={async () => { setRetrying(true); try { const result = await requestArchiveResume(batch!); if (result.tabId !== undefined) await chrome.tabs.update(result.tabId, { active: true }); } catch (cause) { setError(String(cause)); } finally { setRetrying(false); } }}>{t("继续未完成下载")}</Button>}{canRetryArchive(batch) && <Button onClick={retryFailed} disabled={retrying}><RotateCw />{retrying ? t("正在启动重试…") : t("仅重试失败图像")}</Button>}{batch?.retryBatchId && <Button variant="outline" onClick={viewRetry}>{t("查看重试任务")}</Button>}{active ? ownsTask ? <Button variant="outline" onClick={() => controller.current?.abort(new Error(t("你已取消下载。")))}><Square />{t("取消下载")}</Button> : <Button variant="outline" disabled={batch?.tabId === undefined} onClick={async () => { try { if (batch?.tabId !== undefined) await chrome.tabs.update(batch.tabId, { active: true }); } catch { setError(t("正在下载的任务页已关闭，请等待状态更新后继续下载。")); } }}>{t("打开正在下载的任务")}</Button> : saved ? <Button variant="outline" onClick={async () => { try { if (!chrome.downloads) throw new Error(t("下载权限不可用")); await chrome.downloads.showDefaultFolder(); } catch { setError(t("请在 Chrome 下载列表中查看 ZIP。")); } }}><FileArchive />{t("打开下载文件夹")}</Button> : null}</div>
      {failed.length > 0 && <ul className="failed-items" aria-label={t("失败图像")}>{failed.map(item => <li key={item.id}><strong>{item.filename}</strong><p>{translateMessage(item.error)}</p><span className="mt-1 block truncate text-[10px] text-muted-foreground" title={item.url}>{item.url}</span></li>)}</ul>}
    </Card>
  </main>;
}

export default function App() {
  return new URLSearchParams(location.search).has('batch') ? <SingleTask /> : <DownloadTasks />;
}
