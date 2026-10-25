import { imageExtension, numberedImageName } from './outputNaming.js';

export function dispositionFilename(header: string): string {
  const parameters = new Map<string, string>();
  for (const match of header.matchAll(/(?:^|;)\s*(filename\*?)\s*=\s*("(?:\\.|[^"\\])*"|[^;]*)/gi)) {
    let value = match[2]!.trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\(.)/g, '$1');
    parameters.set(match[1]!.toLowerCase(), value);
  }
  const extended = parameters.get('filename*');
  if (extended) {
    const encoded = /^utf-8'[^']*'(.*)$/i.exec(extended);
    if (encoded) { try { return decodeURIComponent(encoded[1]!); } catch { /* fall back to filename */ } }
  }
  return parameters.get('filename') || '';
}

// Keep the allocated sequence/subfolder (including retries), but use chpic's
// real attachment name and explicit background variant. File bytes own the suffix.
export function responseImageName(allocated: string, address: string, header: string, format: string): string {
  const fallback = allocated.replace(/\.[^.]+$/, `.${imageExtension(format)}`);
  const url = new URL(address);
  if (url.hostname !== 'chpic.su' && !url.hostname.endsWith('.chpic.su')) return fallback;
  const attachment = dispositionFilename(header).split(/[\\/]/).pop()?.trim();
  const prefix = /^(.*\/)?(\d+)_/.exec(allocated);
  if (!attachment || !prefix) return fallback;
  const variant = url.searchParams.get('type');
  const name = attachment.includes('_-_') ? attachment.slice(attachment.indexOf('_-_') + 3) : attachment;
  if (!name || /^\.+$/.test(name)) return fallback;
  return (prefix[1] || '') + numberedImageName(Number(prefix[2]), format,
    (variant === 'transparent' || variant === 'white' ? variant + '_' : '') + name);
}
