// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { collectPage } from '../lib/collect';
import { resolveImages } from '../lib/resolve';
import { requiredOrigins } from '../lib/archiveState';
import { planImageAddresses } from '../lib/imageAddressPlan.js';
import { imageFormat } from '../lib/urlImageFormat';
import { thumbnailUrl } from '../components/ImageThumbnail';
import { filterImageResults } from '../lib/selection';

beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });
const collect = () => resolveImages({ ...collectPage({ css: true, icons: true, inline: true }), baseUrl: 'https://example.org/gallery/' });
it('discovers lazy images, standalone links, semantic meta, icons and SVG image references', () => {
  document.head.innerHTML = '<meta property="og:image" content="/social.jpg"><meta name="description" content="not-a-photo.jpg"><link rel="apple-touch-icon" href="/apple.png">';
  document.body.innerHTML = '<img data-lazy-src="/lazy.jpg" data-srcset="/retina.jpg 2x"><a href="/direct.tiff">Photo</a><a href="/viewer">View</a><svg><image href="/inside.png"/></svg>';
  const urls = collect().map(item => item.url);
  for (const name of ['lazy.jpg','retina.jpg','direct.tiff','social.jpg','apple.png','inside.png']) expect(urls).toContain('https://example.org/' + name);
  expect(urls.some(url => /description|not-a-photo|viewer/.test(url))).toBe(false);
});
it('keeps optional icon, CSS and inline sources opt-in', () => {
  document.head.innerHTML = '<link rel="icon" href="/favicon.ico">';
  document.body.innerHTML = '<div style="background-image:url(/background.png)"></div><svg><rect width="3" height="4"/></svg>';
  expect(collectPage().images).toHaveLength(0);
  expect(collect().map(item => item.url)).toContain('https://example.org/background.png');
});
it('extracts multiple background layers', () => {
  document.body.innerHTML = '<div style="background-image:url(/one.png),url(/two.png)"></div>';
  const urls = collect().map(item => item.url);
  expect(urls).toContain('https://example.org/one.png'); expect(urls).toContain('https://example.org/two.png');
});
it('keeps ordinary page images when all additional sources are disabled', () => {
  document.head.innerHTML = '<link rel="icon" href="/favicon.ico">';
  document.body.innerHTML = '<img src="https://example.org/photo.jpg"><div style="background-image:url(/background.png)"></div><svg><rect width="3" height="4"/></svg>';
  const results = resolveImages(collectPage({ css: false, icons: false, inline: false }));
  expect(filterImageResults(results, 'page', '').map(item => item.url)).toEqual(['https://example.org/photo.jpg']);
});
it('distinguishes actual page URLs from generated originals and compatibility variants', () => {
  const thumb = 'https://image.imx.to/u/t/2026/05/24/6s79sr.jpg';
  const original = 'https://i02.imx.to/i/2026/05/24/6s79sr.jpg';
  const variant = 'https://example.org/photo_webp.jpg';
  document.body.innerHTML = `<img src="${thumb}"><img src="${variant}"><img src="https://sun.userapi.com/gallery.jpg">`;
  const results = collect();
  expect(results.find(item => item.url === original)).toMatchObject({ pageImage: false, candidate: true });
  expect(results.find(item => item.url === 'https://example.org/photo.jpg')).toMatchObject({ pageImage: false, candidate: false });
  expect(filterImageResults(results, 'page', '').map(item => item.url)).toEqual([thumb, variant, 'https://sun.userapi.com/gallery.jpg']);
  document.body.innerHTML += `<img src="${original}">`;
  const withOriginal = collect();
  expect(withOriginal.find(item => item.url === original)?.pageImage).toBe(true);
  expect(filterImageResults(withOriginal, 'page', '').map(item => item.url)).toEqual([thumb, variant, 'https://sun.userapi.com/gallery.jpg', original]);
});
it('caps inline payloads without exporting truncated bytes', () => {
  document.body.innerHTML = '<img src="data:image/png;base64,' + 'A'.repeat(140000) + '">';
  const page = collectPage({ inline: true });
  expect(page.truncated).toBe(true); expect(resolveImages(page)).toHaveLength(0);
});
it('sanitizes inline SVG and handles its preview, format and permissions', () => {
  document.body.innerHTML = '<svg onload="alert(1)" viewBox="0 0 10 10"><script>bad()</script><foreignObject>bad</foreignObject><rect width="10" height="10" onclick="bad()"/><use href="https://example.org/external.svg"/></svg>';
  const result = collect().find(item => item.url.startsWith('data:'))!;
  const xml = decodeURIComponent(result.url.split(',')[1]!);
  expect(xml).toContain('viewBox'); expect(xml).not.toMatch(/script|onload|onclick|foreignObject|external/);
  expect(thumbnailUrl(result)).toBe(result.url); expect(imageFormat(result.url)).toBe('SVG');
  expect(requiredOrigins([result.url])).toEqual([]);
});
it('parses imported HTML inertly with explicit base and never uses the extension origin', () => {
  const page = collectPage({}, { html: '<base href="https://cdn.example.org/a/"><title>Archive</title><img src="pic.jpg"><script>window.bad=1</script><iframe src="https://other.example.org"></iframe>', title: 'file.html', url: 'https://example.org/' });
  expect(page.title).toBe('Archive'); expect(page.baseUrl).toBe('https://cdn.example.org/a/');
  expect(resolveImages(page)[0]?.url).toBe('https://cdn.example.org/a/pic.jpg');
  expect(document.querySelector('iframe')).toBeNull(); expect((window as unknown as { bad?: number }).bad).toBeUndefined();
});
it('only trusts page-specific original selectors on the exact supported domain', () => {
  const html = '<span class="jpg" data-src="/original.jpg"></span>';
  const good = collectPage({}, { html, url: 'https://www.eroticbeauties.net/a', title: '' });
  expect(resolveImages(good)[0]?.candidate).toBe(true);
  expect(collectPage({}, { html, url: 'https://www.eroticbeauties.net.evil.test/a', title: '' }).images).toHaveLength(0);
});
it('generates both explicit chpic backgrounds without undefined parameters', () => {
  const result = planImageAddresses(['https://data.chpic.su/_data/stickers/a/album/album_01.webp']);
  expect(result.filter(item => item.large)).toHaveLength(2);
  expect(result[0]?.url).toContain('bg=transparent'); expect(result[1]?.url).toContain('bg=white');
  expect(JSON.stringify(result)).not.toContain('undefined');
});
it('limits filename variants to pathname, leaving signatures untouched', () => {
  const result = planImageAddresses(['https://example.org/a_webp.jpg?key=_webp']);
  expect(result[0]?.url).toBe('https://example.org/a.jpg?key=_webp');
});
it('applies page thumbnail rules without rewriting signed query parameters', () => {
  const urls = ['https://cdn.example.org/tn_photo.jpg?token=tn_secret'];
  expect(planImageAddresses(urls, 2000, 'https://www.theasianpics.com/a')[0]).toMatchObject({ url: 'https://cdn.example.org/photo.jpg?token=tn_secret', large: true });
  expect(planImageAddresses(urls, 2000, 'https://theasianpics.com.evil.test/a')).toHaveLength(1);
});

