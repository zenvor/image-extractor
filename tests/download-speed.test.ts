import { locks } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { DOWNLOAD_SPEEDS, MAX_GLOBAL_DOWNLOADS, downloadSpeed, withDownloadSlot, noteDownloadResponse, retryAfterDelay, waitForDownload, type RateEnvironment } from '../lib/downloadSpeed';

// Real Web Locks implementation, shared across independently instantiated task clients.
// Accelerate wall time only; keep production policies and scheduler unchanged.
let fixtureId = 0;
function fixture(speed: unknown = 'low') {
  const values: Record<string, unknown> = { downloadSpeed: speed };
  // Pacing outlives a completed transfer. Different tests must not share leases
  // when they intentionally use different virtual/accelerated clocks.
  const namespace = `download-test-${++fixtureId}:`;
  const isolated = {
    request: (name: string, ...args: unknown[]) => (locks.request as Function).call(locks, namespace + name, ...args),
    query: async () => {
      const snapshot = await locks.query();
      const local = (entries = snapshot.held) => entries?.filter(lock => lock.name?.startsWith(namespace)).map(lock => ({ ...lock, name: lock.name!.slice(namespace.length) }));
      return { held: local(snapshot.held), pending: local(snapshot.pending) };
    },
  } as unknown as LockManager;
  const env: RateEnvironment = {
    locks: isolated,
    get: async () => structuredClone(values),
    set: async value => { Object.assign(values, structuredClone(value)); },
    now: () => Date.now() * 20,
    wait: (ms, signal) => waitForDownload(ms / 20, signal),
  };
  return { env, values };
}
const signal = () => new AbortController().signal;
// Capacity is a property of held transfers, not of a machine managing to start
// enough requests during an arbitrary 500 ms response window.
async function heldTransfers(env: RateEnvironment, urls: string[], capacity: number, oneTask = false) {
  const abort = new AbortController();
  let release!: () => void, reached!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const full = new Promise<void>(resolve => { reached = resolve; });
  let live = 0, peak = 0, started = 0;
  const starts: number[] = [];
  const operations = urls.map((url, index) => withDownloadSlot(url, abort.signal, async () => {
    starts.push(env.now()); started++; peak = Math.max(peak, ++live);
    if (live === capacity) reached();
    try { await hold; } finally { live--; }
  }, { ...env }, oneTask ? 'one-task' : `task-${index}`));
  operations.forEach(operation => { void operation.catch(() => {}); });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([full, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Transfers did not reach their configured capacity')), 10000);
    })]);
    expect(live).toBe(capacity);
    await waitForDownload(20, signal());
    expect(started).toBe(capacity);
    release(); await Promise.all(operations);
    expect(peak).toBe(capacity);
    return starts;
  } finally {
    clearTimeout(timeout); release(); abort.abort();
    await Promise.allSettled(operations);
  }
}
it('ten independent task pages cannot exceed the hard global ceiling even if a preset is raised', async () => {
  const { env } = fixture('high');
  const policy = DOWNLOAD_SPEEDS.high as { concurrency: number };
  const original = policy.concurrency;
  policy.concurrency = 100;
  let live = 0, peak = 0, started = 0;
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let ready!: () => void;
  const full = new Promise<void>(resolve => { ready = resolve; });
  const operations = Array.from({ length: MAX_GLOBAL_DOWNLOADS * 3 }, (_, index) => withDownloadSlot(`https://ceiling-${index}.test/a.jpg`, signal(), async () => {
    started++; peak = Math.max(peak, ++live);
    if (live === MAX_GLOBAL_DOWNLOADS) ready();
    try { await hold; } finally { live--; }
  }, { ...env }, `page-${index % 10}`));
  try {
    await full;
    await waitForDownload(60, signal());
    expect(live).toBe(MAX_GLOBAL_DOWNLOADS);
    expect(started).toBe(MAX_GLOBAL_DOWNLOADS);
    release();
    await Promise.all(operations);
    expect(started).toBe(MAX_GLOBAL_DOWNLOADS * 3);
    expect(peak).toBe(MAX_GLOBAL_DOWNLOADS);
  } finally {
    release();
    await Promise.allSettled(operations);
    policy.concurrency = original;
  }
});
it('defaults to Medium and preserves explicit saved policies', () => {
  expect(downloadSpeed(undefined)).toBe('medium'); expect(downloadSpeed('fastest')).toBe('medium');
  expect(downloadSpeed('low')).toBe('low');
  expect(downloadSpeed('medium')).toBe('medium'); expect(downloadSpeed('high')).toBe('high');
  expect(downloadSpeed('xhigh')).toBe('xhigh');
  expect(downloadSpeed('unlimited')).toBe('medium');
  expect(downloadSpeed('max')).toBe('max');
  expect(MAX_GLOBAL_DOWNLOADS).toBe(30);
  expect(Object.keys(DOWNLOAD_SPEEDS)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  expect(Object.values(DOWNLOAD_SPEEDS).map(policy => policy.perOrigin)).toEqual([5, 10, 20, 25, 30]);
});
it('gives a remaining page the slots released by another page without exceeding thirty transfers', async () => {
  const { env } = fixture('max');
  let liveA = 0, liveB = 0, peak = 0;
  let releaseA!: () => void, releaseB!: () => void;
  const holdA = new Promise<void>(resolve => { releaseA = resolve; });
  const holdB = new Promise<void>(resolve => { releaseB = resolve; });
  let startedA!: () => void, shared!: () => void, borrowed!: () => void;
  const aReady = new Promise<void>(resolve => { startedA = resolve; });
  const sharedReady = new Promise<void>(resolve => { shared = resolve; });
  const borrowedReady = new Promise<void>(resolve => { borrowed = resolve; });
  const a = Array.from({ length: 7 }, () => withDownloadSlot('https://shared.test/a.jpg', signal(), async () => {
    liveA++; peak = Math.max(peak, liveA + liveB);
    if (liveA === 7) startedA();
    try { await holdA; } finally { liveA--; }
  }, env, 'page-A'));
  await aReady;
  const b = Array.from({ length: MAX_GLOBAL_DOWNLOADS + 3 }, () => withDownloadSlot('https://shared.test/b.jpg', signal(), async () => {
    liveB++; peak = Math.max(peak, liveA + liveB);
    if (liveB === MAX_GLOBAL_DOWNLOADS - 7) shared();
    if (liveB === MAX_GLOBAL_DOWNLOADS) borrowed();
    try { await holdB; } finally { liveB--; }
  }, { ...env }, 'page-B'));
  try {
    await sharedReady;
    expect(liveA).toBe(7); expect(liveB).toBe(MAX_GLOBAL_DOWNLOADS - 7);
    releaseA();
    await borrowedReady;
    expect(liveA).toBe(0); expect(liveB).toBe(MAX_GLOBAL_DOWNLOADS);
    expect(peak).toBe(MAX_GLOBAL_DOWNLOADS);
  } finally {
    releaseA(); releaseB();
    await Promise.allSettled([...a, ...b]);
  }
});
it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)('%s enforces a shared cap and start spacing across independent tasks', async speed => {
  const { env } = fixture(speed);
  const starts = await heldTransfers(env, Array.from({ length: MAX_GLOBAL_DOWNLOADS + 5 }, (_, index) => `https://host-${index}.test/a.jpg`), MAX_GLOBAL_DOWNLOADS);
  for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(DOWNLOAD_SPEEDS[speed].globalInterval);
});
it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)('%s shares its source limit across a single page rather than imposing a three-image page limit', async speed => {
  const { env } = fixture(speed);
  await heldTransfers(env, Array.from({ length: MAX_GLOBAL_DOWNLOADS + 5 }, () => 'https://same.test/a.jpg'), DOWNLOAD_SPEEDS[speed].perOrigin, true);
});
it('aborting a queued request does not start it, and slots are released after errors', async () => {
  const { env } = fixture(); const abort = new AbortController(); let called = false;
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const first = withDownloadSlot('https://one.test/a.jpg', signal(), async () => { started(); await waitForDownload(60, signal()); throw new Error('network'); }, env);
  const failure = expect(first).rejects.toThrow('network'); await ready;
  const queued = withDownloadSlot('https://two.test/a.jpg', abort.signal, async () => { called = true; }, env);
  const cancelled = expect(queued).rejects.toThrow('cancelled'); abort.abort(new Error('cancelled'));
  await Promise.all([failure, cancelled]); expect(called).toBe(false);
  expect(await withDownloadSlot('https://three.test/a.jpg', signal(), async () => 'ok', env)).toBe('ok');
});
it.each(['high', 'medium', 'xhigh', 'max'])('lowering %s stops new starts until old transfers fit the new cap', async speed => {
  const { env, values } = fixture(speed); let active = 0;
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  let ready!: () => void; const allStarted = new Promise<void>(resolve => { ready = resolve; });
  const requests = Array.from({ length: 6 }, (_, index) => withDownloadSlot(`https://same-policy.test/${index}.jpg`, signal(), async () => {
    active++; if (active === 6) ready(); await hold; active--;
  }, env, `task-${index}`));
  await allStarted; values.downloadSpeed = 'low'; let newStarted = false;
  const next = withDownloadSlot('https://same-policy.test/new.jpg', signal(), async () => { newStarted = true; expect(active).toBe(0); }, env);
  await waitForDownload(120, signal()); expect(newStarted).toBe(false);
  release(); await Promise.all([...requests, next]); expect(newStarted).toBe(true);
});
it('parses Retry-After seconds and HTTP dates', () => {
  const now = Date.UTC(2026, 9, 23);
  expect(retryAfterDelay('120', now)).toBe(120000);
  expect(retryAfterDelay(new Date(now + 90000).toUTCString(), now)).toBe(90000);
  expect(retryAfterDelay('invalid', now)).toBeUndefined(); expect(retryAfterDelay(null, now)).toBeUndefined();
});
it.each(['low', 'medium', 'high', 'xhigh', 'max', 'unlimited'])('%s shares server cooldown across clients without blocking unrelated hosts', async speed => {
  const { env, values } = fixture(speed);
  await noteDownloadResponse('https://busy.test/a.jpg', new Response(null, { status: 429, headers: { 'retry-after': '120' } }), env);
  const state = values.downloadRateState as { cooldowns: Record<string, number> };
  expect(state.cooldowns['https://busy.test']! - env.now()).toBeGreaterThan(119000);
  const abort = new AbortController(); let requested = false;
  const blocked = withDownloadSlot('https://busy.test/b.jpg', abort.signal, async () => { requested = true; }, env);
  const cancelled = expect(blocked).rejects.toThrow('stop');
  expect(await withDownloadSlot('https://free.test/a.jpg', signal(), async () => 'ok', { ...env })).toBe('ok');
  abort.abort(new Error('stop')); await cancelled; expect(requested).toBe(false);
});
it('local data images do not consume network slots or pacing', async () => {
  const { env, values } = fixture();
  expect(await withDownloadSlot('data:image/svg+xml,test', signal(), async () => 'ok', env)).toBe('ok');
  expect(values.downloadRateState).toBeUndefined();
});

