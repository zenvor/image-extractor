import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

// Sharp is a local development dependency; it is not bundled into the extension.
const mark = await readFile(new URL('../assets/logo-source.png', import.meta.url));
for (const size of [16, 32, 48, 128, 256]) {
  const inset = Math.max(1, Math.round(size * .04));
  await sharp(mark).trim().resize(size - inset * 2, size - inset * 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: inset, bottom: inset, left: inset, right: inset, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png()
    .toFile(new URL('../public/icons/' + (size === 256 ? 'mark' : size) + '.png', import.meta.url).pathname);
}
console.log('Generated extension icons and popup mark from the original logo artwork.');
