import { imageFormats, type ImageFormat } from './urlImageFormat';

export type GalleryPosition = { results: string; page: number; scrollTop: number };
export type PopupViewState = {
  job: string;
  query: string;
  excludedFormats: ImageFormat[];
  darkPreview: boolean;
  gallery?: GalleryPosition;
};

export const popupViewKey = (tabId: number) => `popupView:${tabId}`;

export function readPopupView(value: unknown, job: string): PopupViewState | undefined {
  if (!value || typeof value !== 'object' || (value as PopupViewState).job !== job) return;
  const saved = value as PopupViewState;
  const gallery = saved.gallery;
  return {
    job,
    query: typeof saved.query === 'string' ? saved.query : '',
    excludedFormats: Array.isArray(saved.excludedFormats) ? saved.excludedFormats.filter(format => imageFormats.includes(format)) : [],
    darkPreview: saved.darkPreview === true,
    gallery: gallery && typeof gallery.results === 'string' && Number.isInteger(gallery.page) && gallery.page >= 0 && Number.isFinite(gallery.scrollTop) && gallery.scrollTop >= 0
      ? { results: gallery.results, page: gallery.page, scrollTop: gallery.scrollTop } : undefined,
  };
}
