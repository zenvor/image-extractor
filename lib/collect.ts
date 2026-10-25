import type { CollectOptions, PageCapture, RawImage } from './types';

// Self-contained: executeScript serializes this function, so no runtime imports.
export function collectPage(options: CollectOptions = {}, imported?: { html: string; url: string; title: string }): PageCapture {
  // A template keeps imported HTML inert: no scripts, subframes or image loads.
  const template = imported ? document.createElement('template') : undefined;
  if (template && imported) template.innerHTML = imported.html;
  const root = template?.content || document;
  const pageUrl = imported ? imported.url : location.href;
  let baseUrl = imported ? imported.url : document.baseURI;
  if (imported) {
    try { const base = new URL(root.querySelector('base[href]')?.getAttribute('href') || '', baseUrl || undefined); if (/^https?:$/.test(base.protocol)) baseUrl = base.href; } catch { /* no usable base */ }
  }
  const title = imported ? root.querySelector('title')?.textContent || imported.title : document.title;
  let inlineBytes = 0;
  let limited = false;
  const acceptInline = (value: string) => {
    if (!options.inline || !/^data:image\/(?:png|jpeg|gif|webp|avif|bmp|tiff|x-icon|vnd.microsoft.icon|svg\+xml)[;,]/i.test(value)) return '';
    if (value.length > 131072 || inlineBytes + value.length > 1048576) { limited = true; return ''; }
    inlineBytes += value.length; return value;
  };
  const clean = (value: string | null) => value?.startsWith('data:') ? acceptInline(value) : value && value.length <= 2048 ? value : '';
  const nodes = root.querySelectorAll<HTMLImageElement>('img');
  const images: RawImage[] = [];
  for (let index = 0; index < Math.min(nodes.length, 2000); index++) {
    const img = nodes[index]!;
    const picture = img.closest('picture');
    const sources = [...new Set([clean(imported ? '' : img.currentSrc), clean(img.getAttribute('src')), clean(img.getAttribute('data-src')), clean(img.getAttribute('data-lazy-src'))].filter(Boolean))];
    images.push({
      source: sources[0] || '',
      sources,
      alt: img.alt.slice(0, 100),
      width: img.naturalWidth,
      height: img.naturalHeight,
      declared: ['data-original', 'data-full', 'data-zoom-image'].map(key => clean(img.getAttribute(key))).filter(Boolean),
      srcsets: [clean(img.getAttribute('srcset')), clean(img.getAttribute('data-srcset')), ...Array.from(picture?.querySelectorAll('source') || []).slice(0, 10).map(node => clean(node.getAttribute('srcset')))].filter(Boolean),
      link: clean(img.closest('a')?.getAttribute('href') || ''),
    });
  }
  const extension = /\.(?:avif|jpe?g|png|webp|gif|svg|bmp|ico|tiff?)(?:$)/i;
  const isImage = (value: string) => { try { return extension.test(new URL(value, baseUrl || undefined).pathname); } catch { return false; } };
  let total = nodes.length;
  const append = (raw: string | null, alt = '', original = false) => {
    if (!raw || raw.startsWith('#')) return;
    const source = clean(raw);
    if (!source) return;
    total++;
    if (images.length >= 2000) { limited = true; return; }
    images.push({ source, alt: alt.slice(0, 100), original, width: 0, height: 0, declared: [], srcsets: [], link: '' });
  };
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = a.getAttribute('href') || '';
    if (isImage(href)) append(href, a.textContent || '');
  }
  const keys = new Set(['og:image','og:image:url','og:image:secure_url','twitter:image','twitter:image:src','image','thumbnail','thumbnailurl','msapplication-tileimage']);
  for (const meta of root.querySelectorAll('meta[content]')) {
    if (['name','property','itemprop'].some(key => keys.has((meta.getAttribute(key) || '').trim().toLowerCase()))) append(meta.getAttribute('content'));
  }
  if (options.icons) for (const link of root.querySelectorAll('link[href]')) {
    const href = link.getAttribute('href') || '';
    if (/(?:^|\s)(?:icon|apple-touch-icon|apple-touch-icon-precomposed)(?:\s|$)/i.test(link.getAttribute('rel') || '') || isImage(href)) append(href);
  }
  for (const svg of root.querySelectorAll('svg image, svg use')) append(svg.getAttribute('href') || svg.getAttribute('xlink:href'));
  const svgDependencies = options.inline ? new Map([...root.querySelectorAll('[id]')].filter(node => node.namespaceURI === 'http://www.w3.org/2000/svg').map(node => [node.id, node])) : new Map<string, Element>();
  if (options.inline) for (const svg of root.querySelectorAll('svg')) {
    const clone = svg.cloneNode(true) as SVGElement;
    // Inline symbols/gradients/clip paths can live in a different SVG on the page.
    // Copy the reachable dependency graph into this export, with cycle/budget guards.
    const ids = new Set([clone, ...clone.querySelectorAll('[id]')].map(node => node.id).filter(Boolean));
    const visited = new Set<string>();
    const pending: Element[] = [clone];
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    let dependencyBytes = 0;
    let dependenciesComplete = true;
    while (pending.length) {
      const current = pending.shift()!;
      for (const node of [current, ...current.querySelectorAll('*')]) for (const attribute of [...node.attributes]) {
        const references = /^(?:href|xlink:href)$/i.test(attribute.name) && attribute.value.startsWith('#')
          ? [attribute.value.slice(1)]
          : [...attribute.value.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/gi)].map(match => match[1]!);
        for (const id of references) {
          if (visited.has(id)) continue;
          visited.add(id);
          if (ids.has(id)) continue;
          const dependency = svgDependencies.get(id);
          if (!dependency) continue;
          const size = dependency.outerHTML.length;
          if (visited.size > 100 || dependencyBytes + size > 131072) { limited = true; dependenciesComplete = false; continue; }
          dependencyBytes += size;
          const copy = dependency.cloneNode(true) as Element;
          defs.append(copy); pending.push(copy);
          for (const child of [copy, ...copy.querySelectorAll('[id]')]) if (child.id) ids.add(child.id);
        }
      }
    }
    if (!dependenciesComplete) continue;
    if (defs.childElementCount) clone.prepend(defs);
    // Export a passive image, never executable document markup.
    clone.querySelectorAll('script,foreignObject').forEach(node => node.remove());
    for (const node of [clone, ...clone.querySelectorAll('*')]) for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name) || /^(?:href|xlink:href)$/i.test(attribute.name) && !attribute.value.startsWith('#')) node.removeAttribute(attribute.name);
    }
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    append('data:image/svg+xml,' + encodeURIComponent(new XMLSerializer().serializeToString(clone)), 'inline-svg');
  }
  if (options.css) {
    const elements = root.querySelectorAll<HTMLElement>('[style], [class]');
    if (elements.length > 5000) limited = true;
    for (const node of [...elements].slice(0, 5000)) {
      const style = imported ? node.style : getComputedStyle(node);
      const values = [style.backgroundImage, style.getPropertyValue('--svg')];
      for (const value of values) {
        // Handles multiple backgrounds and url() entries in image-set().
        for (const match of (value || '').matchAll(/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s]+))\s*\)/gi)) append(match[1] || match[2] || match[3] || '');
      }
    }
  }
  let hostname = '';
  try { hostname = new URL(pageUrl).hostname; } catch { /* imported HTML needs an explicit base */ }
  const selector = hostname === 'www.eroticbeauties.net' ? 'span.jpg[data-src]' : hostname === 'www.alsasianporn.com' ? 'a[data-fancybox="gallery"]' : ['www.japanesesexpic.me','www.asianpussypic.me'].includes(hostname) ? 'a[target="_blank"]' : '';
  if (selector) for (const node of root.querySelectorAll(selector)) append(node.getAttribute('data-src') || node.getAttribute('href'), '', true);
  const challenged = !!root.querySelector('#challenge-running, #challenge-form, #cf-challenge-running, iframe[src*="challenges.cloudflare.com"]')
    || /^(just a moment|attention required|verify you are human)/i.test(title.trim());
  return { inlineAllowed: options.inline === true, url: pageUrl, baseUrl, title: title.slice(0, 500), challenged, total, truncated: limited || nodes.length > 2000, images };
}
