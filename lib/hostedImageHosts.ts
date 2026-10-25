import type { HostedImagePage, PageCapture } from './types';

// Site URL formats are protocol data. See docs/hosted-images.md for scope and references.
export const FORUM_IMAGE_HOSTS = [
  { id: 'imx', domains: ['imx.to', 'img.yt'], path: /^\/(?:i\/|img-)[a-z0-9]+(?:\.html)?\/?$/i, selectors: ['#download-url', '#image', '.centred', 'div[style*="text-align:center"] > a', 'div[style*="text-align: center"] > a'], output: ['imx.to', 'img.yt'] },
  { id: 'imgbox', domains: ['imgbox.com'], path: /^\/[a-z0-9]{8}(?:\/|$)/i, selectors: ['meta[property="og:image"]', '#img', '.image-container img'], output: ['imgbox.com'] },
  { id: 'vipr', domains: ['vipr.im'], path: /^\/[a-z0-9]+(?:\.html|\/[^/]+)?\/?$/i, selectors: ['img.img-responsive', 'img.pic', 'img[src*="/i/"]'], output: ['vipr.im'] },
  { id: 'pixhost', domains: ['pixhost.to', 'pixhost.org'], path: /^\/show\/\d+\/\d+_[^/]+$/, selectors: ['img.image-img'], output: ['pixhost.to', 'pixhost.org'] },
  { id: 'imagebam', domains: ['imagebam.com'], path: /^\/(?:image\/[a-z0-9]+|view\/M[a-z0-9]+)$/i, selectors: ['img.main-image', 'img[src*="//images"]'], output: ['imagebam.com'] },
  { id: 'imagevenue', domains: ['imagevenue.com'], path: /^\/(?:[a-z0-9]{8,}|view\/[^/]+|img\.php)$/i, selectors: ['.card-body img', '#thepic'], output: ['imagevenue.com'] },
  { id: 'turboimagehost', domains: ['turboimagehost.com'], path: /^\/p\/\d+\/[^/]+\.html$/i, selectors: ['#imageid', '#image', 'img[src*="turboimg.net/"]', 'img[src*="turboimagehost.com/"]'], output: ['turboimagehost.com', 'turboimg.net'] },
  { id: 'acidimg', domains: ['acidimg.cc'], path: /^\/img-[a-z0-9]+\.html$/i, selectors: ['img.centred'], output: ['acidimg.cc'] },
  { id: 'imagetwist', domains: ['imagetwist.com', 'imagehaha.com'], path: /^\/[a-z0-9]{12}(?:\/[^/]+)?\/?$/i, selectors: ['img.pic', 'img[src*="/i/"]'], output: ['imagetwist.com', 'imagehaha.com'] },
  { id: 'imgspice', domains: ['imgspice.com'], path: /^\/[a-z0-9]+(?:\/[^/]+)?\/?$/i, selectors: ['#imgpreview img', 'img#imgpreview'], output: ['imgspice.com'] },
  { id: 'postimages', domains: ['postimg.cc', 'postimg.org', 'postimages.org', 'pixxxels.cc', 'pixxxels.org'], path: /^\/(?:image\/)?[a-z0-9]+\/?$/i, selectors: ['a#download', '#main-image', 'meta[property="og:image"]'], output: ['postimg.cc', 'postimg.org', 'postimages.org', 'pixxxels.cc', 'pixxxels.org'] },
] as const;

export function safeHostedUrl(raw: string, base?: string): URL | undefined {
  if (!raw || raw.length > 2048) return;
  try {
    const url = new URL(raw, base);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return;
    return url;
  } catch { return; }
}
const matchesDomain = (host: string, domain: string) => host === domain || host.endsWith('.' + domain);

export function hostedImageHost(raw: string) {
  const url = safeHostedUrl(raw);
  if (!url) return;
  // A detail page lives on a service endpoint, not an arbitrary CDN or sibling subdomain.
  return FORUM_IMAGE_HOSTS.find(host => host.domains.some(domain => url.hostname === domain || url.hostname === 'www.' + domain || host.id === 'imagevenue' && /^img\d+\.imagevenue\.com$/.test(url.hostname) || host.id === 'imagetwist' && url.hostname === 'phun.' + domain)
    && host.path.test(url.pathname));
}

/** Canonical service hosts avoid common www-to-apex redirects before permission acquisition. */
export function hostedPageRequestUrl(raw: string): string {
  const host = hostedImageHost(raw);
  const url = safeHostedUrl(raw);
  if (!host || !url) return '';
  if (host.id === 'imagebam' || host.id === 'imagevenue') url.hostname = url.hostname.replace(/^www\./, '');
  if (host.id === 'imx' && url.hostname === 'img.yt') url.hostname = 'imx.to';
  if (host.id === 'pixhost') url.hostname = 'pixhost.to';
  if (host.id === 'postimages') url.hostname = 'postimg.cc';
  url.protocol = 'https:';
  url.hash = '';
  return url.href;
}

export function hostedOriginalUrl(pageUrl: string, raw: string): string {
  const host = hostedImageHost(pageUrl);
  const url = safeHostedUrl(raw, pageUrl);
  if (!host || !url || !host.output.some(domain => matchesDomain(url.hostname, domain))) return '';
  if (!/\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?)$/i.test(url.pathname)
    || /\/(?:thumbs?|th|imgs)\//i.test(url.pathname) || /(?:_t|loader|placeholder|deleted|error)(?:\.[a-z]+)?$/i.test(url.pathname)) return '';
  return url.href;
}

export function hostedImagePages(page: PageCapture): HostedImagePage[] {
  const seen = new Set<string>();
  const result: HostedImagePage[] = [];
  for (const image of page.images) {
    const url = safeHostedUrl(image.link, page.baseUrl);
    const source = safeHostedUrl(image.source || image.sources?.[0] || '', page.baseUrl);
    if (!url || !source || !hostedImageHost(url.href) || seen.has(url.href)) continue;
    seen.add(url.href);
    result.push({ url: url.href, source: source.href, label: image.alt });
  }
  return result;
}
