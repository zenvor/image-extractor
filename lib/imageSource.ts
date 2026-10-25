// Inline image limits mirror the injected collector and keep session storage bounded.
export function isInlineImage(value: string): boolean {
  return value.length <= 131072 && /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|tiff|x-icon|vnd.microsoft.icon|svg\+xml)[;,]/i.test(value);
}
export function imageUrl(value: string, base: string): string {
  if (isInlineImage(value)) return value;
  if (!value || value.length > 2048) return '';
  try {
    const url = new URL(value, base || undefined);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
