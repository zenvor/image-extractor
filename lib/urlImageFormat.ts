// Format badges describe the URL suffix, without fetching or probing the image.
export const imageFormats = ['JPG', 'PNG', 'SVG', 'WEBP', 'GIF', 'AVIF', 'ICO', 'BMP', 'TIFF', 'IMG'] as const;
export type ImageFormat = typeof imageFormats[number];

export function imageFormat(url: string): ImageFormat {
  const mime = /^data:image\/([^;,]+)/i.exec(url)?.[1]?.toUpperCase();
  if (mime) return ({ JPEG: 'JPG', 'SVG+XML': 'SVG', 'X-ICON': 'ICO', 'VND.MICROSOFT.ICON': 'ICO' } as Record<string, ImageFormat>)[mime] || (imageFormats.includes(mime as ImageFormat) ? mime as ImageFormat : 'IMG');
  try {
    const filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    const extension = filename.includes('.') ? filename.split('.').pop()!.toUpperCase() : '';
    const normalized = extension === 'JPEG' ? 'JPG' : extension === 'TIF' ? 'TIFF' : extension;
    return imageFormats.includes(normalized as ImageFormat) ? normalized as ImageFormat : 'IMG';
  } catch { return 'IMG'; }
}
