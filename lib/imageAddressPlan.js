import { resolveOriginalImage } from './originalImageResolver.js'

/** No network: stable URL deduplication, converted outputs first, large classification wins. */
export function planImageAddresses(addresses, limit = Infinity, pageUrl = '') {
  const result = [], seen = new Map(), processed = new Set()
  function add(url, source, large, resolver) {
    const existing = seen.get(url)
    if (existing) {
      if (large && !existing.large) { existing.large = true; existing.resolver = resolver }
      return
    }
    if (result.length >= limit) return
    const entry = { url, source, large, resolver }
    result.push(entry); seen.set(url, entry)
  }
  for (const address of addresses) {
    if (/^data:image\//i.test(address) && address.length <= 131072) { add(address, address, false, null); continue }
    let url
    try { url = new URL(address) } catch { continue }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || processed.has(url.href)) continue
    processed.add(url.href)
    const types = /(^|\.)chpic\.su$/.test(url.hostname) ? ['transparent', 'white'] : ['transparent']
    for (const type of types) {
      const resolved = resolveOriginalImage(url.href, { type })
      if ((resolved.status === 'resolved' || resolved.status === 'unchanged' && resolved.resolver === 'legacy-compatible-rule') && resolved.url) add(resolved.url, url.href, true, resolved.resolver)
    }
    // Compatibility variant is path-only: never rewrite signatures or hostnames.
    if (url.pathname.includes('_webp')) {
      const variant = new URL(url); variant.pathname = variant.pathname.replaceAll('_webp', '')
      add(variant.href, url.href, false, null)
    }
    let hostname = ''; try { hostname = new URL(pageUrl).hostname } catch {}
    if (pageThumbnailSites.some(domain => hostname === domain || hostname.endsWith('.' + domain) || (!domain.includes('.') && hostname.split('.').at(-2) === domain)) && url.pathname.includes('tn_')) {
      const original = new URL(url); original.pathname = original.pathname.replace('tn_', '')
      add(original.href, url.href, true, 'page-thumbnail-rule')
    }
    add(url.href, url.href, false, null)
  }
  return result
}

const pageThumbnailSites = [
  'theasianpics', 'asiansexphotos', 'asianmatureporn', 'asianamateurgirls',
  'hotasianamateurs', 'amateurchinesepics', 'asiannudistpictures', 'filipinahotties',
  'chinesesexphotos', 'japaneseteenpics', 'hotnudefilipinas', 'asianteenpictures',
  'asianteenphotos', 'chineseteenpics', 'cuteasians', 'amateurasianpictures',
  'chinesexxxpics', 'sexyasians', 'allasiansphotos', 'chinese-girlfriends',
  'chinesegirlspictures', 'chinese-sex.xyz', 'asian-cuties-online', 'japaneseamateurpics',
  'asiangalleries', 'filipinapornpictures', 'japanesenudities', 'koreanpornpics',
  'filipinanudes', 'chinesepornpics', 'asianamatures', 'nudehotasians',
  'asianpornpictures', 'orientgirlspictures'
];
