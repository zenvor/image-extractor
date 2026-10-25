// Extension-local output contract: three-digit sequence plus original basename.
// Filename sanitization is retained from the previously bundled implementation.
// Windows 设备名（不区分大小写）
const RESERVED_FILENAMES = new Set([
  'CON','PRN','AUX','NUL',
  'COM1','COM2','COM3','COM4','COM5','COM6','COM7','COM8','COM9',
  'LPT1','LPT2','LPT3','LPT4','LPT5','LPT6','LPT7','LPT8','LPT9',
])

// 非法字符模式
const INVALID_WINDOWS = /[\\/:*?"<>|]/g        // 同时包含 / 和 :
const INVALID_MAC = /[:/]/g                    // macOS/Finder 禁用 ":"；POSIX 分隔符 "/"
const CONTROL_CHARS = /[\x00-\x1F]/g;          // 控制字符，跨平台都不安全

/**
 * 跨平台清理文件名（Windows / macOS / universal）。
 *
 * @param {string} fileName
 * @param {{ platform?: 'windows'|'mac'|'universal', normalize?: boolean, maxLength?: number }} [options]
 * @returns {string}
 */
function sanitizeFileName(fileName, options) {
  const opts = options || {}
  const platform = opts.platform || 'universal'     // 'windows' | 'mac' | 'universal'
  const doNormalize = opts.normalize !== false      // 默认执行 NFC 规范化
  const MAX_LEN = typeof opts.maxLength === 'number' ? opts.maxLength : 255

  if (typeof fileName !== 'string' || fileName.length === 0) return ''

  // 统一做 Unicode 规范化，避免组合字符导致的奇异情况
  let input = doNormalize && String.prototype.normalize
    ? fileName.normalize('NFC')
    : fileName

  // 先去除控制字符
  input = input.replace(CONTROL_CHARS, '_')

  // 选择平台对应的非法字符集合
  let invalidRegex
  switch (platform) {
    case 'windows':
      invalidRegex = INVALID_WINDOWS
      break
    case 'mac':
      invalidRegex = INVALID_MAC
      break
    default: // 'universal'：取并集，直接用 Windows 集合即可覆盖 mac 的 ":" 与 "/"
      invalidRegex = INVALID_WINDOWS
  }

  // 1) 替换非法字符
  let sanitized = input.replace(invalidRegex, '_')

  // 2) 拆分主名与扩展名（保留最后一个点后的部分）
  const lastDot = sanitized.lastIndexOf('.')
  let base = lastDot === -1 ? sanitized : sanitized.slice(0, lastDot)
  const ext = lastDot === -1 ? '' : sanitized.slice(lastDot)

  // 3) 去除主名尾部空格与句点（Windows 要求；在 mac 上也安全）
  base = base.replace(/[ .]+$/, '')

  // 4) 主名为空兜底
  if (!base) base = '_'

  // 5) 处理 Windows 保留名（universal 也规避，确保跨平台移动安全）
  if (platform === 'windows' || platform === 'universal') {
    if (RESERVED_FILENAMES.has(base.toUpperCase())) {
      base = `_${base}`
    }
  }

  // 6) 长度限制（按字符数截断）
  const available = Math.max(0, MAX_LEN - ext.length)
  if (base.length > available) base = base.slice(0, available)

  return base + ext
}

export const MAX_ARCHIVE_IMAGES = 2000;
const extensions = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'svg', 'bmp', 'ico', 'tiff', 'bin']);
const mimeExtensions = {
  'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'image/bmp': 'bmp', 'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico', 'image/tiff': 'tiff',
};

export function imageExtension(value = '', mime = '') {
  const fromMime = mimeExtensions[mime.split(';')[0].trim().toLowerCase()];
  if (fromMime) return fromMime;
  let path = value;
  try { path = new URL(value).pathname; } catch {}
  let extension = path.toLowerCase().split('.').pop();
  if (extension === 'jpg') extension = 'jpeg';
  if (extension === 'tif') extension = 'tiff';
  return extensions.has(extension) ? extension : 'bin';
}

function truncateUtf8(value, maxBytes) {
  let result = '', bytes = 0;
  for (const character of value) {
    const size = new TextEncoder().encode(character).length;
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function imageStem(value) {
  let name = typeof value === 'string' ? value : '';
  if (name.startsWith('data:')) return 'image';
  try { name = new URL(name).pathname; } catch {}
  try { name = decodeURIComponent(name); } catch {}
  name = name.normalize('NFC').split(/[\/\\]/).pop() || '';
  const dot = name.lastIndexOf('.');
  if (dot > 0) name = name.slice(0, dot);
  name = name.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').trim().replace(/[. ]+$/, '');
  return name && !/^\.+$/.test(name) ? name : 'image';
}

export function numberedImageName(sequence, extension = 'jpeg', basename = 'image') {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw Error('Invalid image sequence');
  const prefix = `${String(sequence).padStart(3, '0')}_`, suffix = `.${imageExtension(extension)}`;
  const budget = 255 - new TextEncoder().encode(prefix + suffix).length;
  return prefix + truncateUtf8(imageStem(basename), budget) + suffix;
}

export function pageFolderName(title, fallback = 'images') {
  return truncateUtf8(sanitizeFileName((typeof title === 'string' ? title : '').trim() || fallback)
    .replace(/[\x7f]/g, '_').replace(/[ .]+$/, ''), 240)
    .replace(/[ .]+$/, '') || 'images';
}

export function archiveFilename(title, fallback = 'images') {
  return `${pageFolderName(title, fallback)}.zip`;
}

export function allocateImageNames(items) {
  const groups = new Set(items.map(item => item.kind).filter(Boolean));
  const mixed = groups.has('large') && groups.has('small');
  const counters = { large: 0, small: 0, other: 0 };
  return items.map(item => {
    const kind = item.kind === 'large' || item.kind === 'small' ? item.kind : 'other';
    const sequence = mixed ? ++counters[kind] : ++counters.other;
    const name = numberedImageName(sequence, imageExtension(item.format || item.url || item.basename || ''), item.basename || item.url);
    return mixed && kind !== 'other' ? `${kind === 'large' ? '大图' : '小图'}/${name}` : name;
  });
}
