// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { collectPage } from '../lib/collect';
import { httpUrl, originalCandidate, resolveImages } from '../lib/resolve';
import { parseSrcset } from '../lib/srcset';

beforeEach(() => { document.head.querySelector('base')?.remove(); document.body.innerHTML = ''; document.title = 'Public landscape gallery'; });

describe('URL and original candidate boundaries', () => {
  it('resolves relative addresses and preserves signed query strings', () => {
    expect(httpUrl('../full.jpg?token=abc', 'https://example.org/album/')).toBe('https://example.org/full.jpg?token=abc');
  });
  it('rejects script, data, blob and credential-bearing URLs', () => {
    for (const url of ['javascript:alert(1)', 'data:image/png;base64,aaa', 'blob:https://example.org/a', 'https://user:pass@example.org/a']) expect(httpUrl(url, 'https://example.org')).toBe('');
  });
  it('only applies the exact imgbox hostname and suffix rule', () => {
    expect(originalCandidate('https://thumbs2.imgbox.com/aa/bb/forest_t.jpg?token=x')).toBe('https://images2.imgbox.com/aa/bb/forest_o.jpg?token=x');
    expect(originalCandidate('https://thumbs2.imgbox.com.evil.org/forest_t.jpg')).toBe('');
    expect(originalCandidate('https://example.org/forest-300x200.jpg')).toBe('');
  });
  it('parses srcset without splitting commas inside URLs and rejects invalid descriptors', () => {
    expect(parseSrcset('https://example.org/a,b.jpg 2x, c.jpg 640w, bad.jpg 1w 2x')).toEqual(['https://example.org/a,b.jpg', 'c.jpg']);
  });
  it('maps the known imx thumbnail host and preserves query and fragment', () => {
    expect(originalCandidate('https://t01.imx.to/t/2026/05/24/landscape.jpg?token=a%2Fb&next=/t/x#preview'))
      .toBe('https://i02.imx.to/i/2026/05/24/landscape.jpg?token=a%2Fb&next=/t/x#preview');
  });
  it('maps the confirmed image.imx.to /u/t/ alias to i02 /i/', () => {
    expect(originalCandidate('https://image.imx.to/u/t/2026/09/26/765kix.jpg?token=a%2Fb&next=/u/t/x#preview'))
      .toBe('https://i02.imx.to/i/2026/09/26/765kix.jpg?token=a%2Fb&next=/u/t/x#preview');
  });
  it.each([
    'https://t01.imx.to.evil.org/t/2026/05/24/landscape.jpg',
    'https://t01.imx.to/i/2026/05/24/landscape.jpg',
    'https://example.org/t/landscape.jpg?next=https://t01.imx.to/t/a.jpg',
    'https://image.imx.to.evil.org/u/t/landscape.jpg',
    'https://image.imx.to/u/i/landscape.jpg',
  ])('does not infer imx host mappings outside the confirmed rule: %s', source => {
    expect(originalCandidate(source)).toBe('');
  });
});

