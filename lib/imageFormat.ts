// Read only a small header; network responses and full images remain streamed.
export function detectImageExtension(header: Uint8Array): string {
  const ascii = (start: number, end: number) => String.fromCharCode(...header.subarray(start, end));
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'jpg';
  if (header[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (/^GIF8[79]a$/.test(ascii(0, 6))) return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 64))) return 'avif';
  if (ascii(0, 2) === 'BM') return 'bmp';
  if (ascii(0, 4) === 'II*\0' || ascii(0, 4) === 'MM\0*') return 'tiff';
  if (header.length >= 4 && header[0] === 0 && header[1] === 0 && header[2] === 1 && header[3] === 0) return 'ico';
  const text = new TextDecoder().decode(header).replace(/^\uFEFF/, '').trimStart()
    .replace(/^<\?xml[^>]*>\s*/i, '').replace(/^(?:<!--[\s\S]*?-->\s*)+/, '');
  if (/^<svg(?:\s|>)/i.test(text)) return 'svg';
  throw new Error('返回内容不是支持的图像，可能是验证页或错误页面。');
}
