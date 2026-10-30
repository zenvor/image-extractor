import { Brand } from '../../components/Brand';
import { Skeleton } from '../../components/ui/skeleton';
import { t } from '../../lib/i18n';
import { useLocale } from '../../lib/useLocale';

export function PopupSkeleton({ preview = false }: { preview?: boolean }) {
  useLocale();
  return <main className="popup-shell [&_[data-slot=skeleton]]:motion-reduce:animate-none" data-preview={preview} aria-busy="true" role="status" aria-label={t('正在读取页面与设置…')}>
    <span className="sr-only">{t('正在读取页面与设置…')}</span>
    <header className="app-header" aria-hidden="true">
      <div className="extraction-nav"><Brand compact /><div className="page-context flex flex-col gap-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div><Skeleton className="h-8 w-36 shrink-0" /></div>
    </header>
    <div className="popup-workspace" aria-hidden="true">
      <aside className="workspace-sidebar">
        <div className="sidebar-controls">
          <div className="original-mode-control flex"><Skeleton className="h-4 w-36" /><Skeleton className="h-5 w-8 rounded-full" /></div>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-9 w-full" />
          <div className="sidebar-group"><Skeleton className="h-5 w-28" /><Skeleton className="h-8 w-full" /></div>
          <div className="sidebar-group"><Skeleton className="h-5 w-28" /><Skeleton className="h-8 w-full" /></div>
        </div>
        <div className="download-footer">
          <Skeleton className="h-5 w-20" />
          <div className="bulk-actions"><Skeleton className="h-8 flex-1" /><Skeleton className="h-8 flex-1" /></div>
          <Skeleton className="h-10 w-full" />
          {[0, 1, 2].map(row => <Skeleton key={row} className="h-8 w-full" />)}
        </div>
        <Skeleton className="mt-auto h-8 w-28" />
      </aside>
      <div className="image-workspace">
        <section className="gallery">
          <div className="image-gallery">
            <div className="image-list-heading"><div className="results-toolbar"><Skeleton className="h-5 w-24" /><Skeleton className="ml-auto h-5 w-48" /></div></div>
            <div className="image-list"><div className="image-cards">{[0, 1, 2, 3, 4, 5].map(card => <div key={card} className="image-item"><div className="w-full"><Skeleton className="aspect-square w-full" /><Skeleton className="mt-3 h-3 w-3/4" /><Skeleton className="mt-2 h-3 w-1/2" /></div></div>)}</div></div>
          </div>
        </section>
      </div>
    </div>
  </main>;
}
