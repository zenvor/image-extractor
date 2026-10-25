import { convertLegacyThumbnailToOriginalUrl } from './legacyOriginalRules.js'

export const ORIGINAL_RESOLVER_VERSION = 'host-path-originals-v7'
const duitangThumbnailSuffix = /\.thumb\.\d+_\d+(?=\.[a-z0-9]+$)/i
function restoreDuitangImage(url) {
  url.pathname = url.pathname.replace(duitangThumbnailSuffix, '')
  // Keep unrelated query bytes intact, including signed values and their order.
  url.search = url.search.slice(1).split('&').filter(part => !new URLSearchParams(part).has('x-image-process')).join('&')
}
const hostedRules = [
  { id: 'duitang-blog-image', host: 'dtstatic.com', match: url => url.pathname.startsWith('/uploads/blog/') && /\.(?:avif|jpe?g|png|webp|gif)$/i.test(url.pathname), convert: restoreDuitangImage },
  { id: 'duitang-legacy-thumbnail', host: 'dtstatic.com', match: url => url.hostname === 'c-ssl.dtstatic.com' && duitangThumbnailSuffix.test(url.pathname), convert: restoreDuitangImage },
  { id: 'imx-image-thumbnail', host: 'imx.to', match: url => url.hostname === 'image.imx.to' && url.pathname.startsWith('/u/t/') && /\.(?:avif|jpe?g|png|webp|gif)$/i.test(url.pathname), convert: url => { url.hostname = 'i02.imx.to'; url.pathname = url.pathname.replace(/^\/u\/t\//, '/i/') } },
  { id: 'imx-t01-thumbnail', host: 'imx.to', match: url => url.hostname === 't01.imx.to' && url.pathname.startsWith('/t/') && /\.(?:avif|jpe?g|png|webp|gif)$/i.test(url.pathname), convert: url => { url.hostname = 'i02.imx.to'; url.pathname = url.pathname.replace(/^\/t\//, '/i/') } },
  { id: 'imx-thumbnail', host: 'imx.to', match: url => url.pathname.includes('/t/'), convert: url => { url.pathname = url.pathname.replace('/t/', '/i/') } },
  { id: 'imx-upload-small', host: 'imx.to', match: url => url.pathname.startsWith('/upload/small/'), convert: url => { url.hostname = 'i001.imx.to'; url.pathname = url.pathname.replace('/upload/small/', '/i/') } },
  { id: 'vipr-thumbnail', host: 'vipr.im', match: url => url.pathname.includes('/th/'), convert: url => { url.pathname = url.pathname.replace('/th/', '/i/') } },
  { id: 'imgbox-thumbnail', host: 'imgbox.com', match: url => url.hostname === 'thumbs2.imgbox.com' && /_t(?=\.[^/]+$)/.test(url.pathname), convert: url => { url.hostname = 'images2.imgbox.com'; url.pathname = url.pathname.replace(/_t(?=\.[^/]+$)/, '_o') } },
  { id: 'imagetwist-thumbnail', host: 'imagetwist.com', match: url => url.hostname === 'img119.imagetwist.com' && url.pathname.startsWith('/th/'), convert: url => { url.pathname = url.pathname.replace('/th/', '/i/') } },
  { id: 'pixhost-thumbnail', host: 'pixhost.to', match: url => /^t\d*\.pixhost\.to$/.test(url.hostname) && url.pathname.startsWith('/thumbs/'), convert: url => { url.hostname = url.hostname.replace(/^t/, 'img'); url.pathname = url.pathname.replace('/thumbs/', '/images/') } }
]
export function hostnameMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}
// 未迁移规则保留实现和顺序，先封住主机伪匹配；不宣称旧规则已逐项验证网站行为。
const legacyHosts = ['i.pximg.net', 'static-ca-cdn.eporner.com', 'userapi.com', 'cdn.pichunter.com', 'cdn.elitebabes.com', 'cdn.femjoyhunter.com', 'cdn.pmatehunter.com', 'i.girlsfordays.com', 'images.sexynude.pics', 'cdn.cherrynudes.com', 'thefapspot.com', 'cdni.sexynakedgirls.pics', 'cdn.erocurves.com', 'cdn.perfectnaked.com', 'www.ametart.com', 'cdn.metarthunter.com', 'data-cdn.multi.xnxx.com', 'erohd.club', 'chpic.su', 'x3vid.com', 'cdni.pornpics.com', 'asiantgp.net', 'www.sigmapic.com', 'bravoerotica.com']

/** 纯 URL 解析器。无网络、文件、SQLite、浏览器或候选顺序变更。 */
export function resolveOriginalImage(candidate, { type, fallbackUnchanged = false } = {}) {
  const input = typeof candidate === 'string' ? { url: candidate } : candidate
  const base = { candidateId: input.id ?? null, contextRef: input.contextRef ?? null, resolver: null, version: ORIGINAL_RESOLVER_VERSION }
  const noMatch = reason => fallbackUnchanged
    ? { ...base, status: 'unchanged', url: input.url, resolver: 'compatibility-fallback', evidence: { reason, resolvedOriginal: false } }
    : { ...base, status: 'no_match', url: null, evidence: { reason } }
  let parsed
  try { parsed = new URL(input.url) } catch { return noMatch('invalid_url') }
  if (!['http:', 'https:'].includes(parsed.protocol)) return noMatch('unsupported_protocol')
  const group = hostedRules.filter(rule => hostnameMatches(parsed.hostname, rule.host))
  const rule = group.find(rule => rule.match(parsed))
  if (rule) {
    const output = new URL(parsed); rule.convert(output)
    return { ...base, status: 'resolved', url: output.href, resolver: rule.id, evidence: { inputPath: parsed.pathname, outputPath: output.pathname, matchedHostname: parsed.hostname } }
  }
  if (group.length) return noMatch('unsupported_path')
  if (!legacyHosts.some(host => hostnameMatches(parsed.hostname, host))) return noMatch('unsupported_hostname')
  const output = convertLegacyThumbnailToOriginalUrl(input.url, type)
  if (!output) return noMatch('legacy_rule_not_matched')
  return { ...base, status: output === input.url ? 'unchanged' : 'resolved', url: output, resolver: 'legacy-compatible-rule', evidence: { matchedHostname: parsed.hostname, legacy: true, resolvedOriginal: output !== input.url } }
}