it.each([50, 100])('paces real starts after injected %i ms query and storage delays', async delay => {
  const { env } = fixture('max');
  let now = 10000, queries = 0, writes = 0;
  const delayed: RateEnvironment = {
    ...env,
    locks: {
      request: env.locks.request.bind(env.locks),
      query: async () => {
        if (queries++ === 0) { await Promise.resolve(); now += delay; }
        return env.locks.query();
      },
    } as unknown as LockManager,
    now: () => now,
    wait: async (ms, aborted) => { aborted.throwIfAborted(); now += ms; },
    set: async values => {
      if (writes++ === 0) { await Promise.resolve(); now += delay; }
      await env.set(values);
    },
  };
  const starts: number[] = [];
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const first = withDownloadSlot('https://delayed.test/first.jpg', signal(), async () => {
    starts.push(now); entered(); await hold;
  }, delayed);
  try {
    await ready;
    await withDownloadSlot('https://delayed-other.test/second.jpg', signal(), async () => { starts.push(now); }, delayed);
    await withDownloadSlot('https://delayed.test/third.jpg', signal(), async () => { starts.push(now); }, delayed);
    expect(starts[0]).toBe(10000 + delay * 2);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(50);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(50);
  } finally { release(); await first; }
});

it('does not start work when storage fails and releases every acquired lock', async () => {
  const { env } = fixture('max'); let called = false;
  await expect(withDownloadSlot('https://storage.test/a.jpg', signal(), async () => { called = true; }, {
    ...env, set: async () => { throw new Error('storage unavailable'); },
  })).rejects.toThrow('storage unavailable');
  expect(called).toBe(false);
  expect((await env.locks.query()).held?.filter(lock => lock.name?.startsWith('image-extractor-download-'))).toEqual([]);
  expect(await withDownloadSlot('https://storage.test/b.jpg', signal(), async () => 'ok', env)).toBe('ok');
});

