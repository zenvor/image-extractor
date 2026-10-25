export const DOWNLOAD_SPEED_KEY = 'downloadSpeed';
/** Hard ceiling shared by all task pages, regardless of the selected policy. */
export const MAX_GLOBAL_DOWNLOADS = 30;
export const DOWNLOAD_SPEEDS = {
  low: { label: '低', concurrency: MAX_GLOBAL_DOWNLOADS, perOrigin: 5, interval: 2000, globalInterval: 250, description: '全局共享 30 张、同来源 5 张；同来源启动间隔至少 2 秒' },
  medium: { label: '中等', concurrency: MAX_GLOBAL_DOWNLOADS, perOrigin: 10, interval: 500, globalInterval: 150, description: '全局共享 30 张、同来源 10 张；同来源启动间隔至少 0.5 秒' },
  high: { label: '高', concurrency: MAX_GLOBAL_DOWNLOADS, perOrigin: 20, interval: 100, globalInterval: 100, description: '全局共享 30 张、同来源 20 张；同来源启动间隔至少 0.1 秒' },
  xhigh: { label: '极高', concurrency: MAX_GLOBAL_DOWNLOADS, perOrigin: 25, interval: 75, globalInterval: 75, description: '全局共享 30 张、同来源 25 张；同来源启动间隔至少 0.075 秒' },
  max: { label: '超高', concurrency: MAX_GLOBAL_DOWNLOADS, perOrigin: MAX_GLOBAL_DOWNLOADS, interval: 50, globalInterval: 50, description: '全局共享 30 张、同来源 30 张；同来源启动间隔至少 0.05 秒' },
} as const;
export type DownloadSpeed = keyof typeof DOWNLOAD_SPEEDS;
export function downloadSpeed(value: unknown): DownloadSpeed {
  // Retired unlimited settings fall back to the balanced default.
  return value === 'low' || value === 'high' || value === 'xhigh' || value === 'max' ? value : 'medium';
}

const GATE = 'image-extractor-download-admission';
const SLOT = 'image-extractor-download-slot:';
const PACE = 'image-extractor-download-pacing:';
const STATE_KEY = 'downloadRateState';
type SiteState = { lastStart?: number; penalty?: number; successes?: number };
type RateState = { lastStart?: number; cooldowns?: Record<string, number>; sites?: Record<string, SiteState> };

/** Known image-host shards share one budget; unrelated tenants retain separate origins. */
export function downloadScope(url: string) {
  const parsed = new URL(url);
  for (const provider of ['imx.to', 'vipr.im', 'pixhost.to', 'imagebam.com', 'imgbox.com']) {
    if (parsed.hostname === provider || parsed.hostname.endsWith('.' + provider)) return provider;
  }
  return parsed.origin;
}
export interface RateEnvironment {
  locks: LockManager;
  get(): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  now(): number;
  wait(ms: number, signal: AbortSignal): Promise<void>;
}
export function waitForDownload(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
function environment(): RateEnvironment {
  if (!navigator.locks) throw new Error('浏览器不支持下载限速，请更新 Chrome 后重试。');
  return {
    locks: navigator.locks,
    get: () => chrome.storage.local.get([DOWNLOAD_SPEED_KEY, STATE_KEY]),
    set: values => chrome.storage.local.set(values),
    now: Date.now, wait: waitForDownload,
  };
}

/** Locks are shared by all extension task pages, and released if a page closes.
 * Hold a slot until the entire response body has been written, not just headers.
 * Only short admission checks hold GATE; a cooling-down host cannot block others.
 */
export async function withDownloadSlot<T>(url: string, signal: AbortSignal, work: () => Promise<T>, env = environment(), taskId = 'default'): Promise<T> {
  signal.throwIfAborted();
  if (url.startsWith('data:')) return work();
  const origin = new URL(url).origin;
  const site = downloadScope(url);
  const task = encodeURIComponent(taskId);
  const prefix = `${SLOT}${encodeURIComponent(site)}:`;
  const taskPrefix = `${prefix}${task}:`;
  while (true) {
    signal.throwIfAborted();
    const admitted = await env.locks.request(GATE, { signal }, async () => {
      signal.throwIfAborted();
      const values = await env.get();
      const policy = DOWNLOAD_SPEEDS[downloadSpeed(values[DOWNLOAD_SPEED_KEY])];
      const state = (values[STATE_KEY] || {}) as RateState;
      const now = env.now();
      const siteState = state.sites?.[site] || {};
      const penalty = siteState.penalty || 0;
      const recovering = penalty > 0 && policy.interval > 0;
      const interval = recovering ? Math.min(30000, policy.interval * 2 ** penalty) : policy.interval;
      const next = Math.max((state.lastStart ?? -Infinity) + policy.globalInterval,
        (siteState.lastStart ?? -Infinity) + interval,
        state.cooldowns?.[site] || 0, state.cooldowns?.[origin] || 0);
      if (next > now) return { wait: Math.min(next - now, 500) };
      const { held = [] } = await env.locks.query();
      // Storage and lock acquisition are asynchronous. Keep pacing leases from
      // the actual work invocation so delayed admission cannot bunch requests.
      if (held.some(lock => lock.name === PACE + 'global' || lock.name === PACE + site)) return { wait: 50 };
      const active = held.filter(lock => lock.name?.startsWith(SLOT));
      if (active.length >= Math.min(MAX_GLOBAL_DOWNLOADS, policy.concurrency)
        || active.filter(lock => lock.name?.startsWith(prefix)).length >= (recovering ? 1 : policy.perOrigin)) return { wait: 250 };
      const occupied = new Set(active.map(lock => lock.name));
      let slot = 0;
      while (occupied.has(taskPrefix + slot)) slot++;
      signal.throwIfAborted();
      let entered!: () => void;
      const ready = new Promise<void>(resolve => { entered = resolve; });
      const operation = env.locks.request(taskPrefix + slot, { signal }, async () => {
        let started = false;
        let start!: (time: number | undefined) => void;
        const starting = new Promise<number | undefined>(resolve => { start = resolve; });
        const pacing = [ [PACE + 'global', policy.globalInterval], [PACE + site, interval] ] as const;
        const leases = pacing.map(([name, duration]) => {
          let acquired!: () => void;
          let failed!: (reason: unknown) => void;
          const ready = new Promise<void>((resolve, reject) => { acquired = resolve; failed = reject; });
          const operation = env.locks.request(name, { signal }, async () => {
            acquired();
            const time = await starting;
            if (time !== undefined) {
              const pacingSignal = new AbortController().signal;
              let remaining: number;
              while ((remaining = time + duration - env.now()) > 0) await env.wait(remaining, pacingSignal);
            }
          });
          // A cancelled acquisition must also release the admission handshake.
          void operation.catch(failed);
          return { ready, operation };
        });
        try {
          await Promise.all(leases.map(lease => lease.ready));
          signal.throwIfAborted();
          // This write is deliberately before work: storage errors must not
          // start a transfer. Pacing leases cover any delay in this write.
          const admittedAt = env.now();
          await env.set({ [STATE_KEY]: { ...state, lastStart: admittedAt, sites: { ...state.sites, [site]: { ...siteState, lastStart: admittedAt } } } });
          signal.throwIfAborted();
          start(env.now());
          started = true;
          entered();
          return await work();
        } finally {
          start(undefined);
          entered();
          const settled = Promise.allSettled(leases.map(lease => lease.operation));
          // Once work starts, pacing continues independently of its body/slot.
          // Completing or cancelling a transfer must not wait out a host penalty.
          // Before work starts, fully release acquisitions on failure/cancellation.
          if (!started) await settled;
        }
      });
      // Observe early errors while waiting for admission; the caller still receives them.
      void operation.catch(() => entered());
      await ready;
      return { operation };
    });
    if ('operation' in admitted) return await admitted.operation!;
    await env.wait(admitted.wait!, signal);
  }
}

export function retryAfterDelay(value: string | null, now: number): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) && delay >= 0 ? delay : undefined;
}

