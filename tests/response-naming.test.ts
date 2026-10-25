import { expect, it } from 'vitest';
import { dispositionFilename, responseImageName } from '../lib/responseNaming';
it('decodes attachment filenames, preferring valid UTF-8 filename*', () => {
  expect(dispositionFilename(`attachment; filename="fallback.png"; filename*=UTF-8''%E5%B1%B1%E6%B5%B7.png`)).toBe('山海.png');
  expect(dispositionFilename(`attachment; filename="hello; world.png"`)).toBe('hello; world.png');
  expect(dispositionFilename(`attachment; filename*=UTF-8''bad%zz; filename="ok.png"`)).toBe('ok.png');
});
it('retains sequence, group and variant while respecting actual file format', () => {
  expect(responseImageName('大图/017_f=webp_c=png_bg=white.bin', 'https://chpic.su/save2/a?type=white', 'attachment; filename="pack_-_flower.png"', 'jpeg')).toBe('大图/017_white_flower.jpeg');
  expect(responseImageName('002_image.bin', 'https://chpic.su/a?type=transparent', 'attachment; filename="flower.png"', 'png')).toBe('002_transparent_flower.png');
});
it('does not apply chpic naming to lookalike hosts and never emits header paths', () => {
  expect(responseImageName('001_original.bin', 'https://chpic.su.evil.test/a', 'attachment; filename="wrong.png"', 'png')).toBe('001_original.png');
  expect(responseImageName('004_original.bin', 'https://chpic.su/a', 'attachment; filename="../../photo.png"', 'png')).toBe('004_photo.png');
  expect(responseImageName('001_original.bin', 'https://chpic.su/a', '', 'png')).toBe('001_original.png');
});