it('does not start work when cancelled during storage and releases pacing leases', async () => {
  const { env } = fixture('max'); const abort = new AbortController();
  let release!: () => void, writing!: () => void, called = false;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { writing = resolve; });
  const pending = withDownloadSlot('https://cancel-write.test/a.jpg', abort.signal, async () => { called = true; }, {
    ...env, set: async values => { writing(); await hold; await env.set(values); },
  });
  const result = expect(pending).rejects.toThrow('stop during storage');
  try { await ready; abort.abort(new Error('stop during storage')); }
  finally { release(); await result; }
  expect(called).toBe(false);
  expect((await env.locks.query()).held?.filter(lock => lock.name?.startsWith('image-extractor-download-'))).toEqual([]);
});

it('does not start work when a pacing lock fails and releases its sibling lease', async () => {
  const { env } = fixture('max'); let called = false;
  const broken: RateEnvironment = {
    ...env,
    locks: {
      query: env.locks.query.bind(env.locks),
      request: (name: string, ...args: unknown[]) => name === 'image-extractor-download-pacing:https://lease-failure.test'
        ? Promise.reject(new Error('pacing lock unavailable'))
        : (env.locks.request as Function).call(env.locks, name, ...args),
    } as unknown as LockManager,
  };
  await expect(withDownloadSlot('https://lease-failure.test/a.jpg', signal(), async () => { called = true; }, broken)).rejects.toThrow('pacing lock unavailable');
  expect(called).toBe(false);
  expect((await env.locks.query()).held?.filter(lock => lock.name?.startsWith('image-extractor-download-'))).toEqual([]);
});

