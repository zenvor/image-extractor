import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { originalCandidate } from '../lib/resolve';
import { archiveFilename, numberedImageName, allocateImageNames } from '../lib/outputNaming.js';
import { resolveOriginalImage } from '../lib/originalImageResolver.js';

it('preserves every migrated hosted resolver fixture', async () => {
  const goldens = JSON.parse(await readFile(new URL('./fixtures/hosted-original-goldens.json', import.meta.url), 'utf8')) as { input: string; output: string }[];
  for (const golden of goldens) {
    expect(originalCandidate(golden.input)).toBe(golden.output);
    expect(resolveOriginalImage(golden.input).url).toBe(golden.output);
  }
});
it('retains explicitly matched unchanged legacy originals', () => {
  expect(originalCandidate('https://sun.userapi.com/gallery.jpg')).toBe('https://sun.userapi.com/gallery.jpg');
});
it('keeps the original filename after three-digit numbering and safely grows at 1000', () => {
  expect(numberedImageName(1, 'jpeg', '6awtfx.jpeg')).toBe('001_6awtfx.jpeg');
  expect(numberedImageName(999, 'webp', 'forest.webp')).toBe('999_forest.webp');
  expect(numberedImageName(1000, 'png', 'coast.png')).toBe('1000_coast.png');
});
it('uses webpage titles and blocks filename traversal while retaining Chinese and spaces', () => {
  expect(archiveFilename('山与海 · 旅行影集')).toBe('山与海 · 旅行影集.zip');
  expect(archiveFilename('../CON:相册/第1册')).not.toMatch(/[\/\\:]/);
  expect(new TextEncoder().encode(archiveFilename('图'.repeat(500))).length).toBeLessThanOrEqual(255);
  expect(archiveFilename('')).toBe('images.zip');
});
it('keeps a single group at ZIP root and separates mixed groups in stable input order', () => {
  expect(allocateImageNames([{ kind: 'large', format: 'jpg' }, { kind: 'large', format: 'png' }])).toEqual(['001_image.jpeg', '002_image.png']);
  expect(allocateImageNames([{ kind: 'small', format: 'jpg' }, { kind: 'large', format: 'webp' }, { kind: 'large', format: 'jpg' }])).toEqual(['小图/001_image.jpeg', '大图/001_image.webp', '大图/002_image.jpeg']);
});
