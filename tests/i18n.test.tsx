// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { en } from '../lib/locales/en';
import { getLanguagePreference, getLocale, initializeLocale, LANGUAGE_KEY, resolveLocale, setLanguagePreference, t, translateMessage } from '../lib/i18n';
import { useLocale } from '../lib/useLocale';
import { archiveFeedback } from '../lib/archiveFeedback';
import type { ArchiveBatch } from '../lib/types';

afterEach(async () => { vi.unstubAllGlobals(); await setLanguagePreference('zh-CN'); localStorage.clear(); });
it('resolves browser locales with an English fallback and explicit overrides', () => {
  expect(resolveLocale('auto', 'zh-TW')).toBe('zh-CN');
  expect(resolveLocale('auto', 'zh-CN')).toBe('zh-CN');
  expect(resolveLocale('auto', 'en-US')).toBe('en');
  expect(resolveLocale('auto', 'de-DE')).toBe('en');
  expect(resolveLocale('en', 'zh-CN')).toBe('en');
  expect(resolveLocale('zh-CN', 'en')).toBe('zh-CN');
});
it('keeps placeholders consistent in every translation', () => {
  for (const [key, value] of Object.entries(en)) {
    expect(value.trim(), key).not.toBe('');
    expect([...value.matchAll(/\{\d+\}/g)].map(m => m[0]).sort(), key).toEqual([...key.matchAll(/\{\d+\}/g)].map(m => m[0]).sort());
  }
});
it('translates persisted worker feedback, nested counts and raw errors without touching URLs', async () => {
  await setLanguagePreference('en');
  expect(translateMessage('已处理 12 / 30 张')).toBe('Processed 12 / 30 images');
  expect(translateMessage('Error: 未获得下载权限。')).toBe('Error: Download permission was not granted.');
  expect(translateMessage('2 个相对图像地址无法解析，请补充原网页地址后重新导入。')).toContain('2 relative image URLs');
  expect(translateMessage('3 张成功，2 张失败，1 张待处理。失败的图像会自动重试一次。')).toBe('3 succeeded, 2 failed, 1 remaining. Failed images are retried once automatically.');
  expect(translateMessage('HTTP 404')).toBe('HTTP 404');
  expect(translateMessage('https://example.org/图像.jpg')).toBe('https://example.org/图像.jpg');
  expect(translateMessage('Processed 12 / 30 images', 'zh-CN')).toBe('已处理 12 / 30 张');
  expect(t('下载所选内容（{0}）', [3])).toBe('Download selected (3)');
});
it('recognizes legacy image terminology without rewriting user filenames or URLs', () => {
  expect(translateMessage('2 个相对图片地址无法解析，请补充原网页地址后重新导入。', 'en')).toContain('2 relative image URLs');
  expect(translateMessage('3 张成功，2 张失败，1 张待处理。失败的图片会自动重试一次。', 'zh-CN')).toBe('3 张成功，2 张失败，1 张待处理。失败的图像会自动重试一次。');
  for (const value of ['https://example.org/图片.jpg', '我的图片.zip', '下载失败图片.jpg']) expect(translateMessage(value, 'en')).toBe(value);
});
it('persists the preference and initializes it before rendering', async () => {
  const set = vi.fn(async () => {});
  vi.stubGlobal('chrome', { runtime: { id: 'test' }, storage: { local: { get: vi.fn(async () => ({ [LANGUAGE_KEY]: 'en' })), set }, onChanged: { addListener: vi.fn() } } });
  await initializeLocale();
  expect(getLocale()).toBe('en');
  expect(document.documentElement.lang).toBe('en');
  await setLanguagePreference('zh-CN');
  expect(set).toHaveBeenCalledWith({ [LANGUAGE_KEY]: 'zh-CN' });
  expect(getLanguagePreference()).toBe('zh-CN');
});
it('reacts to another page changing language without remounting or losing selection', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let changed!: (changes: Record<string, { newValue: string }>, area: string) => void;
  vi.stubGlobal('chrome', { runtime: { id: 'test' }, storage: { local: { get: vi.fn(async () => ({ [LANGUAGE_KEY]: 'zh-CN' })) }, onChanged: { addListener: vi.fn(fn => { changed = fn; }) } } });
  await initializeLocale();
  let mounts = 0;
  function Page() { useLocale(); const [count, setCount] = useState(() => { mounts++; return 2; }); return <button onClick={() => setCount(count + 1)}>{t('下载所选内容（{0}）', [count])}</button>; }
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  try {
    await act(async () => root.render(<Page />));
    await act(async () => element.querySelector('button')!.click());
    await act(async () => changed({ [LANGUAGE_KEY]: { newValue: 'en' } }, 'local'));
    expect(element.textContent).toBe('Download selected (3)');
    expect(mounts).toBe(1);
  } finally { await act(async () => root.unmount()); element.remove(); }
});
it('localizes task progress and partial failure feedback', async () => {
  await setLanguagePreference('en');
  const batch = { status: 'partial', message: '', items: [{ status: 'complete' }, { status: 'failed' }] } as ArchiveBatch;
  const feedback = archiveFeedback(batch);
  expect(feedback.title).toBe('Some images failed');
  expect(feedback.detail).toContain('1 succeeded, 1 failed');
  expect(feedback.summary).toBe('Saved 1 · 1 failed');
});

it('uses browser language during startup before applying the saved preference', async () => {
  let finish!: (value: Record<string, string>) => void;
  vi.stubGlobal('chrome', {
    runtime: { id: 'test' }, i18n: { getUILanguage: () => 'en-US' },
    storage: { local: { get: vi.fn(() => new Promise(resolve => { finish = resolve; })) }, onChanged: { addListener: vi.fn() } },
  });
  const ready = initializeLocale();
  expect(getLocale()).toBe('en');
  expect(document.documentElement.lang).toBe('en');
  expect(t('正在读取页面与设置…')).toBe(en['正在读取页面与设置…']);
  finish({ [LANGUAGE_KEY]: 'zh-CN' });
  await ready;
  expect(getLocale()).toBe('zh-CN');
  expect(document.documentElement.lang).toBe('zh-CN');
});
