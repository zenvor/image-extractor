import { expect, it } from 'vitest';
import { imageFormat } from '../lib/urlImageFormat';

it('normalizes URL extensions without mistaking the query or fragment for the format', () => {
  expect(imageFormat('https://images.example/photo.JPEG?next=icon.png')).toBe('JPG');
  expect(imageFormat('https://images.example/%E5%9B%BE%E7%89%87.PNG#download.svg')).toBe('PNG');
  expect(imageFormat('https://images.example/photo.tif')).toBe('TIFF');
  expect(imageFormat('https://images.example/icon.SVG')).toBe('SVG');
  expect(imageFormat('https://images.example/favicon.ico')).toBe('ICO');
});
it('keeps unrecognized and invalid URLs neutral', () => {
  expect(imageFormat('https://images.example/photo?format=jpeg')).toBe('IMG');
  expect(imageFormat('https://images.example/file.pdf')).toBe('IMG');
  expect(imageFormat('not a URL.png')).toBe('IMG');
  expect(imageFormat('https://images.example/%invalid.png')).toBe('IMG');
});
