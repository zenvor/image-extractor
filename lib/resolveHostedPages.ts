import { hostedImageHost, hostedPageRequestUrl } from './hostedImageHosts';
import { parseHostedOriginal } from './hostedImageParser';
import { waitForDownload } from './downloadSpeed';
import type { HostedImagePage } from './types';

const MAX_HTML_BYTES = 2 * 1024 * 1024;
export async function fetchHostedOriginal(page: HostedImagePage, signal: AbortSignal, request: typeof fetch = fetch): Promise<string> {
  signal.throwIfAborted();
  const host = hostedImageHost(page.url);
  if (!host) throw new Error('不支持的图床详情页。');
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException('图床页面请求超时。', 'TimeoutError')), 15000);
  // Keep compatibility with our Chrome 120 minimum (AbortSignal.any is newer).
  const cancel = () => timeout.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  const requestSignal = timeout.signal;
  try {
    // A normal image-page form submission; no cookies are manufactured and no remote script runs.
    const options: RequestInit = { signal: requestSignal, credentials: 'include', redirect: 'error' };
    if (host.id === 'acidimg' || host.id === 'imx') {
      options.method = 'POST';
      options.body = new URLSearchParams({ imgContinue: host.id === 'imx' ? 'Continue to your image...' : 'Continue to image ...' });
    }
    const response = await request(hostedPageRequestUrl(page.url), options);
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    if (!response.body || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel(); throw new Error('图床未返回可解析的页面。');
    }
    if (Number(response.headers.get('content-length')) > MAX_HTML_BYTES) {
      await response.body.cancel(); throw new Error('图床页面超过读取上限。');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0, html = '';
    try {
      while (true) {
        requestSignal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_HTML_BYTES) throw new Error('图床页面超过读取上限。');
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
    requestSignal.throwIfAborted();
    const original = parseHostedOriginal(html, page.url);
    if (!original) throw new Error('未找到图床原图，请在网站完成验证后重试。');
    return original;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); timeout.abort(); }
}

/** Sequential, paced detail reads. Persist each success so closing the popup loses no completed work. */
export async function resolveHostedPages(pages: HostedImagePage[], signal: AbortSignal,
  onOriginal: (page: HostedImagePage, url: string) => Promise<void>,
  request?: typeof fetch,
  schedule?: <T>(url: string, signal: AbortSignal, work: () => Promise<T>) => Promise<T>): Promise<{ resolved: number; failed: number }> {
  let resolved = 0, failed = 0;
  for (const [index, page] of pages.entries()) {
    signal.throwIfAborted();
    if (index) await waitForDownload(500, signal);
    let url: string;
    try {
      const lookup = () => fetchHostedOriginal(page, signal, request);
      url = schedule ? await schedule(hostedPageRequestUrl(page.url), signal, lookup) : await lookup();
    }
    catch { signal.throwIfAborted(); failed++; continue; }
    signal.throwIfAborted();
    // State changes are fatal for this run, rather than being misreported as site failures.
    await onOriginal(page, url);
    resolved++;
  }
  return { resolved, failed };
}
