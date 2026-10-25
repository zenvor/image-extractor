import type { AnalysisState, ImageFilter, ImageResult, SelectionMode } from './types';
import { imageFormat, type ImageFormat } from './urlImageFormat';

export function defaultImageFilter(_results: ImageResult[]): ImageFilter {
  return 'page';
}

// Known originals already present on the page remain ordinary page images too.
export function isPageImage(item: ImageResult): boolean {
  return item.pageImage ?? (!item.candidate || item.url === item.source);
}

export function selectBySize(results: ImageResult[], mode: SelectionMode): string[] {
  if (mode === 'page') return filterImageResults(results, 'page', '').map(item => item.id);
  return results.filter(item => mode === 'all' || (mode === 'large' ? item.candidate : mode === 'small' && !item.candidate)).map(item => item.id);
}

export function filterImageResults(results: ImageResult[], filter: ImageFilter, query: string, excludedFormats: ReadonlySet<ImageFormat> = new Set()): ImageResult[] {
  const text = query.trim().toLocaleLowerCase();
  const filtered = results.filter(item =>
    (filter === 'page' ? isPageImage(item) : filter === 'all' || item.candidate === (filter === 'large')) &&
    !excludedFormats.has(imageFormat(item.url)) &&
    (!text || (item.label + ' ' + item.url).toLocaleLowerCase().includes(text)),
  );
  return filter === 'page' ? filtered.sort((a, b) => (a.pageOrder ?? 0) - (b.pageOrder ?? 0)) : filtered;
}

// Bulk actions change the visible results, preserving selections hidden by filters.
export function updateVisibleSelection(selected: string[], visible: ImageResult[], action: 'select' | 'toggle' | 'invert'): string[] {
  const ids = new Set(selected);
  const remove = visible.length > 0 && visible.every(item => ids.has(item.id));
  for (const item of visible) {
    if (action === 'invert' ? ids.has(item.id) : action === 'toggle' && remove) ids.delete(item.id);
    else ids.add(item.id);
  }
  return [...ids];
}

/** Legacy automatic selections are not evidence of a user's choice. */
export function userSelectedIds(state?: AnalysisState): string[] {
  return state?.selectionMode === 'custom' ? state.selected : [];
}

export function analysisFilter(state?: AnalysisState): 'page' | 'large' {
  return state?.selectionFilter === 'large' || !state?.selectionFilter && state?.selectionMode === 'large' ? 'large' : 'page';
}

export function chosenAnalysisImages(state: AnalysisState): ImageResult[] {
  const selected = new Set(userSelectedIds(state));
  return filterImageResults(state.results, analysisFilter(state), '').filter(item => selected.has(item.id));
}
