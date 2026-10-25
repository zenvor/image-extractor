import { imageFormats } from '../../lib/urlImageFormat';
import { defaultImageFilter } from '../../lib/selection';
import { EXTRACTION_VERSION as ORIGINAL_RESOLVER_VERSION } from '../../lib/extractionVersion';
import type { AnalysisState, ArchiveBatch, ImageResult } from '../../lib/types';

const previewMode = new URLSearchParams(location.search).get('preview');
const fitPreview = previewMode === 'fit';
const feedbackPreview = previewMode === 'feedback';
const sidebarPreview = previewMode === 'sidebar' || previewMode === 'sidebar-all';
const sceneLabels = ['山间晨光', '海岸线', '森林小径', '湖面倒影', '城市日落', '沙漠暮色', '峡谷之旅', '远山与海'];
const samples = fitPreview ? [
  { label: '宽幅全景', filename: 'panorama.svg', source: '/preview/fit-panorama.svg' },
  { label: '竖幅插画', filename: 'portrait.svg', source: '/preview/fit-portrait.svg' },
  { label: '16px 小图标', filename: 'icon-16.png', source: '/icons/16.png' },
  { label: '方形图标', filename: 'icon-128.png', source: '/icons/128.png' },
] : sceneLabels.map((label, index) => ({ label, filename: 'landscape-' + index + '.jpg', source: '/preview/scene-' + (index + 1) + '.svg' }));
const sampleState: AnalysisState = {
  job: 'preview', resolverVersion: ORIGINAL_RESOLVER_VERSION, tabId: 1, url: 'https://example.org/gallery', title: fitPreview ? '横图、竖图与小图标' : '山与海 · 旅行影集',
  status: 'done', started: Date.now(), total: samples.length, truncated: false, message: '', selected: [], selectionMode: 'custom', selectionFilter: 'large',
  results: Array.from({ length: samples.length * 2 }, (_, index) => ({
    id: String(index), url: 'https://example.org/' + (index % 2 ? 'thumbs' : 'photos') + '/' + samples[index >> 1]!.filename,
    source: new URL(feedbackPreview && index < 2 ? '/preview/retry-demo.svg' : samples[index >> 1]!.source, location.href).href,
    label: samples[index >> 1]!.label, reason: index % 2 ? '缩略图 · 页面源图' : '原图 · 路径规则', pageImage: index % 2 === 1, candidate: index % 2 === 0, width: 0, height: 0,
  })),
};

// Local-only fixtures exercise sidebar density without reading a webpage or fetching images.
const sidebarFormats = previewMode === 'sidebar-all'
  ? imageFormats.map(format => ({ format, count: 100 }))
  : [{ format: 'JPG', count: 320 }, { format: 'PNG', count: 8 }, { format: 'GIF', count: 5 }];
const sidebarResults: ImageResult[] = sidebarPreview ? sidebarFormats.flatMap(({ format, count }) => Array.from({ length: count }, (_, index) => ({
  id: format + index, url: 'https://example.org/photos/' + format.toLowerCase() + '-' + index + '.' + format.toLowerCase(),
  source: new URL('/preview/scene-' + (index % 8 + 1) + '.svg', location.href).href,
  label: sceneLabels[index % 8]!, reason: '原图 · 本地样例', pageImage: true, candidate: true, width: 0, height: 0,
}))) : [];
const layoutPreviewState: AnalysisState = sidebarPreview ? {
  ...sampleState, title: '侧栏布局 · 本地图像样例', results: sidebarResults, total: sidebarResults.length,
  selected: [], truncated: previewMode === 'sidebar-all',
} : sampleState;
const previewResults = previewMode === 'thumbs' ? sampleState.results.filter(item => !item.candidate) : layoutPreviewState.results;
export const previewFilter = defaultImageFilter(previewResults);
export const previewState: AnalysisState = { ...layoutPreviewState, results: previewResults, selected: [], selectionMode: 'custom', selectionFilter: previewFilter };
export const previewArchive: ArchiveBatch | undefined = feedbackPreview ? {
  id: 'preview-feedback', title: '下载反馈 · 本地演示', filename: '本地演示.zip', pageUrl: previewState.url, sourceTabId: 1,
  items: previewResults.filter(item => item.candidate).map((item, index) => ({ id: item.id, url: item.url, kind: 'large', filename: item.id, status: index === 0 ? 'failed' : 'complete' })),
  status: new URLSearchParams(location.search).has('cancelled') ? 'cancelled' : 'partial', started: Date.now(), updated: Date.now(), bytes: 0, message: '本地反馈演示', tabId: 1,
} : previewMode === 'sidebar-all' ? {
  id: 'preview-zip', title: previewState.title!, filename: '本地样例.zip', pageUrl: previewState.url, sourceTabId: 1,
  items: sidebarResults.map((item, index) => ({ id: item.id, url: item.url, kind: 'large', filename: item.id, status: index === 0 ? 'failed' : index < 300 ? 'complete' : 'pending' })),
  cacheUntil: Date.now() + 86400000,
  status: new URLSearchParams(location.search).get('archive') === 'cancelled' ? 'cancelled' : 'fetching', started: Date.now(), updated: Date.now(), bytes: 0, message: '正在下载图像 · 本地进度演示', tabId: 1,
} : undefined;


export const previewNotice = new URLSearchParams(location.search).get("notice") === "long" ? "https://example.org/" + "image-name-".repeat(100) : new URLSearchParams(location.search).has("notice") ? "已导出 TXT 链接文件" : "";
