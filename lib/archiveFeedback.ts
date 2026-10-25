import { t, translateMessage } from './i18n';
import type { ArchiveBatch } from './types';

/** Image processing progress is not ZIP save progress. */
export function archiveFeedback(batch: ArchiveBatch) {
  const total = batch.items.length;
  const complete = batch.items.filter(item => item.status === 'complete').length;
  const failed = batch.items.filter(item => item.status === 'failed').length;
  const processed = complete + failed;
  const counts = t("{0} 张成功，{1} 张失败", [complete, failed]);
  const titles = {
    queued: t("准备下载…"), fetching: t("正在获取图像…"), packing: t("正在打包 ZIP…"), saving: t("正在保存 ZIP…"),
    complete: t("下载完成"), partial: t("部分图像下载失败"), failed: t("下载失败"), cancelled: t("下载已取消"),
  };
  const title = titles[batch.status];
  const tone = batch.status === 'partial' ? 'warning' as const : batch.status === 'failed' ? 'destructive' as const : batch.status === 'cancelled' ? 'outline' as const : 'secondary' as const;
  const compactDetail = batch.status === 'complete' || batch.status === 'partial' ? t('ZIP 已保存。')
    : batch.status === 'failed' ? t('ZIP 未保存。')
    : batch.status === 'fetching' ? t('{0} 张待处理', [total - processed])
    : batch.status === 'packing' ? t('正在生成 ZIP，文件尚未保存。')
    : batch.status === 'saving' ? t('等待 Chrome 确认保存。') : '';
  const detail = batch.status === 'fetching'
    ? t("{0}，{1} 张待处理。失败的图像会自动重试一次。", [counts, total - processed])
    : batch.status === 'packing' ? t("{0}。正在生成 ZIP，文件尚未保存。", [counts])
    : batch.status === 'saving' ? t("正在等待 Chrome 确认文件保存完成，请保持下载任务页打开。")
    : batch.status === 'complete' ? t("ZIP 已保存，共 {0} 张图像。", [complete])
    : batch.status === 'partial' ? t("ZIP 已保存，{0}。包内附下载失败.txt，可在任务页查看原因。", [counts])
    : translateMessage(batch.message);
  return { title, detail, compactDetail, tone, complete, failed, processed, total,
    progress: batch.status === 'fetching' && total ? processed / total * 100 : undefined,
    warning: ['partial', 'failed', 'cancelled'].includes(batch.status),
    summary: batch.status === 'partial' ? t("已保存 {0} 张 · {1} 张失败", [complete, failed]) : title,
  };
}
