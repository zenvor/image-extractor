import { Skeleton } from './ui/skeleton';
import { t, translateMessage } from '../lib/i18n';
import { useState } from 'react';
import { ImageOff, Maximize2 } from 'lucide-react';
import { Button } from './ui/button';
import { imageUrl } from '../lib/imageSource';
import type { ImageResult } from '../lib/types';

export function thumbnailUrl(item: ImageResult) {
  // A converted original must never be fetched just to render the picker.
  const source = item.source || (!item.candidate ? item.url : '');
  return imageUrl(source, source);
}

export function imageFilename(item: ImageResult) {
  if (item.url.startsWith('data:')) return item.label || t("内嵌图像");
  try { return decodeURIComponent(new URL(item.url).pathname.split('/').pop() || '') || item.label; }
  catch { return item.label; }
}

export function ImageThumbnail({ item, full = false, onPreview }: { item: ImageResult; full?: boolean; onPreview?(): void }) {
  return <Thumbnail key={thumbnailUrl(item)} item={item} full={full} onPreview={onPreview} />;
}

function Thumbnail({ item, full, onPreview }: { item: ImageResult; full: boolean; onPreview?: () => void }) {
  const source = thumbnailUrl(item);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState('');
  const [loadedSource, setLoadedSource] = useState('');
  return <div className={full ? 'thumbnail thumbnail-full' : 'thumbnail'}>
    {source && failed !== source ? <img key={attempt} src={source} alt={full ? translateMessage(item.label) : ''} loading={full ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" draggable={false} onLoad={() => setLoadedSource(source)} onError={() => setFailed(source)} /> : <span className="thumbnail-fallback"><span className="thumbnail-error-label"><ImageOff size={14} strokeWidth={1.5} aria-hidden="true" />{source ? t("加载失败") : t("无预览")}</span>{source && <Button type="button" variant="outline" size="xs" aria-label={t('重新加载 {0} 的预览', [translateMessage(item.label)])} title={t("仅重试预览，不影响图像选择和下载")} onClick={() => { setFailed(''); setLoadedSource(''); setAttempt(value => value + 1); }}>{t("重试预览")}</Button>}</span>}
    {source && failed !== source && loadedSource !== source && <Skeleton className="thumbnail-loading" aria-hidden="true" />}
    {!full && onPreview && <Button type="button" variant="outline" size="icon-xs" className="thumbnail-preview item-preview" aria-label={t('预览 {0}（{1}）', [translateMessage(item.label), item.candidate ? t('原图') : t('缩略图')])} title={t("预览图像")} onClick={onPreview}><Maximize2 aria-hidden="true" /></Button>}
  </div>;
}
