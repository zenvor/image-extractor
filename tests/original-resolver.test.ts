import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { resolveOriginalImage } from '../lib/originalImageResolver.js';

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