it('rejects arbitrary data URLs while allowing bounded inline images', () => {
  document.body.innerHTML = '<img src="data:text/html,%3Cscript%3Ebad()%3C/script%3E">';
  expect(collect()).toEqual([]);
});
it('does not invent a host for local relative links without a base URL', () => {
  const page = collectPage({}, { html: '<img src="relative.jpg"><img src="https://example.org/absolute.jpg">', url: '', title: 'saved.html' });
  expect(resolveImages(page).map(item => item.url)).toEqual(['https://example.org/absolute.jpg']);
});

it('enforces the inline option on every parsed srcset candidate', () => {
  document.body.innerHTML = '<img src="https://example.org/a.png" srcset="https://example.org/a.png 1x, data:image/png;base64,iVBORw0KGgo= 2x">';
  expect(resolveImages(collectPage()).some(item => item.url.startsWith('data:'))).toBe(false);
  expect(resolveImages(collectPage({ inline: true })).some(item => item.url.startsWith('data:'))).toBe(true);
});

it('resolves a standalone absolute base without a supplied source URL, including anchor-only images', () => {
  const page = collectPage({}, { html: '<base href="https://cdn.example.org/gallery/"><base href="https://ignored.test/"><img src="one.jpg"><a href="two.png">two</a>', url: '', title: 'local' });
  expect(page.baseUrl).toBe('https://cdn.example.org/gallery/');
  expect(resolveImages(page).map(item => item.url)).toEqual(['https://cdn.example.org/gallery/one.jpg', 'https://cdn.example.org/gallery/two.png']);
});
it('resolves relative base against the supplied URL and ignores unsupported absolute bases', () => {
  expect(collectPage({}, { html: '<base href="../images/">', url: 'https://example.org/a/page.html', title: '' }).baseUrl).toBe('https://example.org/images/');
  for (const href of ['javascript:alert(1)', 'file:///private/', '/no-origin/']) {
    expect(resolveImages(collectPage({}, { html: `<base href="${href}"><img src="relative.jpg">`, url: '', title: '' }))).toEqual([]);
  }
});
it('classifies explicit unchanged rules as originals without promoting unknown sources', () => {
  document.body.innerHTML = '<img src="https://sun.userapi.com/gallery.jpg"><img src="https://unknown.test/gallery.jpg"><img src="https://sun.userapi.com/gallery.jpg">';
  const results = collect();
  expect(results.map(item => [item.url, item.candidate])).toEqual([['https://sun.userapi.com/gallery.jpg', true], ['https://unknown.test/gallery.jpg', false]]);
});
it('copies transitive symbols and gradients from sibling SVGs with cycle guards and sanitization', () => {
  document.body.innerHTML = `<svg style="display:none"><defs>
    <linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient>
    <symbol id="inner" viewBox="0 0 24 24"><path fill="url(#paint)" d="M0 0h24v24z"/><use href="#outer"/></symbol>
    <symbol id="outer" viewBox="0 0 24 24" onload="bad()"><script>bad()</script><use href="#inner"/></symbol>
    </defs></svg><svg viewBox="0 0 24 24"><use href="#outer"/></svg>`;
  const image = collectPage({ inline: true }).images.filter(item => item.source.startsWith('data:')).at(-1)!;
  const xml = decodeURIComponent(image.source.split(',')[1]!);
  const exported = new DOMParser().parseFromString(xml, 'image/svg+xml');
  for (const id of ['outer', 'inner', 'paint']) expect(exported.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
  expect(xml).toContain('stop-color="red"'); expect(xml).not.toMatch(/onload|script/);
});
it('bounds oversized SVG dependency exports instead of truncating XML', () => {
  document.body.innerHTML = `<svg><symbol id="huge"><path d="${'M0 0 '.repeat(30000)}"/></symbol></svg><svg><use href="#huge"/></svg>`;
  const capture = collectPage({ inline: true });
  expect(capture.truncated).toBe(true);
  expect(capture.images.every(item => item.source.length <= 131072)).toBe(true);
});

it('reports unique unresolved relative sources and clears the warning when a base is supplied', async () => {
  const { resolveImagesWithDiagnostics } = await import('../lib/resolve');
  const html = '<img src="a.jpg" data-src="a.jpg"><img srcset="b.jpg 1x, c.jpg 2x"><img src="https://example.org/d.jpg"><img src="javascript:alert(1)"><img src="data:text/html,bad">';
  const input = { html, url: '', title: 'saved.html' };
  const missing = resolveImagesWithDiagnostics(collectPage({}, input));
  expect(missing.unresolvedCount).toBe(3);
  expect(missing.results).toHaveLength(1);
  const fixed = resolveImagesWithDiagnostics(collectPage({}, { ...input, url: 'https://example.org/' }));
  expect(fixed.unresolvedCount).toBe(0);
  expect(fixed.results).toHaveLength(4);
});
