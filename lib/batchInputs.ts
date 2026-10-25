export function parsePageUrls(text: string): string[] {
  const values = [...new Set(text.split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
  if (!values.length || values.length > 20) throw new Error('请填写 1–20 个网页地址，每行一个。');
  return [...new Set(values.map(value => {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('只支持不含账户密码的 HTTP / HTTPS 网页地址。');
    return url.href;
  }))];
}

export type HtmlFileOrder = 'selection' | 'name' | 'mtime-asc' | 'mtime-desc';
export function sortHtmlFiles<T extends { name: string; lastModified: number }>(files: T[], order: HtmlFileOrder): T[] {
  if (order === 'selection') return [...files];
  return [...files].sort((a, b) => order === 'name'
    ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    : order === 'mtime-asc' ? a.lastModified - b.lastModified : b.lastModified - a.lastModified);
}
