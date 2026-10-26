import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';

// Sharp is a local development dependency; it is not bundled into the extension.
const mark = await readFile(new URL('../assets/logo-source.svg', import.meta.url));
await writeFile(new URL('../public/icons/mark.svg', import.meta.url), mark);
for (const size of [16, 32, 48, 128, 256]) {
  const inset = Math.max(1, Math.round(size * .04));
  await sharp(mark, { density: 192 }).trim().resize(size - inset * 2, size - inset * 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: inset, bottom: inset, left: inset, right: inset, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png()
    .toFile(new URL('../public/icons/' + (size === 256 ? 'mark' : size) + '.png', import.meta.url).pathname);
}
const promo = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">
  <title>Image Extractor</title>
  <rect width="440" height="280" fill="#f4f4f5"/>
  ${mark.toString().replace('<svg ', '<svg x="145" y="35" ').replace('width="1254" height="1254"', 'width="150" height="150"')}
  <text x="220" y="225" text-anchor="middle" fill="#27272a" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700">Image Extractor</text>
</svg>`;
await writeFile(new URL('../docs/store-assets/promo-440x280.svg', import.meta.url), promo);
await sharp(Buffer.from(promo)).png().toFile(new URL('../docs/store-assets/promo-440x280.png', import.meta.url).pathname);
console.log('Generated SVG mark, PNG icons and promotional artwork from assets/logo-source.svg.');
