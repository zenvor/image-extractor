import { createServer, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import JSZip from 'jszip';
import { expect, it, vi } from 'vitest';
import { buildArchive, type ArchiveDirectory } from '../lib/archive';
import { archiveKey, retryArchive } from '../lib/archiveState';
import type { ArchiveBatch } from '../lib/types';

// Real loopback HTTP, native fetch and disk streams. This does not exercise Chrome permissions,
// OPFS or chrome.downloads; those still require a browser acceptance run.
it('downloads a continuous 32-second response and aborts stalled, headerless and cancelled HTTP requests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'image-extractor-http-'));
  const requests: string[] = [];
  const timers = new Set<ReturnType<typeof setInterval>>();
  let cancelArrived!: () => void;
  const cancelling = new Promise<void>(resolve => { cancelArrived = resolve; });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><!--';
  const finish = '--></svg>';
  const stream = (response: ServerResponse) => {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    response.write(svg);
  };
  const server = createServer((request, response) => {
    requests.push(request.url!);
    if (request.url === '/headers.svg') return;
    stream(response);
    if (request.url === '/cancel.svg') cancelArrived();
    if (request.url !== '/slow.svg') return;
    let ticks = 0;
    const timer = setInterval(() => {
      if (++ticks === 16) { clearInterval(timer); timers.delete(timer); response.end(finish); }
      else response.write(' ');
    }, 2000);
    timers.add(timer);
    response.on('close', () => { clearInterval(timer); timers.delete(timer); });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as { port: number }).port;
    async function run(route: string, timeouts?: { headers: number; stall: number }, cancel = false) {
      const folder = join(root, route);
      await mkdir(folder);
      const directory: ArchiveDirectory = {
        async write(name, body, signal) { await body.pipeTo(Writable.toWeb(createWriteStream(join(folder, name))) as WritableStream<Uint8Array>, { signal }); },
        async file(name) { return new File([await readFile(join(folder, name))], name); },
        async remove(name) { await rm(join(folder, name), { force: true }); },
        async cleanup() { await rm(folder, { recursive: true, force: true }); },
      };
      const batch: ArchiveBatch = {
        id: route, filename: route + '.zip', title: route, pageUrl: `http://127.0.0.1:${port}/`,
        status: 'queued', started: Date.now(), updated: Date.now(), bytes: 0, message: '',
        items: [{ id: '0', url: `http://127.0.0.1:${port}/${route}.svg`, kind: 'large', filename: '001_image.svg', status: 'pending' }],
      };
      const controller = new AbortController();
      // Cancel an actual in-flight request, not a timer racing native fetch's cold start.
      if (cancel) void cancelling.then(() => controller.abort(new Error('下载已取消。')));
      let zip: File | undefined;
      await buildArchive(batch, {
        directory: async () => directory, fetch, persist: async () => {}, timeouts,
        publish: async file => { zip = file; },
      }, controller.signal);
      return { batch, zip };
    }
    const started = performance.now();
    const [slow, stalled, headers, cancelled] = await Promise.all([
      // Leave connection setup headroom under parallel test/build load; body silence still aborts at 150ms.
      run('slow'), run('stall', { headers: 5000, stall: 150 }),
      run('headers', { headers: 150, stall: 1000 }), run('cancel', undefined, true),
    ]);
    expect(performance.now() - started).toBeGreaterThan(30000);
    expect(slow.batch.status).toBe('complete');
    expect(requests.filter(url => url === '/slow.svg')).toHaveLength(1);
    const zip = await JSZip.loadAsync(await slow.zip!.arrayBuffer(), { checkCRC32: true });
    expect(Object.keys(zip.files)).toEqual(['001_image.svg']);
    expect(await zip.file('001_image.svg')!.async('string')).toBe(svg + ' '.repeat(15) + finish);
    expect(stalled.batch.items[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('停滞') });
    expect(headers.batch.items[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('请求超时') });
    expect(cancelled.batch.status).toBe('cancelled');
    expect(requests.filter(url => url === '/cancel.svg')).toHaveLength(1);
    expect([stalled, headers, cancelled].every(result => !result.zip)).toBe(true);
  } finally {
    for (const timer of timers) clearInterval(timer);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 45000);

it('preserves real HTTP successes across failed-only retry and disk-backed cancellation recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'image-extractor-recovery-'));
  const requests: string[] = [];
  const saved: Record<string, ArchiveBatch> = {};
  const published = new Map<string, File>();
  const phases = new Map<string, string[]>();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
  let repaired = false;
  let hold = true;
  let announceHold!: () => void;
  const held = new Promise<void>(resolve => { announceHold = resolve; });
  const server = createServer((request, response) => {
    requests.push(request.url!);
    if (request.url === '/retry.svg' && !repaired) {
      response.writeHead(503); response.end('temporarily unavailable'); return;
    }
    response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    if (request.url === '/hold.svg' && hold) {
      response.write('<svg xmlns="http://www.w3.org/2000/svg">');
      announceHold(); return;
    }
    response.end(svg);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    function batch(id: string, routes: string[]): ArchiveBatch {
      return {
        id, filename: `${id}.zip`, title: id, pageUrl: `${origin}/`, sourceTabId: 7,
        status: 'queued', started: Date.now(), updated: Date.now(), bytes: 0, message: '',
        items: routes.map((route, index) => ({ id: String(index), url: origin + route,
          kind: 'large', filename: `${index + 1}_${route.slice(1)}`, status: 'pending' })),
      };
    }
    const dependencies = {
      async directory(id: string): Promise<ArchiveDirectory> {
        const folder = join(root, id); await mkdir(folder, { recursive: true });
        return {
          async write(name, body, signal) { await body.pipeTo(Writable.toWeb(createWriteStream(join(folder, name))) as WritableStream<Uint8Array>, { signal }); },
          async file(name) { return new File([await readFile(join(folder, name))], name); },
          async remove(name) { await rm(join(folder, name), { force: true }); },
          async cleanup() { await rm(folder, { recursive: true, force: true }); },
        };
      },
      fetch, concurrency: 1,
      async persist(value: ArchiveBatch) {
        saved[archiveKey(value.id)] = structuredClone(value);
        phases.set(value.id, [...(phases.get(value.id) || []), value.status]);
      },
      async publish(file: File, value: ArchiveBatch) { published.set(value.id, file); },
    };
    // Only extension routing/storage is mocked; HTTP, cancellation, disk streams and ZIP are real.
    vi.stubGlobal('chrome', {
      permissions: { contains: async () => true }, runtime: { getURL: (path: string) => path },
      tabs: { create: async () => ({ id: 99 }) },
      storage: { local: {
        get: async () => structuredClone(saved),
        set: async (values: typeof saved) => { Object.assign(saved, structuredClone(values)); },
      } },
    });
    const partial = batch('partial', ['/ok.svg', '/retry.svg']);
    await buildArchive(partial, dependencies, new AbortController().signal);
    expect(partial.status).toBe('partial');
    expect(phases.get(partial.id)).toEqual(expect.arrayContaining(['fetching', 'packing', 'saving', 'partial']));
    const firstZip = await JSZip.loadAsync(await published.get(partial.id)!.arrayBuffer(), { checkCRC32: true });
    expect(Object.keys(firstZip.files)).toEqual(['1_ok.svg', '下载失败.txt']);
    expect(await firstZip.file('下载失败.txt')!.async('string')).toContain('HTTP 503');
    expect(requests).toEqual(['/ok.svg', '/retry.svg', '/retry.svg']);
    repaired = true;
    const retry = await retryArchive(partial.id);
    const retryBatch = saved[archiveKey(retry.batchId)]!;
    await buildArchive(retryBatch, dependencies, new AbortController().signal);
    expect(retryBatch.status).toBe('complete');
    expect(requests).toEqual(['/ok.svg', '/retry.svg', '/retry.svg', '/retry.svg']);
    const retryZip = await JSZip.loadAsync(await published.get(retryBatch.id)!.arrayBuffer(), { checkCRC32: true });
    expect(Object.keys(retryZip.files)).toEqual(['2_retry.svg']);
    expect(await retryZip.file('2_retry.svg')!.async('string')).toBe(svg);

    const recovering = batch('recovering', ['/cached.svg', '/hold.svg']);
    const controller = new AbortController();
    const downloading = buildArchive(recovering, dependencies, controller.signal);
    await held;
    controller.abort(new Error('下载已取消。'));
    await downloading;
    expect(recovering.status).toBe('cancelled');
    expect(recovering.cacheUntil).toBeGreaterThan(Date.now());
    expect(published.has(recovering.id)).toBe(false);
    expect(await readFile(join(root, recovering.id, '0.image'), 'utf8')).toBe(svg);
    hold = false;
    await buildArchive(recovering, dependencies, new AbortController().signal);
    expect(recovering.status).toBe('complete');
    expect(recovering.cacheUntil).toBeUndefined();
    expect(requests.filter(route => route === '/cached.svg')).toHaveLength(1);
    expect(requests.filter(route => route === '/hold.svg')).toHaveLength(2);
    const recoveredZip = await JSZip.loadAsync(await published.get(recovering.id)!.arrayBuffer(), { checkCRC32: true });
    expect(Object.keys(recoveredZip.files)).toEqual(['1_cached.svg', '2_hold.svg']);
    expect(await recoveredZip.file('1_cached.svg')!.async('string')).toBe(svg);
    expect(await recoveredZip.file('2_hold.svg')!.async('string')).toBe(svg);
    await expect(readFile(join(root, recovering.id, '0.image'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    vi.unstubAllGlobals();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
