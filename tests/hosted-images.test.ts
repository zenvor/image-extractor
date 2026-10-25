// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { FORUM_IMAGE_HOSTS, hostedImageHost, hostedImagePages, hostedOriginalUrl, hostedPageRequestUrl } from '../lib/hostedImageHosts';
import { parseHostedOriginal } from '../lib/hostedImageParser';
import { fetchHostedOriginal, resolveHostedPages } from '../lib/resolveHostedPages';

// Synthetic site-shape fixtures: no third-party HTML, images or gallery-dl source is bundled.
const cases = [
  ['imx', 'https://imx.to/i/abcdef', '<div style="text-align:center;"><a href="https://image.imx.to/u/i/2026/sample.png">image</a></div>', 'https://image.imx.to/u/i/2026/sample.png'],
  ['imgbox', 'https://imgbox.com/Abcd1234', '<meta property="og:image" content="https://images2.imgbox.com/aa/bb/test_o.jpg">', 'https://images2.imgbox.com/aa/bb/test_o.jpg'],
  ['vipr', 'https://vipr.im/abc123.html', '<img src="https://vipr.im/i/test.jpg">', 'https://vipr.im/i/test.jpg'],
  ['pixhost', 'https://pixhost.to/show/1/123_test.jpg', '<img class="image-img" src="https://img1.pixhost.to/images/1/123_test.jpg">', 'https://img1.pixhost.to/images/1/123_test.jpg'],
  ['imagebam', 'https://www.imagebam.com/view/MABC123', '<img class="main-image" src="https://images4.imagebam.com/aa/bb/test.jpg">', 'https://images4.imagebam.com/aa/bb/test.jpg'],
  ['imagevenue', 'https://www.imagevenue.com/ME12345678', '<div class="card-body"><img src="/loader.svg"><img src="https://img123.imagevenue.com/test.jpg"></div>', 'https://img123.imagevenue.com/test.jpg'],
  ['turboimagehost', 'https://www.turboimagehost.com/p/123/test.jpg.html', '<img id="imageid" src="https://s1d1.turboimg.net/sp/test.jpg">', 'https://s1d1.turboimg.net/sp/test.jpg'],
  ['acidimg', 'https://acidimg.cc/img-abc123.html', "<img class='centred' src='https://acidimg.cc/upload/test.jpg'>", 'https://acidimg.cc/upload/test.jpg'],
  ['imagetwist', 'https://imagetwist.com/abcdefgh1234/test.jpg', '<img src="https://img200.imagetwist.com/i/1234/test.jpg">', 'https://img200.imagetwist.com/i/1234/test.jpg'],
  ['imgspice', 'https://imgspice.com/abcdefgh1234/test.jpg.html', '<div id="imgpreview"><img src="https://img1.imgspice.com/i/test.jpg"></div>', 'https://img1.imgspice.com/i/test.jpg'],
  ['postimages', 'https://postimg.cc/AbCd1234', '<a id="download" href="https://i.postimg.cc/AbCd1234/test.jpg?token=a%2fb&amp;v=1">Download</a>', 'https://i.postimg.cc/AbCd1234/test.jpg?token=a%2fb&v=1'],
] as const;

