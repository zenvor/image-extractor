import { en } from './locales/en';

export type Locale = 'zh-CN' | 'en';
export type LanguagePreference = Locale | 'auto';
export type MessageKey = keyof typeof en;
export const LANGUAGE_KEY = 'interfaceLanguage';
let locale: Locale = 'zh-CN';
let preference: LanguagePreference = 'auto';
const listeners = new Set<() => void>();
export const subscribeLocale = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getLocale = () => locale;
export const getLanguagePreference = () => preference;
function browserLanguage() {
  if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) return chrome.i18n.getUILanguage();
  return typeof navigator === 'undefined' ? 'en' : navigator.language;
}
export function resolveLocale(value: unknown, language = browserLanguage()): Locale {
  if (value === 'zh-CN' || value === 'en') return value;
  return /^zh(?:-|$)/i.test(language) ? 'zh-CN' : 'en';
}
function normalizePreference(value: unknown): LanguagePreference { return value === 'zh-CN' || value === 'en' ? value : 'auto'; }
function apply(value: unknown) {
  preference = normalizePreference(value);
  locale = resolveLocale(preference);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}
function extensionStorage() { return typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.storage : undefined; }
/** Initialize before mounting React so the first frame uses the saved language. */
export async function initializeLocale() {
  apply('auto');
  const storage = extensionStorage();
  if (storage) {
    let changed = false;
    storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[LANGUAGE_KEY]) { changed = true; apply(changes[LANGUAGE_KEY]!.newValue); }
    });
    try { const saved = await storage.local.get(LANGUAGE_KEY); if (!changed) apply(saved[LANGUAGE_KEY]); } catch { if (!changed) apply('auto'); }
  } else {
    try { apply(localStorage.getItem(LANGUAGE_KEY)); } catch { apply('auto'); }
    window.addEventListener('storage', event => { if (event.key === LANGUAGE_KEY) apply(event.newValue); });
  }
  window.addEventListener('languagechange', () => { if (preference === 'auto') apply('auto'); });
}
export async function setLanguagePreference(value: LanguagePreference) {
  const next = normalizePreference(value);
  const storage = extensionStorage();
  if (storage) await storage.local.set({ [LANGUAGE_KEY]: next });
  else if (typeof localStorage !== 'undefined') localStorage.setItem(LANGUAGE_KEY, next);
  apply(next);
}
function interpolate(template: string, values: readonly unknown[]) {
  return template.replace(/\{(\d+)\}/g, (placeholder, index: string) => values[Number(index)] === undefined ? placeholder : String(values[Number(index)]));
}
export function t(key: MessageKey, values: readonly unknown[] = []): string {
  return interpolate(locale === 'en' ? en[key] : key, values);
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const entries = Object.entries(en);
const exactEnglish = new Map(entries.map(([key, value]) => [value as string, key]));
// Older tasks persisted UI messages using 图片. Alias only known templates so
// filenames, URLs and unknown errors retain their original bytes.
const legacyChinese = new Map(entries.filter(([key]) => key.includes('图像')).map(([key]) => [key.replaceAll('图像', '图片'), key]));
const patterns = entries.filter(([key]) => /\{\d+\}/.test(key)).flatMap(([key, english]) => [...new Set([key, english, key.replaceAll('图像', '图片')])].map(template => {
  const slots = [...template.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1]));
  const pattern = new RegExp('^' + template.split(/\{\d+\}/).map(escape).join('([\\s\\S]*)') + '$');
  return { key: key as MessageKey, pattern, slots, specificity: template.replace(/\{\d+\}/g, '').length };
})).sort((a, b) => b.specificity - a.specificity);
/** Localize persisted worker feedback, including tasks created before i18n support.
 * Unknown server/Chrome errors are preserved verbatim; URLs and filenames are never translated.
 */
export function translateMessage(value: string | undefined, target: Locale = locale, depth = 0): string {
  if (!value) return '';
  if (value.startsWith('Error: ')) return 'Error: ' + translateMessage(value.slice(7), target, depth + 1);
  const key = Object.hasOwn(en, value) ? value : exactEnglish.get(value) ?? legacyChinese.get(value);
  if (key) return target === 'en' ? en[key as MessageKey] : key;
  if (depth > 3 || value.length > 4096) return value;
  for (const { key, pattern, slots } of patterns) {
    const match = pattern.exec(value);
    if (!match) continue;
    const values: string[] = [];
    slots.forEach((slot, index) => { values[slot] = translateMessage(match[index + 1], target, depth + 1); });
    return interpolate(target === 'en' ? en[key] : key, values);
  }
  return value;
}
