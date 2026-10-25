import { expect, it } from 'vitest';
import { thumbnailUrl, imageFilename } from '../components/ImageThumbnail';
import type { ImageResult } from '../lib/types';

const item: ImageResult = { id: '1', label: '海岸线', url: 'https://i02.imx.to/i/2026/05/24/6s70wg.jpg', source: 'https://t01.imx.to/t/2026/05/24/6s70wg.jpg', candidate: true, reason: '', width: 0, height: 0 };
it('previews a converted image from its page thumbnail without falling back to the original', () => {
  expect(thumbnailUrl(item)).toBe(item.source);
  expect(thumbnailUrl({ ...item, source: '' })).toBe('');
  expect(thumbnailUrl({ ...item, candidate: false, source: '' })).toBe(item.url);
});
it('rejects unsupported and credential-bearing preview URLs', () => {
  for (const source of ['javascript:alert(1)', 'data:text/html;base64,AA==', 'blob:https://example.org/id', 'https://user:pass@example.org/photo.jpg']) {
    expect(thumbnailUrl({ ...item, source })).toBe('');
  }
});
it('renders a readable filename and tolerates malformed URLs', () => {
  expect(imageFilename({ ...item, url: 'https://example.org/%E6%B5%B7.jpg?x=1' })).toBe('海.jpg');
  expect(imageFilename({ ...item, url: 'invalid URL' })).toBe('海岸线');
});