describe('loaded DOM analysis', () => {
  it('collects declared URLs, picture sources and direct image links without network calls', () => {
    document.body.innerHTML = '<a href="https://example.org/full.jpg"><picture><source srcset="https://example.org/large.jpg 1200w"><img src="https://example.org/small.jpg" data-original="https://example.org/full.jpg" alt="Mountain"></picture></a>';
    const page = { ...collectPage(), url: 'https://example.org/gallery' };
    const results = resolveImages(page);
    expect(results.map(item => item.url)).toEqual(['https://example.org/full.jpg', 'https://example.org/large.jpg', 'https://example.org/small.jpg']);
    expect(results.every(item => !item.candidate)).toBe(true);
  });
  it('does not fabricate originals or export viewer-page anchors', () => {
    document.body.innerHTML = '<a href="/view/123"><img src="/thumb-200.jpg"></a>';
    const results = resolveImages({ ...collectPage(), url: 'https://example.org/gallery' });
    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe('https://example.org/thumb-200.jpg');
    expect(results[0]?.candidate).toBe(false);
  });
  it.each([['https://t01.imx.to/t/2026/05/24/landscape.jpg', 'https://i02.imx.to/i/2026/05/24/landscape.jpg'], ['https://image.imx.to/u/t/2026/09/26/765kix.jpg', 'https://i02.imx.to/i/2026/09/26/765kix.jpg']])('marks imx-derived addresses as candidates with the correct rule provenance: %s', (source, original) => {
    document.body.innerHTML = `<img src="${source}" alt="Landscape">`;
    const results = resolveImages(collectPage());
    expect(results[0]).toMatchObject({ url: original, candidate: true, reason: '大图 · imx 规则' });
    expect(results[1]).toMatchObject({ url: source, candidate: false });
  });
  it('does not classify an unmatched URL as large just because it is declared', () => {
    document.body.innerHTML = '<img src="/full.jpg"><img src="/small.jpg" data-full="/full.jpg">';
    const results = resolveImages({ ...collectPage(), url: 'https://example.org/' });
    expect(results).toHaveLength(2);
    expect(results.every(item => !item.candidate)).toBe(true);
  });
  it('applies conversion rules to every collected URL, regardless of its attribute', () => {
    document.body.innerHTML = '<a href="https://t01.imx.to/t/link.jpg"><img src="/small.jpg" data-original="https://t01.imx.to/t/declared.jpg" srcset="https://image.imx.to/u/t/srcset.jpg 2x"></a>';
    const results = resolveImages(collectPage());
    expect(results.filter(item => item.candidate).map(item => item.url)).toEqual([
      'https://i02.imx.to/i/declared.jpg', 'https://i02.imx.to/i/link.jpg', 'https://i02.imx.to/i/srcset.jpg',
    ]);
    expect(results.filter(item => !item.candidate)).toHaveLength(4);
  });
  it('keeps a rule output large when the same URL also appears as a page source', () => {
    document.body.innerHTML = '<img src="https://i02.imx.to/i/forest.jpg"><img src="https://t01.imx.to/t/forest.jpg">';
    const results = resolveImages(collectPage());
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ url: 'https://i02.imx.to/i/forest.jpg', candidate: true, reason: '大图 · imx 规则' });
  });
  it('converts lazy image URLs even when src contains an unmatched placeholder', () => {
    document.body.innerHTML = '<img src="/placeholder.jpg" data-src="https://t01.imx.to/t/lazy.jpg">';
    const results = resolveImages(collectPage());
    expect(results.filter(item => item.candidate)).toMatchObject([{ url: 'https://i02.imx.to/i/lazy.jpg' }]);
    expect(results.filter(item => !item.candidate)).toHaveLength(2);
  });
  it('detects challenge pages instead of reporting their decorative images as results', () => {
    document.title = 'Just a moment...';
    expect(collectPage().challenged).toBe(true);
  });
  it('caps loaded image scanning and reports truncation', () => {
    document.body.innerHTML = '<img src="/forest.jpg">'.repeat(2001);
    const capture = collectPage();
    expect(capture.total).toBe(2001);
    expect(capture.images).toHaveLength(2000);
    expect(capture.truncated).toBe(true);
  });
  it('handles empty pages', () => {
    expect(resolveImages({ ...collectPage(), url: 'https://example.org/' })).toEqual([]);
  });
  it('supports a thousand thumbnail/original pairs without network work', () => {
    document.body.innerHTML = Array.from({ length: 1000 }, (_, i) => `<img src="https://t01.imx.to/t/2026/05/24/image-${i}.jpg">`).join('');
    const capture = collectPage();
    const results = resolveImages(capture);
    expect(capture.truncated).toBe(false);
    expect(results.filter(item => item.candidate)).toHaveLength(1000);
    expect(results.filter(item => !item.candidate)).toHaveLength(1000);
  });
  it('respects document baseURI for declared relative image links', () => {
    const base = document.createElement('base');
    base.href = 'https://images.example.org/album/';
    document.head.append(base);
    document.body.innerHTML = '<img src="small.jpg" data-full="large.jpg">';
    // Model an unloaded img: happy-dom's synthetic currentSrc ignores <base>.
    Object.defineProperty(document.querySelector('img'), 'currentSrc', { value: '' });
    const results = resolveImages(collectPage());
    expect(results.map(item => item.url)).toEqual(['https://images.example.org/album/large.jpg', 'https://images.example.org/album/small.jpg']);
  });
  it('skips overly long addresses instead of truncating them into a different URL', () => {
    document.body.innerHTML = `<img src="https://example.org/a.jpg?token=${'x'.repeat(2100)}">`;
    expect(resolveImages(collectPage())).toEqual([]);
  });
});
