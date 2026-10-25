// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArchiveProgress } from '../components/ArchiveProgress';
import { archiveFeedback } from '../lib/archiveFeedback';
import { setLanguagePreference } from '../lib/i18n';
import type { ArchiveBatch } from '../lib/types';

let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  await setLanguagePreference('zh-CN');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); await setLanguagePreference('zh-CN'); vi.unstubAllGlobals(); });
function batch(status: ArchiveBatch['status'], complete: number, failed: number, total: number): ArchiveBatch {
  return { id: 'progress', title: 'Gallery', filename: 'Gallery.zip', pageUrl: 'https://gallery.test/', status, started: 1, updated: 1, bytes: 0, message: '',
    items: Array.from({ length: total }, (_, index) => ({ id: String(index), url: `https://gallery.test/${index}.jpg`, filename: `${index}.jpg`, kind: 'large', status: index < complete ? 'complete' : index < complete + failed ? 'failed' : 'pending' })) };
}
async function render(value: ArchiveBatch) {
  await act(async () => root.render(<ArchiveProgress feedback={archiveFeedback(value)} status={value.status} />));
  return container.querySelector<HTMLElement>('[role=progressbar]')!;
}
it.each([
  ['partial', 101, 62, 163], ['complete', 2, 0, 2], ['failed', 0, 2, 2],
  ['cancelled', 1, 1, 4], ['failed', 0, 0, 0],
] as const)('renders accurate outcome proportions for %s (%i succeeded, %i failed, %i total)', async (status, complete, failed, total) => {
  const bar = await render(batch(status, complete, failed, total));
  const widths = ['complete', 'failed', 'pending'].map(name => parseFloat(container.querySelector<HTMLElement>(`[data-outcome=${name}]`)!.style.width));
  const expected = [complete, failed, total - complete - failed].map(count => total ? count / total * 100 : 0);
  widths.forEach((width, index) => expect(width).toBeCloseTo(expected[index]!, 7));
  expect(Number(bar.getAttribute('aria-valuenow'))).toBeCloseTo(total ? (complete + failed) / total * 100 : 0);
  expect(bar.getAttribute('aria-valuetext')).toContain(`${complete} 张成功，${failed} 张失败，${total - complete - failed} 张待处理`);
  expect(container.querySelector('[data-outcome=complete]')?.classList.contains('bg-brand')).toBe(true);
  expect(container.querySelector('[data-outcome=failed]')?.classList.contains('bg-warning')).toBe(true);
  expect(container.querySelector('[data-outcome=pending]')?.classList.contains('bg-progress-pending')).toBe(true);
});
it.each(['packing', 'saving'] as const)('keeps %s indeterminate and does not claim ZIP saving has finished', async status => {
  const bar = await render(batch(status, 1, 1, 2));
  expect(bar.hasAttribute('aria-valuenow')).toBe(false);
  expect(container.querySelector('.progress-indeterminate')).not.toBeNull();
  expect(bar.getAttribute('aria-valuetext')).not.toContain('ZIP 已保存');
  expect(bar.getAttribute('aria-valuetext')).toContain('1 张成功，1 张失败');
});
it('updates warning back to pending during automatic retry and localizes counts without remounting', async () => {
  const bar = await render(batch('fetching', 1, 1, 2));
  expect(container.querySelector<HTMLElement>('[data-outcome=failed]')?.style.width).toBe('50%');
  await render(batch('fetching', 1, 0, 2));
  expect(container.querySelector('[role=progressbar]')).toBe(bar);
  expect(container.querySelector<HTMLElement>('[data-outcome=failed]')?.style.width).toBe('0%');
  expect(container.querySelector<HTMLElement>('[data-outcome=pending]')?.style.width).toBe('50%');
  await act(async () => { await setLanguagePreference('en'); });
  await render(batch('fetching', 2, 0, 2));
  expect(bar.getAttribute('aria-valuetext')).toContain('2 succeeded, 0 failed, 0 pending');
  expect(container.querySelector<HTMLElement>('[data-outcome=complete]')?.style.width).toBe('100%');
});