/** Respect server backpressure for every task targeting the same origin. */
export async function noteDownloadResponse(url: string, response: Response, env = environment()) {
  if (!response.ok && response.status !== 429 && response.status !== 503) return;
  const site = downloadScope(url);
  const finalSite = response.url && /^https?:/.test(response.url) ? downloadScope(response.url) : site;
  await env.locks.request(GATE, async () => {
    const values = await env.get();
    const state = (values[STATE_KEY] || {}) as RateState;
    const now = env.now();
    const previous = state.sites?.[site] || {};
    if (response.ok) {
      const sites = { ...state.sites };
      let changed = false;
      for (const key of new Set([site, finalSite])) {
        const current = sites[key];
        if (!current?.penalty || (state.cooldowns?.[key] || 0) > now) continue;
        const successes = (current.successes || 0) + 1;
        const restored = successes >= 8;
        sites[key] = { ...current, penalty: restored ? current.penalty - 1 : current.penalty, successes: restored ? 0 : successes };
        changed = true;
      }
      if (changed) await env.set({ [STATE_KEY]: { ...state, sites } });
      return;
    }
    const cooldowns = Object.fromEntries(Object.entries(state.cooldowns || {}).filter(([, until]) => until > now));
    // Multiple responses from one burst count as one incident, not exponential amplification.
    const previousPenalty = Math.max(previous.penalty || 0, state.sites?.[finalSite]?.penalty || 0);
    const penalty = cooldowns[site] || cooldowns[finalSite] ? Math.max(1, previousPenalty) : Math.min(5, previousPenalty + 1);
    const baseDelay = Math.min(900000, (response.status === 429 ? 60000 : 30000) * 2 ** (penalty - 1));
    const delay = Math.max(baseDelay, retryAfterDelay(response.headers.get('retry-after'), now) || 0);
    cooldowns[site] = Math.max(cooldowns[site] || 0, now + delay);
    // Redirected CDN responses also cool down their final origin.
    cooldowns[finalSite] = Math.max(cooldowns[finalSite] || 0, now + delay);
    const sites = { ...state.sites, [site]: { ...previous, penalty, successes: 0 } };
    if (finalSite !== site) sites[finalSite] = { ...sites[finalSite], penalty: Math.max(penalty, sites[finalSite]?.penalty || 0), successes: 0 };
    await env.set({ [STATE_KEY]: { ...state, cooldowns, sites } });
  });
}