it('releases cancelled work immediately while its thirty-second recovery pacing remains in force', async () => {
  const { env, values } = fixture('low');
  values.downloadRateState = { sites: { 'https://long-recovery.test': { penalty: 5 } } };
  let now = 10000;
  const timers = new Set<{ until: number; finish(): void }>();
  const controlled: RateEnvironment = {
    ...env, now: () => now,
    wait: (ms, abort) => new Promise<void>((resolve, reject) => {
      abort.throwIfAborted();
      const cancel = () => { timers.delete(timer); reject(abort.reason); };
      const timer = { until: now + ms, finish: () => { timers.delete(timer); abort.removeEventListener('abort', cancel); resolve(); } };
      timers.add(timer); abort.addEventListener('abort', cancel, { once: true });
    }),
  };
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
  const advance = async (ms: number) => {
    now += ms;
    for (const timer of [...timers]) if (timer.until <= now) timer.finish();
    await flush();
  };
  const abort = new AbortController(), nextAbort = new AbortController();
  let started!: () => void, finished = false, nextStarted: number | undefined;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const first = withDownloadSlot('https://long-recovery.test/first.jpg', abort.signal, () => new Promise<never>((_, reject) => {
    started(); abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true });
  }), controlled);
  const cancelled = expect(first).rejects.toThrow('cancel active transfer').finally(() => { finished = true; });
  let next: Promise<void> | undefined;
  try {
    await ready; abort.abort(new Error('cancel active transfer')); await flush();
    expect(finished).toBe(true);
    expect(now).toBe(10000);
    const held = (await env.locks.query()).held || [];
    expect(held.some(lock => lock.name?.startsWith('image-extractor-download-slot:'))).toBe(false);
    expect(held.some(lock => lock.name === 'image-extractor-download-pacing:https://long-recovery.test')).toBe(true);
    next = withDownloadSlot('https://long-recovery.test/next.jpg', nextAbort.signal, async () => { nextStarted = now; }, controlled);
    void next.catch(() => {});
    await flush();
    for (let i = 0; i < 59; i++) await advance(500);
    expect(nextStarted).toBeUndefined();
    await advance(500);
    expect(nextStarted).toBe(40000);
    await next;
    expect((await env.locks.query()).held?.some(lock => lock.name?.startsWith('image-extractor-download-slot:'))).toBe(false);
  } finally {
    abort.abort(); nextAbort.abort(); await advance(60000);
    await Promise.allSettled([cancelled, ...(next ? [next] : [])]);
  }
});

