import { expect, it } from 'vitest';
import { analysisFilter, chosenAnalysisImages, defaultImageFilter, filterImageResults, selectBySize, updateVisibleSelection, userSelectedIds } from '../lib/selection';
import type { AnalysisState, ImageResult } from '../lib/types';

const results: ImageResult[] = [
  { id: 'a', label: '海岸线', candidate: true, url: 'https://images.example/SEA.JPG', source: '', reason: '', width: 0, height: 0 },
  { id: 'b', label: '海岸线', candidate: false, url: 'https://images.example/sea-thumb.jpg', source: '', reason: '', width: 0, height: 0 },
  { id: 'c', label: '高山', candidate: true, url: 'https://images.example/mountain.jpg', source: '', reason: '', width: 0, height: 0 },
];
it('keeps genuine page originals in page mode and excludes generated compatibility URLs', () => {
  const mixed = [
    { ...results[0]!, pageImage: true },
    { ...results[1]!, pageImage: true },
    { ...results[2]!, pageImage: false },
    { ...results[1]!, id: 'variant', pageImage: false },
  ];
  expect(defaultImageFilter(mixed)).toBe('page');
  expect(selectBySize(mixed, 'page')).toEqual(['a', 'b']);
  expect(filterImageResults(mixed, 'page', '').map(item => item.id)).toEqual(['a', 'b']);
  expect(selectBySize(mixed, 'large')).toEqual(['a', 'c']);
});
it('combines group, name or URL search', () => {
  expect(filterImageResults(results, 'all', ' 海岸线 ').map(item => item.id)).toEqual(['a', 'b']);
  expect(filterImageResults(results, 'large', 'sea.jpg').map(item => item.id)).toEqual(['a']);
  expect(filterImageResults(results, 'small', '').map(item => item.id)).toEqual(['b']);
});
it('selects and deselects visible results while keeping hidden selections', () => {
  expect(updateVisibleSelection(['c'], results.slice(0, 2), 'toggle')).toEqual(['c', 'a', 'b']);
  expect(updateVisibleSelection(['a', 'b', 'c'], results.slice(0, 2), 'toggle')).toEqual(['c']);
  expect(updateVisibleSelection(['a', 'c'], results.slice(0, 2), 'toggle')).toEqual(['a', 'c', 'b']);
});
it('inverts only visible images, including an empty result set', () => {
  expect(updateVisibleSelection(['a', 'c'], results.slice(0, 2), 'invert')).toEqual(['c', 'b']);
  expect(updateVisibleSelection(['c'], [], 'toggle')).toEqual(['c']);
  expect(updateVisibleSelection(['c'], [], 'invert')).toEqual(['c']);
});
it('select all never clears existing choices and preserves hidden images', () => {
  expect(updateVisibleSelection(['a', 'b', 'c'], results.slice(0, 2), 'select')).toEqual(['a', 'b', 'c']);
  expect(updateVisibleSelection(['c'], results.slice(0, 2), 'select')).toEqual(['c', 'a', 'b']);
  expect(updateVisibleSelection(['c'], [], 'select')).toEqual(['c']);
});
it('combines excluded formats with group, search', () => {
  const mixed = results.map((item, index) => ({ ...item, url: item.url.replace(/\.jpe?g$/i, index === 2 ? '.svg' : '.PNG?download=photo.jpg') }));
  expect(filterImageResults(mixed, 'all', '', new Set(['PNG'])).map(item => item.id)).toEqual(['c']);
  expect(filterImageResults(mixed, 'small', '海岸', new Set(['SVG'])).map(item => item.id)).toEqual(['b']);
  expect(filterImageResults(mixed, 'all', '海岸', new Set(['SVG'])).map(item => item.id)).toEqual(['a', 'b']);
  expect(filterImageResults(mixed, 'all', '', new Set(['PNG', 'SVG']))).toEqual([]);
});

it('requires an explicit saved user selection and scopes selected images to the active mode', () => {
  const state = { results, selected: ['a', 'b'], selectionMode: 'custom', selectionFilter: 'large' } as AnalysisState;
  expect(chosenAnalysisImages(state).map(item => item.id)).toEqual(['a']);
  expect(userSelectedIds(state)).toEqual(['a', 'b']);
  expect(chosenAnalysisImages({ ...state, selectionFilter: 'page' }).map(item => item.id)).toEqual(['b']);
  for (const selectionMode of [undefined, 'large', 'small', 'page', 'all'] as const) {
    expect(chosenAnalysisImages({ ...state, selectionMode })).toEqual([]);
  }
  expect(analysisFilter(undefined)).toBe('page');
  for (const selectionFilter of ['all', 'small'] as const) {
    expect(analysisFilter({ ...state, selectionFilter })).toBe('page');
    expect(chosenAnalysisImages({ ...state, selectionFilter }).map(item => item.id)).toEqual(['b']);
  }
});
