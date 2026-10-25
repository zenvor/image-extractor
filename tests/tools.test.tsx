// @vitest-environment happy-dom
import { act } from 'react';
import { setLanguagePreference } from '../lib/i18n';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tools } from '../entrypoints/tools/tools';
import type { AnalysisState, ArchiveBatch } from '../lib/types';
let root: Root, container: HTMLDivElement;
let session: Record<string, AnalysisState>, local: Record<string, ArchiveBatch>;
let listeners: Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>;
let send: ReturnType<typeof vi.fn>, create: ReturnType<typeof vi.fn>, request: ReturnType<typeof vi.fn>;
function state(tabId: number, count = 1): AnalysisState {
  return { tabId, job: 'job-' + tabId, url: `https://example.org/${tabId}`, title: 'Page ' + tabId, status: 'done', started: 0, total: count, truncated: false, message: '',
    selected: count ? ['0'] : [], results: count ? [{ id: '0', url: 'https://images.example.org/photo.jpg', source: '', label: 'photo', candidate: true, reason: '', width: 0, height: 0 }] : [] };
}
function changed(value: AnalysisState) {
  session['analysis:' + value.tabId] = value;
  for (const listener of listeners) listener({ ['analysis:' + value.tabId]: { newValue: value } }, 'session');
}
function archive(id: string, status: ArchiveBatch['status'] = 'fetching'): ArchiveBatch {
  return { id, tabId: 100, filename: 'page.zip', title: 'page', pageUrl: '', started: 0, updated: 0, bytes: 0, status, message: status === 'partial' ? 'ZIP 已保存：1 张成功，1 张失败。' : '正在下载图像…', items: [{ id: '0', url: '', kind: 'large', filename: '', status: 'complete' }, { id: '1', url: '', kind: 'large', filename: '', status: status === 'partial' ? 'failed' : 'pending' }] };
}
const button = (label: string) => [...container.querySelectorAll('button')].find(node => node.textContent === label)!;
async function click(label: string) { expect(button(label)).toBeTruthy(); await act(async () => button(label).click()); }
async function batch(count = 2) {
  const textarea = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, Array.from({ length: count }, (_, i) => `https://example.org/${i}`).join('\n'));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('批量提取');
}
beforeEach(async () => {
  session = {}; local = {}; listeners = new Set(); let next = 0;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  create = vi.fn(async () => ({ id: ++next })); request = vi.fn(async () => true);
  send = vi.fn(async (message: { type: string; tabId: number; job?: string }) => {
    if (message.type === 'ANALYZE') changed(state(message.tabId));
    if (message.type === 'DOWNLOAD_ZIP') {
      const id = message.job!; local['archiveBatch:' + id] = archive(id);
      return { ok: true, batchId: id };
    }
    if (message.type === 'IMPORT_CAPTURE') { const value = state(++next); session['analysis:' + next] = value; return { ok: true, tabId: next, count: 1 }; }
    return { ok: true };
  });
  vi.stubGlobal('chrome', {
    permissions: { request }, runtime: { sendMessage: send },
    tabs: { create, get: async () => ({ status: 'complete' }), update: vi.fn(async () => ({})) },
    storage: {
      session: { get: async () => session }, local: { get: async () => local },
      onChanged: { addListener: (fn: typeof listeners extends Set<infer T> ? T : never) => listeners.add(fn), removeListener: (fn: typeof listeners extends Set<infer T> ? T : never) => listeners.delete(fn) },
    },
  });
  container = document.createElement('div'); document.body.append(container);
  await act(async () => { root = createRoot(container); root.render(<Tools />); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('passes the optional bounded scroll mode to every sequential batch analysis', async () => {
  await act(async () => container.querySelector<HTMLButtonElement>('[role=checkbox]')!.click());
  await batch();
  expect(send.mock.calls.filter(([message]) => message.type === 'ANALYZE').map(([message]) => message.scroll)).toEqual([true, true]);
  expect(create).toHaveBeenCalledTimes(2);
});
it('keeps batch counts and download eligibility synchronized after reanalysis and selection changes', async () => {
  send.mockImplementation(async (message: { tabId: number }) => { changed(state(message.tabId, 0)); return { ok: true }; });
  await batch(1);
  expect(button('下载各页选定图像').disabled).toBe(true);
  await act(async () => changed(state(1, 1)));
  expect(button('下载各页选定图像').disabled).toBe(false);
  await click('下载各页选定图像');
  expect(button('允许并开始下载')).toBeTruthy();
  await act(async () => changed({ ...state(1, 1), selected: [] }));
  expect(button('下载各页选定图像').disabled).toBe(true);
});
it('shows final partial and complete download outcomes instead of treating launch as success', async () => {
  await batch(); await click('下载各页选定图像'); await click('允许并开始下载');
  expect(container.textContent).toContain('0 页全部保存，0 页部分成功，0 页失败或取消，2 页进行中');
  await act(async () => {
    for (const listener of listeners) listener({ 'archiveBatch:job-1': { newValue: archive('job-1', 'partial') }, 'archiveBatch:job-2': { newValue: archive('job-2', 'complete') } }, 'local');
  });
  expect(container.textContent).toContain('1 页全部保存，1 页部分成功，0 页失败或取消，0 页进行中');
  expect(container.textContent).toContain('1 成功 / 1 失败');
});
it('stops HTML import before creating result pages when a file read is pending', async () => {
  let release!: (value: string) => void;
  const first = { name: 'first.html', size: 10, text: () => new Promise<string>(resolve => { release = resolve; }) };
  const second = { name: 'second.html', size: 10, text: vi.fn(async () => '<img src="https://a.test/b.jpg">') };
  await act(async () => container.querySelector<HTMLButtonElement>('[role=tab][data-state=inactive]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: [first, second] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await click('开始导入');
  await click('停止后续操作');
  await act(async () => release('<img src="https://a.test/a.jpg">'));
  expect(send).not.toHaveBeenCalled(); expect(second.text).not.toHaveBeenCalled();
  expect(container.textContent).toContain('已停止后续操作');
});
it('stops pending download permission flow without creating any task', async () => {
  await batch(); await click('下载各页选定图像');
  let release!: (value: boolean) => void;
  request.mockImplementation(() => new Promise<boolean>(resolve => { release = resolve; }));
  await click('允许并开始下载'); await click('停止后续操作');
  await act(async () => release(true));
  expect(send.mock.calls.filter(([message]) => message.type === 'DOWNLOAD_ZIP')).toHaveLength(0);
});
it('stops after an already-submitted download and preserves that task without launching the next one', async () => {
  await batch(); await click('下载各页选定图像');
  let release!: (value: unknown) => void;
  send.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  await click('允许并开始下载'); await click('停止后续操作');
  await act(async () => release({ ok: true, batchId: 'already-started' }));
  expect(send.mock.calls.filter(([message]) => message.type === 'DOWNLOAD_ZIP')).toHaveLength(1);
  expect(container.textContent).toContain('1 页进行中');
});
it('stops batch page creation when cancelled during its permission request', async () => {
  let release!: (value: boolean) => void;
  request.mockImplementation(() => new Promise<boolean>(resolve => { release = resolve; }));
  await batch(); await click('停止后续操作');
  await act(async () => release(true));
  expect(create).not.toHaveBeenCalled();
});
it('allows retry after a task launch failure without requiring page reanalysis', async () => {
  await batch(1); await click('下载各页选定图像');
  send.mockResolvedValueOnce({ ok: false, message: '启动失败' });
  await click('允许并开始下载');
  expect(container.textContent).toContain('启动失败');
  expect(button('下载各页选定图像').disabled).toBe(false);
  await click('下载各页选定图像'); await click('允许并开始下载');
  expect(container.textContent).toContain('1 页进行中');
});

async function enterUrls(value: string) {
  await act(async () => {
    const textarea = container.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function htmlMode() {
  await act(async () => container.querySelector<HTMLButtonElement>('[role=tab][data-state=inactive]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
}
async function chooseFiles(files: File[]) {
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
it('explains the invalid URL and focuses it without opening pages or requesting permission', async () => {
  await enterUrls('https://example.org/gallery\nnot-a-url');
  await click('批量提取');
  expect(container.textContent).toContain('第 2 个地址无效');
  expect(document.activeElement).toBe(container.querySelector('textarea'));
  expect(request).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  await enterUrls('https://example.org/gallery\nhttps://example.org/gallery');
  expect(container.textContent).not.toContain('第 2 个地址无效');
  expect(container.textContent).toContain('已忽略 1 个重复地址');
  await click('批量提取');
  expect(create).toHaveBeenCalledTimes(1);
});
it('lets users review and remove selected files before explicitly importing them', async () => {
  await htmlMode();
  const first = new File(['<img src="https://a.test/a.jpg">'], 'first.html', { type: 'text/html' });
  const second = new File(['<img src="https://a.test/b.jpg">'], 'second.html', { type: 'text/html' });
  await chooseFiles([first, second]);
  expect(send).not.toHaveBeenCalled();
  expect(container.textContent).toContain('2 / 20 个');
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="移除 first.html"]')!.click());
  await click('开始导入');
  expect(send.mock.calls.filter(([message]) => message.type === 'IMPORT_CAPTURE')).toHaveLength(1);
  expect(container.textContent).toContain('1 页成功');
});
it('rejects unsupported files and excessive queues without starting an import', async () => {
  await htmlMode();
  await chooseFiles([new File(['bad'], 'photo.jpg')]);
  expect(container.textContent).toContain('请选择不超过 16 MB');
  await chooseFiles(Array.from({ length: 21 }, (_, i) => new File(['html'], `${i}.html`)));
  expect(container.textContent).toContain('每次最多导入 20 个');
  expect(container.querySelectorAll('.tools-file-list li')).toHaveLength(0);
  expect(send).not.toHaveBeenCalled();
});
it('shows the full queue and marks unstarted pages after a stop', async () => {
  let release!: (value: boolean) => void;
  request.mockImplementation(() => new Promise<boolean>(resolve => { release = resolve; }));
  await batch(3);
  expect(container.querySelectorAll('.tools-result-list li')).toHaveLength(3);
  expect(container.querySelectorAll('[data-state=queued]')).toHaveLength(3);
  await click('停止后续操作');
  await act(async () => release(true));
  expect(container.querySelectorAll('[data-state=stopped]')).toHaveLength(3);
  expect(container.querySelectorAll('[data-state=queued]')).toHaveLength(0);
  expect(create).not.toHaveBeenCalled();
});
it('keeps other queued pages running when one page fails and reports their separate outcomes', async () => {
  send.mockImplementation(async (message: { tabId: number }) => {
    if (message.tabId === 1) return { ok: false, message: '站点无法访问' };
    changed(state(message.tabId)); return { ok: true };
  });
  await batch(2);
  expect(container.textContent).toContain('1 页成功 · 1 页失败');
  expect(container.textContent).toContain('站点无法访问');
  expect(button('下载各页选定图像').disabled).toBe(false);
});
it('keeps successful files while retrying only the HTML with unresolved addresses after adding a base', async () => {
  await htmlMode();
  const first = new File(['<img src="a.jpg">'], 'relative.html', { type: 'text/html' });
  const second = new File(['<img src="https://a.test/b.jpg">'], 'absolute.html', { type: 'text/html' });
  send.mockImplementation(async (message: { type: string; capture?: { baseUrl: string; title: string } }) => {
    if (message.type === 'IMPORT_CAPTURE' && message.capture?.title === 'relative.html' && !message.capture.baseUrl) return { ok: false, message: '1 个相对图像地址无法解析，请补充原网页地址后重新导入。' };
    return { ok: true, tabId: 3, count: 1 };
  });
  await chooseFiles([first, second]); await click('开始导入');
  expect(container.textContent).toContain('1 页成功 · 1 页失败');
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('#html-base')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'https://example.org/');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('补充地址后重试');
  expect(send.mock.calls.filter(([message]) => message.type === 'IMPORT_CAPTURE')).toHaveLength(3);
  expect(container.querySelectorAll('.tools-result-list li')).toHaveLength(2);
  expect(container.textContent).toContain('2 页成功 · 0 页失败');
});
it('displays the exact missing-address warning even when an import has usable results', async () => {
  await htmlMode();
  send.mockResolvedValueOnce({ ok: true, tabId: 4, count: 1, unresolvedCount: 2 });
  await chooseFiles([new File(['<img src="a.jpg">'], 'mixed.html')]); await click('开始导入');
  expect(container.textContent).toContain('2 个相对图像地址无法解析');
  expect(container.textContent).toContain('补充地址后重试');
  expect(button('下载各页选定图像').disabled).toBe(false);
});

it('localizes tools and validation without losing the entered URLs', async () => {
  const textarea = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'invalid-url');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('批量提取');
  try {
    await act(async () => { await setLanguagePreference('en'); });
    expect(container.textContent).toContain('Batch image extraction');
    expect(container.querySelector('#urls-feedback')?.textContent).toBe('URL 1 is invalid. Enter a complete HTTP / HTTPS URL.');
    expect(textarea.value).toBe('invalid-url');
    expect(create).not.toHaveBeenCalled();
    expect(document.title).toBe('Image Extractor · Batch image extraction');
  } finally { await act(async () => { await setLanguagePreference('zh-CN'); }); }
});