it('covers the eleven forum/reference intersection providers without counting aliases twice', () => {
  expect(cases.map(item => item[0]).sort()).toEqual(FORUM_IMAGE_HOSTS.map(host => host.id).sort());
  expect(hostedImageHost('https://pixxxels.cc/AbCd1234')?.id).toBe('postimages');
  expect(hostedImageHost('https://imx.to/img-abcdef.html')?.id).toBe('imx');
});
it.each(cases)('parses a provider-scoped original for %s', (id, page, html, original) => {
  expect(hostedImageHost(page)?.id).toBe(id);
  expect(parseHostedOriginal(html, page)).toBe(original);
});
it('does not run scripts, load subframes, or insert fetched nodes into the live document', () => {
  const html = '<script>globalThis.pwned=true</script><iframe src="https://evil.test/"></iframe>' + cases[4][2];
  expect(parseHostedOriginal(html, cases[4][1])).toBe(cases[4][3]);
  expect((globalThis as { pwned?: boolean }).pwned).toBeUndefined();
  expect(document.querySelector('iframe, .main-image')).toBeNull();
});
it.each([
  'https://imx.to.evil.test/i/abcd', 'https://evil.test/imx.to/i/abcd',
  'https://user:pass@imx.to/i/abcd', 'http://127.0.0.1/i/abcd',
  'https://imx.to:1234/i/abcd', 'javascript:alert(1)',
  'https://imagebam.com/view/G1234', 'https://imgbox.com/g/0123456789',
])('rejects unsupported or deceptive detail-page targets: %s', page => {
  expect(hostedImageHost(page)).toBeUndefined();
});
it('rejects remote advertisements, thumbnail fallbacks, deleted files and challenge pages', () => {
  const page = cases[4][1];
  for (const url of ['https://evil.test/test.jpg', 'https://imagebam.com.evil.test/test.jpg', 'https://images4.imagebam.com/th/test.jpg', 'https://images4.imagebam.com/deleted.jpg']) {
    expect(hostedOriginalUrl(page, url)).toBe('');
    expect(parseHostedOriginal(`<img class="main-image" src="${url}">`, page)).toBe('');
  }
  expect(parseHostedOriginal('<title>Just a moment...</title>' + cases[4][2], page)).toBe('');
  expect(parseHostedOriginal('<form id="challenge-form"></form>' + cases[4][2], page)).toBe('');
  expect(parseHostedOriginal('<img src="https://vipr.im/i/a.jpg"><img src="https://vipr.im/i/b.jpg">', cases[2][1])).toBe('');
});
it('collects detail links from loaded image markup, resolves relative URLs and deduplicates pages', () => {
  const page = { url: 'https://vipergirls.to/threads/1', baseUrl: 'https://vipergirls.to/', title: '', challenged: false, truncated: false, total: 3,
    images: [cases[4][1], cases[4][1], 'https://evil.test/view/M123'].map(link => ({ link, source: 'https://thumbs.imagebam.com/sample.jpg', alt: 'sample', width: 0, height: 0, declared: [], srcsets: [] })) };
  expect(hostedImagePages(page)).toEqual([{ url: cases[4][1], source: page.images[0]!.source, label: 'sample' }]);
});
it('fetches only after invocation, with caller cancellation, strict redirects and a bounded HTML response', async () => {
  const request = vi.fn<typeof fetch>(async () => new Response(cases[4][2], { headers: { 'content-type': 'text/html' } }));
  const page = { url: cases[4][1], source: 'https://thumbs.imagebam.com/sample.jpg', label: '' };
  expect(await fetchHostedOriginal(page, new AbortController().signal, request)).toBe(cases[4][3]);
  expect(request.mock.calls[0]).toMatchObject(['https://imagebam.com/view/MABC123', { redirect: 'error', credentials: 'include' }]);
  const huge = vi.fn<typeof fetch>(async () => new Response('x', { headers: { 'content-type': 'text/html', 'content-length': String(3 * 1024 * 1024) } }));
  await expect(fetchHostedOriginal(page, new AbortController().signal, huge)).rejects.toThrow('超过');
  const invalid = vi.fn<typeof fetch>(async () => new Response('not HTML', { headers: { 'content-type': 'image/jpeg' } }));
  await expect(fetchHostedOriginal(page, new AbortController().signal, invalid)).rejects.toThrow('未返回');
});
it('uses the ordinary Acidimg image form without injecting cookies or executing its scripts', async () => {
  const request = vi.fn<typeof fetch>(async () => new Response(cases[7][2], { headers: { 'content-type': 'text/html' } }));
  await fetchHostedOriginal({ url: cases[7][1], source: '', label: '' }, new AbortController().signal, request);
  const options = request.mock.calls[0]?.[1] as RequestInit | undefined;
  expect(options?.method).toBe('POST');
  expect(String(options?.body)).toContain('imgContinue=');
  expect(options?.headers).toBeUndefined();
});
it('retains successful results when a different host fails, and does not continue after cancellation', async () => {
  const request = vi.fn<typeof fetch>(async () => new Response(cases[4][2], { headers: { 'content-type': 'text/html' } }));
  const controller = new AbortController();
  const save = vi.fn(async () => { controller.abort(new Error('closed')); });
  const pages = [cases[4], cases[3]].map(item => ({ url: item[1], source: '', label: '' }));
  await expect(resolveHostedPages(pages, controller.signal, save, request)).rejects.toThrow('closed');
  expect(save).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(1);
});
it('keeps individual failures separate from successful lookups', async () => {
  const pages = [cases[3], cases[4]].map(item => ({ url: item[1], source: '', label: '' }));
  const request = vi.fn<typeof fetch>(async url => String(url).includes('pixhost')
    ? new Response('Unavailable', { status: 503 })
    : new Response(cases[4][2], { headers: { 'content-type': 'text/html' } }));
  const save = vi.fn(async () => {});
  expect(await resolveHostedPages(pages, new AbortController().signal, save, request)).toEqual({ resolved: 1, failed: 1 });
  expect(save).toHaveBeenCalledWith(pages[1], cases[4][3]);
});
it('bounds a chunked body even if a Content-Length header is absent', async () => {
  const request = vi.fn<typeof fetch>(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/html' } }));
  await expect(fetchHostedOriginal({ url: cases[4][1], source: '', label: '' }, new AbortController().signal, request)).rejects.toThrow('超过');
});
it('does not request a detail page when its owner has already closed', async () => {
  const controller = new AbortController(); controller.abort(new Error('closed'));
  const request = vi.fn<typeof fetch>();
  await expect(fetchHostedOriginal({ url: cases[4][1], source: '', label: '' }, controller.signal, request)).rejects.toThrow('closed');
  expect(request).not.toHaveBeenCalled();
});

it('accepts Vipr image links that retain a filename after the image key', () => {
  const page = 'https://vipr.im/abcdefgh1234/sample.jpg.html';
  expect(parseHostedOriginal('<img class="pic img img-responsive" src="https://i7.vipr.im/i/00021/abcdefgh1234.jpg/sample.jpg">', page))
    .toBe('https://i7.vipr.im/i/00021/abcdefgh1234.jpg/sample.jpg');
});

it('normalizes only known service aliases before requesting permission or sending a request', () => {
  expect(hostedPageRequestUrl('http://pixxxels.cc/AbCd1234#preview')).toBe('https://postimg.cc/AbCd1234');
  expect(hostedPageRequestUrl('https://www.imagevenue.com/ME12345678')).toBe('https://imagevenue.com/ME12345678');
  expect(hostedPageRequestUrl('https://pixhost.org/show/1/123_test.jpg')).toBe('https://pixhost.to/show/1/123_test.jpg');
  expect(hostedPageRequestUrl('https://evil.test/i/abcdef')).toBe('');
});
it('holds the shared scheduler slot through reading and parsing the detail response body', async () => {
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const stream = new ReadableStream<Uint8Array>({ start(controller) { finish = () => { controller.enqueue(new TextEncoder().encode(cases[4][2])); controller.close(); }; } });
  const request = vi.fn<typeof fetch>(async () => { started(); return new Response(stream, { headers: { 'content-type': 'text/html' } }); });
  let held = false;
  const schedule = async <T,>(_url: string, _signal: AbortSignal, work: () => Promise<T>) => { held = true; try { return await work(); } finally { held = false; } };
  const result = resolveHostedPages([{ url: cases[4][1], source: '', label: '' }], new AbortController().signal, async () => {}, request, schedule);
  await ready;
  expect(held).toBe(true);
  finish();
  expect(await result).toEqual({ resolved: 1, failed: 0 });
  expect(held).toBe(false);
});

it('supports Chrome 120 without AbortSignal.any and forwards in-flight cancellation', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
  Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const request = vi.fn<typeof fetch>(async (_url, options) => {
    started();
    return await new Promise<Response>((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true }));
  });
  try {
    const pending = fetchHostedOriginal({ url: cases[4][1], source: '', label: '' }, controller.signal, request);
    const rejected = expect(pending).rejects.toThrow('closed');
    await ready;
    controller.abort(new Error('closed'));
    await rejected;
  } finally {
    if (descriptor) Object.defineProperty(AbortSignal, 'any', descriptor);
    else Reflect.deleteProperty(AbortSignal, 'any');
  }
});