it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)('%s lets a single task use spare global slots across different sources', async speed => {
  const { env } = fixture(speed);
  await heldTransfers(env, Array.from({ length: MAX_GLOBAL_DOWNLOADS + 5 }, (_, index) => `https://task-source-${index}.test/a.jpg`), MAX_GLOBAL_DOWNLOADS, true);
});

it('paces each source independently so a busy source does not delay another source', async () => {
  const { env } = fixture('medium');
  let now = 10000;
  const abort = new AbortController();
  const timers = new Set<{ until: number; finish(): void }>();
  const controlled: RateEnvironment = {
    ...env, now: () => now,
    wait: (ms, signal) => new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const cancel = () => { timers.delete(timer); reject(signal.reason); };
      const timer = { until: now + ms, finish: () => { timers.delete(timer); signal.removeEventListener('abort', cancel); resolve(); } };
      timers.add(timer); signal.addEventListener('abort', cancel, { once: true });
    }),
  };
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
  const advance = async (ms: number) => {
    now += ms;
    for (const timer of [...timers]) if (timer.until <= now) timer.finish();
    await flush();
  };
  const starts = new Map<string, number>();
  const operations: Promise<void>[] = [];
  try {
    await withDownloadSlot('https://a.test/first.jpg', abort.signal, async () => { starts.set('a1', now); }, controlled, 'a1');
    for (const [host, name] of [['a', 'a2'], ['b', 'b1']] as const) {
      const operation = withDownloadSlot(`https://${host}.test/next.jpg`, abort.signal, async () => { starts.set(name, now); }, controlled, name);
      void operation.catch(() => {}); operations.push(operation);
    }
    await flush(); await advance(149);
    expect([...starts.keys()]).toEqual(['a1']);
    await advance(1);
    expect(starts.get('b1')).toBe(10150);
    expect(starts.has('a2')).toBe(false);
    await advance(349);
    expect(starts.has('a2')).toBe(false);
    await advance(1);
    expect(starts.get('a2')).toBe(10500);
    await Promise.all(operations);
  } finally {
    abort.abort(); await advance(1000); await Promise.allSettled(operations);
  }
});

