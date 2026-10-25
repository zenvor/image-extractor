import { expect, it } from 'vitest';
import { parsePageUrls } from '../lib/batchInputs';
it('normalizes and deduplicates a bounded webpage list', () => {
  expect(parsePageUrls('https://a.test\nhttps://a.test/\nhttps://b.test/x')).toEqual(['https://a.test/','https://b.test/x']);
});
it('rejects executable, credentialed, missing and excessive input', () => {
  for (const value of ['', 'javascript:alert(1)', 'file:///private/a', 'https://a:b@a.test', Array.from({length:21}, (_,i) => 'https://a.test/' + i).join('\n')]) expect(() => parsePageUrls(value)).toThrow();
});
it('sorts HTML files naturally or by modification time without mutating the original selection', async () => {
  const { sortHtmlFiles } = await import('../lib/batchInputs');
  const files = [{ name: '10.html', lastModified: 10 }, { name: '2.html', lastModified: 20 }, { name: '1.html', lastModified: 30 }];
  expect(sortHtmlFiles(files, 'name').map(file => file.name)).toEqual(['1.html', '2.html', '10.html']);
  expect(sortHtmlFiles(files, 'mtime-asc').map(file => file.lastModified)).toEqual([10, 20, 30]);
  expect(sortHtmlFiles(files, 'mtime-desc').map(file => file.lastModified)).toEqual([30, 20, 10]);
  expect(sortHtmlFiles(files, 'selection')).toEqual(files);
  expect(files[0]!.name).toBe('10.html');
});
