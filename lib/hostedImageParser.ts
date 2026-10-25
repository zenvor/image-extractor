import { hostedImageHost, hostedOriginalUrl } from './hostedImageHosts';

/** Parse only detached, inert template content. No node is ever attached to a document. */
export function parseHostedOriginal(html: string, pageUrl: string): string {
  const host = hostedImageHost(pageUrl);
  if (!host || html.length > 2 * 1024 * 1024) return '';
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;
  if (root.querySelector('#challenge-form, #challenge-running, iframe[src*="challenges.cloudflare.com"]')
    || /^(just a moment|attention required|verify you are human)/i.test(root.querySelector('title')?.textContent?.trim() || '')) return '';
  for (const selector of host.selectors) {
    const candidates = new Set<string>();
    for (const node of root.querySelectorAll(selector)) {
      const raw = node.getAttribute(node.tagName === 'META' ? 'content' : node.tagName === 'A' ? 'href' : 'src') || '';
      const url = hostedOriginalUrl(pageUrl, raw);
      if (url) candidates.add(url);
    }
    // A broad fallback may not choose arbitrarily between an advertisement and the image.
    if (candidates.size === 1) return [...candidates][0]!;
  }
  return '';
}