it('shares one source budget across imx.to CDN shards and keeps recovery requests conservative', async () => {
  const { env, values } = fixture('medium');
  let now = 100000;
  const timed = { ...env, now: () => now, wait: async (ms: number) => { now += ms; } };
  const starts: number[] = [];
  await withDownloadSlot('https://i.imx.to/a.jpg', signal(), async () => { starts.push(now); }, timed);
  await withDownloadSlot('https://i02.imx.to/b.jpg', signal(), async () => { starts.push(now); }, timed);
  expect(starts[1]! - starts[0]!).toBe(500);
  await noteDownloadResponse('https://i02.imx.to/a.jpg', new Response(null, { status: 429 }), timed);
  const state = () => values.downloadRateState as { cooldowns: Record<string, number>; sites: Record<string, { penalty: number; successes: number }> };
  expect(state().sites['imx.to']!.penalty).toBe(1);
  // Several in-flight responses from the same burst do not multiply the penalty.
  await noteDownloadResponse('https://i.imx.to/c.jpg', new Response(null, { status: 429 }), timed);
  expect(state().sites['imx.to']!.penalty).toBe(1);
  now = state().cooldowns['imx.to']! + 1;
  await noteDownloadResponse('https://i.imx.to/a.jpg', new Response(null, { status: 503 }), timed);
  expect(state().sites['imx.to']!.penalty).toBe(2);
  expect(state().cooldowns['imx.to']! - now).toBe(60000);
  now = state().cooldowns['imx.to']! + 1;
  const recoveredStarts: number[] = [];
  await withDownloadSlot('https://i02.imx.to/first.jpg', signal(), async () => { recoveredStarts.push(now); }, timed);
  await withDownloadSlot('https://i.imx.to/second.jpg', signal(), async () => { recoveredStarts.push(now); }, timed);
  expect(recoveredStarts[1]! - recoveredStarts[0]!).toBe(2000);
  for (let i = 0; i < 8; i++) await noteDownloadResponse('https://i.imx.to/a.jpg', new Response('ok'), timed);
  expect(state().sites['imx.to']!.penalty).toBe(1);
  for (let i = 0; i < 8; i++) await noteDownloadResponse('https://i02.imx.to/a.jpg', new Response('ok'), timed);
  expect(state().sites['imx.to']!.penalty).toBe(0);
});

it('allows only one recovering source transfer even when the selected policy permits more', async () => {
  const { env, values } = fixture('medium');
  values.downloadRateState = { sites: { 'https://recover.test': { penalty: 1 } } };
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const first = withDownloadSlot('https://recover.test/a.jpg', signal(), async () => { started(); await hold; }, env, 'first');
  await ready;
  const abort = new AbortController();
  let called = false;
  const second = withDownloadSlot('https://recover.test/b.jpg', abort.signal, async () => { called = true; }, env, 'second');
  const cancelled = expect(second).rejects.toThrow('stop');
  await waitForDownload(150, signal());
  expect(called).toBe(false);
  abort.abort(new Error('stop')); release(); await Promise.all([first, cancelled]);
});

it('honors long Retry-After and recovers both original and redirected source budgets', async () => {
  const { env, values } = fixture();
  let now = 10000;
  const timed = { ...env, now: () => now };
  const limited = new Response(null, { status: 429, headers: { 'retry-after': '3600' } });
  Object.defineProperty(limited, 'url', { value: 'https://cdn.test/final.jpg' });
  await noteDownloadResponse('https://redirect.test/a.jpg', limited, timed);
  const state = () => values.downloadRateState as { cooldowns: Record<string, number>; sites: Record<string, { penalty: number }> };
  expect(state().cooldowns['https://cdn.test']! - now).toBe(3600000);
  now += 3600001;
  const success = new Response('image');
  Object.defineProperty(success, 'url', { value: 'https://cdn.test/final.jpg' });
  for (let i = 0; i < 8; i++) await noteDownloadResponse('https://redirect.test/a.jpg', success, timed);
  expect(state().sites['https://redirect.test']!.penalty).toBe(0);
  expect(state().sites['https://cdn.test']!.penalty).toBe(0);
});
it('groups new detail-page providers and their image CDN aliases under the same download budget', async () => {
  const { downloadScope } = await import('../lib/downloadSpeed');
  for (const [page, image] of [
    ['https://postimg.cc/abc', 'https://i.postimg.cc/abc/sample.jpg'],
    ['https://pixxxels.cc/abc', 'https://i.postimg.cc/abc/sample.jpg'],
    ['https://www.turboimagehost.com/p/1/a.html', 'https://s1d1.turboimg.net/sample.jpg'],
    ['https://www.imagevenue.com/ME12345678', 'https://img123.imagevenue.com/sample.jpg'],
    ['https://imagetwist.com/abcdefgh1234', 'https://img200.imagetwist.com/i/sample.jpg'],
  ]) expect(downloadScope(page!)).toBe(downloadScope(image!));
  expect(downloadScope('https://imagetwist.com.evil.test/sample.jpg')).toBe('https://imagetwist.com.evil.test');
});
