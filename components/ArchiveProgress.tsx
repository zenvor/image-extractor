import { Progress } from './ui/progress';
import { t } from '../lib/i18n';
import type { archiveFeedback } from '../lib/archiveFeedback';
import type { ArchiveBatch } from '../lib/types';

/** Image outcomes are distinct from the later ZIP packing and saving phases. */
export function ArchiveProgress({ feedback, status, label }: {
  feedback?: ReturnType<typeof archiveFeedback>;
  status?: ArchiveBatch['status'];
  label?: string;
}) {
  const total = feedback?.total ?? 0;
  const complete = feedback?.complete ?? 0;
  const failed = feedback?.failed ?? 0;
  const pending = Math.max(0, total - complete - failed);
  const indeterminate = !feedback || status === 'packing' || status === 'saving'
    || (!total && (status === 'queued' || status === 'fetching'));
  const valueText = [t('{0} 张成功，{1} 张失败，{2} 张待处理', [complete, failed, pending]), feedback?.detail].filter(Boolean).join(' · ');
  const percent = (count: number) => total ? count / total * 100 : 0;
  return <Progress className="bg-progress-pending" value={indeterminate ? null : percent(complete + failed)}
    aria-label={label || t('图像处理进度')} aria-valuetext={valueText}>
    {indeterminate ? undefined : <div aria-hidden="true" className="flex h-full w-full">
      <span data-outcome="complete" className="block h-full shrink-0 bg-brand" style={{ width: `${percent(complete)}%` }} />
      <span data-outcome="failed" className="archive-warning-indicator block h-full shrink-0 bg-warning" style={{ width: `${percent(failed)}%` }} />
      <span data-outcome="pending" className="block h-full shrink-0 bg-progress-pending" style={{ width: `${percent(pending)}%` }} />
    </div>}
  </Progress>;
}

export function ArchiveProgressLegend() {
  return <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" aria-label={t('进度颜色说明')}>
    <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-brand" />{t('成功')}</span>
    <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="archive-warning-indicator size-2 rounded-full bg-warning" />{t('失败')}</span>
    <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-progress-pending" />{t('待处理')}</span>
  </div>;
}
