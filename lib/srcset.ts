// Adapted from crawler-runner/lib/srcset.js; original project remains unchanged.
/**
 * 返回 srcset 中语法有效的 URL，保持输入顺序。
 * URL 内部的逗号属于 URL；仅尾部逗号或 descriptor 后的逗号分隔候选。
 * 函数自包含，可同时注入浏览器脚本使用。
 * 规则：https://html.spec.whatwg.org/multipage/images.html#parse-a-srcset-attribute
 */
export function parseSrcset(input: string): string[] {
  if (typeof input !== 'string') return []
  const urls: string[] = []
  const whitespace = (character: string | undefined) => character !== undefined && /[\t\n\f\r ]/.test(character)
  let position = 0
  while (position < input.length) {
    while (whitespace(input[position]) || input[position] === ',') position++
    const start = position
    while (position < input.length && !whitespace(input[position])) position++
    let url = input.slice(start, position)
    if (!url) break
    const descriptors = []
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '')
    } else {
      let descriptor = '', inParens = false
      while (position < input.length) {
        const character = input[position++]
        if (character === ',' && !inParens) break
        if (whitespace(character) && !inParens) {
          if (descriptor) { descriptors.push(descriptor); descriptor = '' }
        } else {
          descriptor += character
          if (character === '(') inParens = true
          else if (character === ')') inParens = false
        }
      }
      if (descriptor) descriptors.push(descriptor)
    }
    let width: number | undefined, density: number | undefined, height: number | undefined, valid = true
    for (const descriptor of descriptors) {
      if (/^\d+w$/.test(descriptor)) {
        const value = Number(descriptor.slice(0, -1))
        if (width !== undefined || density !== undefined || !Number.isFinite(value) || value <= 0) valid = false
        width = value
      } else if (/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?x$/i.test(descriptor)) {
        const value = Number(descriptor.slice(0, -1))
        if (width !== undefined || density !== undefined || height !== undefined || !Number.isFinite(value) || value < 0) valid = false
        density = value
      } else if (/^\d+h$/.test(descriptor)) {
        const value = Number(descriptor.slice(0, -1))
        if (height !== undefined || density !== undefined || !Number.isFinite(value) || value <= 0) valid = false
        height = value
      } else valid = false
    }
    if (height !== undefined && width === undefined) valid = false
    if (url && valid) urls.push(url)
  }
  return urls
}
