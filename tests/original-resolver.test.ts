import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { resolveOriginalImage } from '../lib/originalImageResolver.js';
import { originalCandidate, resolveImages } from '../lib/resolve';
import { filterImageResults } from '../lib/selection';

it('preserves the migrated legacy rules including unchanged originals', async () => {
  const fixtures = JSON.parse(await readFile(new URL('./fixtures/legacy-original-goldens.json', import.meta.url), 'utf8')) as { input: string; output: string }[];
  for (const { input, output } of fixtures) {
    expect(resolveOriginalImage(input, { type: 'transparent' }).url).toBe(output);
  }
});

it.each([
  'https://evil.test/imx.to/t/a.jpg',
  'https://evil.test/t/a.jpg?reference=imx.to',
  'https://imx.to.evil.test/t/a.jpg',
  'https://image.imx.to.evil.test/u/t/a.jpg',
  'https://imx.to/original.jpg?reference=/t/a.jpg',
])('does not mistake host/path lookalikes for an original: %s', url => {
  expect(resolveOriginalImage(url)).toMatchObject({ status: 'no_match', url: null });
});

it.each([
  'https://image.imx.to/u/t/2026/05/24/6s79sr.jpg',
  'https://t01.imx.to/t/2026/05/24/6s79sr.jpg',
])('preserves IMX aliases and query/fragment data: %s', url => {
  const suffix = '?token=a%2Fb&next=/t/x#preview';
  expect(resolveOriginalImage(url + suffix)).toMatchObject({
    status: 'resolved', url: 'https://i02.imx.to/i/2026/05/24/6s79sr.jpg' + suffix,
  });
});

const duitangOriginal = 'https://a-ho-img.dtstatic.com/uploads/blog/202608/13/9WSaW9Pjt8jJPZV.jpg';
it.each([400, 1000])('restores a real Duitang %i-pixel preview without changing its CDN', width => {
  expect(resolveOriginalImage(`${duitangOriginal}?x-image-process=image/resize,m_fixed,w_${width}/ignore-error,1`)).toMatchObject({
    status: 'resolved', resolver: 'duitang-blog-image', url: duitangOriginal,
  });
});

it('removes only Duitang processing parameters, preserving other raw query values and fragments', () => {
  const input = `${duitangOriginal}?token=a%2fb&x-image-process=image%2Fresize%2Cw_400&next=%2Fblog%2Fa%20b&x-image-process=image/resize,w_100#preview`;
  expect(resolveOriginalImage(input).url).toBe(`${duitangOriginal}?token=a%2fb&next=%2Fblog%2Fa%20b#preview`);
});

it('recognizes an already original Duitang blog image and deduplicates its previews in original mode', () => {
  expect(originalCandidate(duitangOriginal)).toBe(duitangOriginal);
  const results = resolveImages({ url: 'https://www.duitang.com/category/?cat=wallpaper', baseUrl: 'https://www.duitang.com/', title: '壁纸', total: 2, truncated: false, challenged: false,
    images: [400, 1000].map(width => ({ source: `${duitangOriginal}?x-image-process=image/resize,m_fixed,w_${width}/ignore-error,1`, sources: [], declared: [], srcsets: [], link: '', alt: '壁纸', width, height: 0 })) });
  expect(filterImageResults(results, 'large', '').map(item => item.url)).toEqual([duitangOriginal]);
  expect(filterImageResults(results, 'page', '')).toHaveLength(2);
});

it('keeps the legacy Duitang thumbnail on its existing CDN', () => {
  expect(resolveOriginalImage('https://c-ssl.dtstatic.com/uploads/blog/a.thumb.400_0.jpg?x-image-process=image/resize,w_400&token=ok').url)
    .toBe('https://c-ssl.dtstatic.com/uploads/blog/a.jpg?token=ok');
});

it.each([
  'https://a-ho-img.dtstatic.com.evil.test/uploads/blog/a.jpg?x-image-process=image/resize,w_400',
  'https://evil.test/uploads/blog/a.jpg?host=a-ho-img.dtstatic.com',
  'https://a-ho-img.dtstatic.com/uploads/avatar/a.png?x-image-process=image/resize,w_100',
  'https://www.duitang.com/blog/?id=1575825321',
  'https://a-ho-img.dtstatic.com/uploads/blog/a.html?x-image-process=image/resize,w_400',
])('does not classify non-blog images or lookalikes as Duitang originals: %s', url => {
  expect(resolveOriginalImage(url)).toMatchObject({ status: 'no_match', url: null });
});
