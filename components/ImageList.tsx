import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Pagination, PaginationContent, PaginationItem } from './ui/pagination';
import { t, translateMessage } from '../lib/i18n';
import { Activity, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, Link } from 'lucide-react';
import { Checkbox } from './ui/checkbox';
import { Button } from './ui/button';
import { FormatBadge } from './FormatBadge';
import { ImageThumbnail, imageFilename } from './ImageThumbnail';
import { imageFormat } from '../lib/urlImageFormat';
import type { ImageResult, ImageView } from '../lib/types';
import type { GalleryPosition } from '../lib/popupViewState';

const PAGE_SIZE = 20;
const RETAINED_PAGES = 3;

type ImageListProps = {
  items: ImageResult[]; selected: Set<string>; onToggle(id: string): void;
  initialPosition?: GalleryPosition; onPositionChange?(position: GalleryPosition): void;
  onCopy(item: ImageResult): void; onDownload(item: ImageResult): void; downloadDisabled: boolean; view: ImageView; showKind?: boolean; header?: (pagination: ReactNode) => ReactNode; empty?: ReactNode;
};

export function ImageList(props: ImageListProps) {
  // Reset only when the actual filtered results change, not when selection is saved.
  const resultKey = props.items.map(item => item.id).join('\0');
  return <PaginatedImageList key={resultKey} {...props} resultKey={resultKey} />;
}

function PaginatedImageList({ items, selected, onToggle, onCopy, onDownload, downloadDisabled, view, showKind = true, header, empty, initialPosition, onPositionChange, resultKey }: ImageListProps & { resultKey: string }) {
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const pages = Math.ceil(items.length / PAGE_SIZE);
  const [pagination, setPagination] = useState(() => {
    const page = initialPosition?.results === resultKey ? Math.min(initialPosition.page, Math.max(0, pages - 1)) : 0;
    return { page, retained: [page] };
  });
  const page = pagination.page;
  const restoredPosition = useRef(initialPosition?.results === resultKey ? initialPosition.scrollTop : 0);

  useLayoutEffect(() => {
    if (root.current) root.current.scrollTop = restoredPosition.current;
  }, []);
  useLayoutEffect(() => {
    onPositionChange?.({ results: resultKey, page, scrollTop: root.current?.scrollTop || 0 });
  }, [page, resultKey]);

  function changePage(next: number) {
    const target = Math.max(0, Math.min(pages - 1, next));
    if (target === page) return;
    setPagination(previous => ({ page: target, retained: [...previous.retained.filter(value => value !== target), target].slice(-RETAINED_PAGES) }));
    if (root.current) root.current.scrollTop = 0;
  }

  function focusImage(index: number) {
    const target = Math.max(0, Math.min(items.length - 1, index));
    changePage(Math.floor(target / PAGE_SIZE));
    requestAnimationFrame(() => {
      const checkbox = document.getElementById('image-' + items[target]!.id);
      checkbox?.focus({ preventScroll: true });
      checkbox?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  }

  const controls = pages > 1 ? <Pagination className="image-pagination" aria-label={t("图像分页")}>
    <PaginationContent>
      <PaginationItem><Button size="icon-xs" variant="ghost" disabled={page === 0} onClick={() => changePage(page - 1)} aria-label={t("上一页")} aria-controls={listId}><ChevronLeft aria-hidden="true" /></Button></PaginationItem>
      <PaginationItem><span className="image-page-summary" aria-live="polite" aria-label={t("第 {0} 页，共 {1} 页", [page + 1, pages])} title={t("第 {0} 页，共 {1} 页", [page + 1, pages])}>{page + 1} / {pages}</span></PaginationItem>
      <PaginationItem><Button size="icon-xs" variant="ghost" disabled={page === pages - 1} onClick={() => changePage(page + 1)} aria-label={t("下一页")} aria-controls={listId}><ChevronRight aria-hidden="true" /></Button></PaginationItem>
    </PaginationContent>
  </Pagination> : null;

  return <div className="image-gallery">
    <div className="image-list-heading">{header ? header(controls) : controls}</div>
    <div ref={root} className="image-list" data-view={view} role="region" aria-label={t("图像列表")} tabIndex={0} onScroll={event => onPositionChange?.({ results: resultKey, page, scrollTop: event.currentTarget.scrollTop })}>
      {items.length ? pagination.retained.map(pageIndex => <Activity key={pageIndex} mode={pageIndex === page ? 'visible' : 'hidden'}>
        <div role="list" id={pageIndex === page ? listId : undefined} className="image-cards" data-page={pageIndex + 1} data-visible={pageIndex === page} onKeyDown={event => {
          const target = event.target as HTMLElement;
          if (target.getAttribute('role') !== 'checkbox') return;
          const index = items.findIndex(item => 'image-' + item.id === target.id);
          const width = event.currentTarget.clientWidth || root.current?.clientWidth || 498;
          const columns = view === 'grid' ? Math.max(1, Math.min(3, Math.floor((width + 16) / 166))) : 1;
          const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, ArrowDown: index + columns, ArrowUp: index - columns, Home: 0, End: items.length - 1 };
          const next = moves[event.key];
          if (next === undefined) return;
          event.preventDefault();
          focusImage(next);
        }}>
          {items.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE).map((item, offset) => {
            const filename = imageFilename(item);
            const format = imageFormat(item.url);
            const stem = filename.replace(/\.[^.]+$/, '') || item.label;
            return <Card role="listitem" key={item.id} aria-posinset={pageIndex * PAGE_SIZE + offset + 1} aria-setsize={items.length} className="image-item" data-selected={selected.has(item.id)} onClick={event => { if (!(event.target as HTMLElement).closest('button,a,input')) onToggle(item.id); }}>
              <div className="image-detail"><ImageThumbnail item={item}><Checkbox id={'image-' + item.id} className="item-checkbox" aria-label={showKind ? t('选择{0}（{1}）', [translateMessage(item.label), item.candidate ? t('原图') : t('缩略图')]) : t('选择{0}', [translateMessage(item.label)])} checked={selected.has(item.id)} onCheckedChange={() => onToggle(item.id)} /></ImageThumbnail><div className="image-caption"><span className="image-name" title={filename}>{stem}</span><div className="image-meta"><div className="image-tags"><FormatBadge format={format} />{showKind && <Badge variant="outline" className="kind-label">{item.candidate ? t("原图") : t("缩略图")}</Badge>}</div><div className="item-actions"><Button variant="ghost" size="icon-xs" className="item-copy text-muted-foreground" aria-label={t('复制 {0} 的链接', [translateMessage(item.label)])} title={t("复制图像链接")} onClick={() => onCopy(item)}><Link className="size-4" /></Button><Button variant="ghost" size="icon-xs" className="item-download text-muted-foreground" aria-label={showKind ? t('下载 {0}（{1}）', [translateMessage(item.label), item.candidate ? t('原图') : t('缩略图')]) : t('下载 {0}', [translateMessage(item.label)])} title={t("直接下载这张图像")} disabled={downloadDisabled} onClick={() => onDownload(item)}><Download className="size-4" /></Button></div></div></div></div>
            </Card>;
          })}
        </div>
      </Activity>) : empty}
    </div>
  </div>;
}
