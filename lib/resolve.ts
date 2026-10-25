import { imageUrl } from './imageSource';
import { parseSrcset } from './srcset';
import { resolveOriginalImage } from './originalImageResolver.js';
import { planImageAddresses } from './imageAddressPlan.js';
import type { ImageResult, PageCapture } from './types';

export function httpUrl(value: string, base: string): string {
  if (!value || value.length > 2048) return '';
  try {
    const url = new URL(value, base || undefined);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

// Explicit host/path mappings only; extension never requests these URLs.
export function originalCandidate(source: string): string {
  const resolved = resolveOriginalImage(source, { type: 'transparent' });
  return (resolved.status === 'resolved' || resolved.status === 'unchanged' && resolved.resolver === 'legacy-compatible-rule') && resolved.url ? resolved.url : '';
}

export function resolveImages(page: PageCapture): ImageResult[] {
  return resolveImagesWithDiagnostics(page).results;
}
export function resolveImagesWithDiagnostics(page: PageCapture): { results: ImageResult[]; unresolvedCount: number } {
  const unresolved = new Set<string>();
  let inlineBytes = 0;
  const inlineSeen = new Set<string>();
  const normalize = (value: string) => {
    const url = imageUrl(value, page.baseUrl);
    const raw = value.trim();
    if (!url && raw && raw.length <= 2048 && !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(raw)) {
      // Only flag relative URLs that fail without a usable base, not excluded schemes.
      try { new URL(raw, page.baseUrl || undefined); } catch { unresolved.add(raw); }
    }
    if (!url.startsWith('data:')) return url;
    if (!page.inlineAllowed) return '';
    if (!inlineSeen.has(url)) {
      if (inlineBytes + url.length > 1048576) { page.truncated = true; return ''; }
      inlineSeen.add(url); inlineBytes += url.length;
    }
    return url;
  };
  const ordered: string[] = [];
  const declaredOriginals = new Set<string>();
  const metadata = new Map<string, { source: string; label: string; origin: string; width: number; height: number }>();
  for (const [index, image] of page.images.entries()) {
    const source = [image.source, ...(image.sources || [])].map(value => normalize(value)).find(Boolean) || '';
    const addresses: { url: string; origin: string }[] = image.declared.map(url => ({ url, origin: '页面声明' }));
    const linked = httpUrl(image.link, page.baseUrl);
    if (linked && /\.(?:avif|jpe?g|png|webp|gif|svg|ico|bmp|tiff?)(?:$)/i.test(new URL(linked).pathname)) {
      addresses.push({ url: linked, origin: '图像直链' });
    }
    for (const srcset of image.srcsets) {
      for (const url of parseSrcset(srcset)) addresses.push({ url, origin: 'srcset 地址' });
    }
    for (const url of [image.source, ...(image.sources || [])]) addresses.push({ url, origin: '页面源图' });
    for (const address of addresses) {
      const url = normalize(address.url);
      if (!url) continue;
      if (image.original) declaredOriginals.add(url);
      if (metadata.has(url)) continue;
      metadata.set(url, { source, label: image.alt || `图像 ${index + 1}`, origin: address.origin, width: image.width, height: image.height });
      ordered.push(url);
    }
  }
  const pageOrder = new Map(ordered.map((url, index) => [url, index]));
  const results = planImageAddresses(ordered, 12000, page.url).map((entry, index) => {
    const meta = metadata.get(entry.source)!;
    const ruleName = entry.resolver?.startsWith('imx-') ? 'imx' : new URL(entry.source).hostname.split('.').slice(-2)[0];
    return { id: String(index), url: entry.url, pageImage: metadata.has(entry.url), pageOrder: pageOrder.get(entry.url), source: meta.source, label: meta.label, width: meta.width, height: meta.height, candidate: entry.large || declaredOriginals.has(entry.url), reason: entry.large ? `大图 · ${ruleName} 规则` : `小图 · ${meta.origin}` };
  });
  return { results, unresolvedCount: unresolved.size };
}
