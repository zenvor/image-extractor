import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { t, translateMessage } from '../lib/i18n';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Download, Link } from 'lucide-react';
import { Checkbox } from './ui/checkbox';
import { Button } from './ui/button';
import { FormatBadge } from './FormatBadge';
import { ImageThumbnail, imageFilename } from './ImageThumbnail';
import { imageFormat } from '../lib/urlImageFormat';
import type { ImageResult, ImageView } from '../lib/types';

// Filename, badges and their spacing below the square thumbnail.
const GRID_CAPTION_HEIGHT = 58;
const LIST_ROW = 98;
const GAP = 10;

export function ImageList({ items, selected, onToggle, onPreview, onCopy, onDownload, downloadDisabled, view, showKind = true, header, empty }: {
  items: ImageResult[]; selected: Set<string>; onToggle(id: string): void; onPreview(item: ImageResult): void;
  onCopy(item: ImageResult): void; onDownload(item: ImageResult): void; downloadDisabled: boolean; view: ImageView; showKind?: boolean; header?: ReactNode; empty?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const prefix = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(270);
  const [width, setWidth] = useState(498);
  const columns = view === 'grid' ? Math.max(1, Math.min(3, Math.floor((width + GAP) / (150 + GAP)))) : 1;
  const cardWidth = (width - GAP * (columns - 1)) / columns;
  const rowHeight = view === 'grid' ? Math.ceil(cardWidth + GRID_CAPTION_HEIGHT + GAP) : LIST_ROW;
  const rows = Math.ceil(items.length / columns);
  const startRow = Math.max(0, Math.min(Math.floor(Math.max(0, scroll - headerHeight) / rowHeight) - 1, rows - Math.ceil(height / rowHeight)));
  const start = startRow * columns;
  const end = Math.min(items.length, start + (Math.ceil(height / rowHeight) + 2) * columns);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    function measure() {
      setHeight(element!.clientHeight || 270);
      setWidth(list.current?.clientWidth || element!.clientWidth || 498);
      setHeaderHeight(prefix.current?.offsetHeight || 0);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (prefix.current) observer.observe(prefix.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={root} className="image-list" data-view={view} role="region" aria-label={t("图像列表")} tabIndex={0} onScroll={event => setScroll(event.currentTarget.scrollTop)}>
    <div ref={prefix} className="image-list-heading">{header}</div>
    {items.length ? <div role="list" ref={list} className="virtual-images" style={{ height: rows * rowHeight }} onKeyDown={event => {
      const target = event.target as HTMLElement;
      if (target.getAttribute('role') !== 'checkbox') return;
      const index = items.findIndex(item => 'image-' + item.id === target.id);
      const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, ArrowDown: index + columns, ArrowUp: index - columns, Home: 0, End: items.length - 1 };
      const next = moves[event.key];
      if (next === undefined) return;
      event.preventDefault();
      const position = Math.max(0, Math.min(items.length - 1, next));
      const top = headerHeight + Math.floor(position / columns) * rowHeight;
      const element = root.current!;
      if (top < element.scrollTop || top + rowHeight > element.scrollTop + height) element.scrollTop = top;
      setScroll(element.scrollTop);
      requestAnimationFrame(() => document.getElementById('image-' + items[position]!.id)?.focus());
    }}>
      {items.slice(start, end).map((item, offset) => {
        const index = start + offset;
        const filename = imageFilename(item);
        const format = imageFormat(item.url);
        const stem = filename.replace(/\.[^.]+$/, '') || item.label;
        return <Card role="listitem" key={item.id} aria-posinset={index + 1} aria-setsize={items.length} className="image-item" data-selected={selected.has(item.id)} onClick={event => { if (!(event.target as HTMLElement).closest('button,a,input')) onToggle(item.id); }} style={{
          top: Math.floor(index / columns) * rowHeight,
          left: columns === 1 ? 0 : 'calc(' + ((index % columns) * 100 / columns) + '% + ' + ((index % columns) * GAP / columns) + 'px)',
          width: columns === 1 ? '100%' : 'calc((100% - ' + (GAP * (columns - 1)) + 'px) / ' + columns + ')',
          height: rowHeight - GAP,
        }}>
          <Checkbox id={'image-' + item.id} className="item-checkbox" aria-label={showKind ? t('选择{0}（{1}）', [translateMessage(item.label), item.candidate ? t('原图') : t('缩略图')]) : t('选择{0}', [translateMessage(item.label)])} checked={selected.has(item.id)} onCheckedChange={() => onToggle(item.id)} />
          <div className="image-detail"><ImageThumbnail item={item} onPreview={() => onPreview(item)} /><div className="image-caption"><span className="image-name" title={filename}>{stem}</span><div className="image-meta"><div className="image-tags"><FormatBadge format={format} />{showKind && <Badge variant="outline" className="kind-label">{item.candidate ? t("原图") : t("缩略图")}</Badge>}</div><div className="item-actions"><Button variant="ghost" size="icon-xs" className="item-copy" aria-label={t('复制 {0} 的链接', [translateMessage(item.label)])} title={t("复制图像链接")} onClick={() => onCopy(item)}><Link className="size-4" /></Button><Button variant="ghost" size="icon-xs" className="item-download" aria-label={showKind ? t('下载 {0}（{1}）', [translateMessage(item.label), item.candidate ? t('原图') : t('缩略图')]) : t('下载 {0}', [translateMessage(item.label)])} title={t("将这张图像保存为 ZIP")} disabled={downloadDisabled} onClick={() => onDownload(item)}><Download className="size-4" /></Button></div></div></div></div>
        </Card>;
      })}
    </div> : empty}
  </div>;
}
