import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { ORIGINAL_RESOLVER_VERSION } from '../lib/originalImageResolver.js';

// Offline production-bundle check. No Chrome process or network is used.
const buildRoot = new URL(`../${process.env.EXTENSION_BUILD_DIR || '.output/chrome-mv3'}/`, import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', buildRoot), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(manifest.version, pkg.version, 'Run npm run build before checking the bundle');
// Multiple WXT sub-builds share one output directory; make sure the final license files are complete.
const licenses = await readFile(new URL('THIRD_PARTY_LICENSES.md', buildRoot), 'utf8');
for (const name of ['react', 'react-dom', '@radix-ui/react-select', 'lucide-react', 'client-zip', 'class-variance-authority', 'clsx', 'tailwind-merge'])
  assert.ok(licenses.includes(`\n## ${name} - `), `THIRD_PARTY_LICENSES.md is missing ${name}`);
assert.ok(licenses.includes('as part of Feather') && licenses.includes('for portions derived from Feather'), 'Lucide ISC and Feather MIT texts must both be kept');
assert.ok(licenses.includes('Apache License'), 'class-variance-authority Apache-2.0 text is missing');
const notices = await readFile(new URL('THIRD_PARTY_NOTICES.md', buildRoot), 'utf8');
assert.ok(notices.includes('Copyright (c) 2023 shadcn'), 'shadcn/ui license is missing');
for (const entry of licenses.split('\n## ').slice(1)) {
  const [heading, ...body] = entry.split('\n');
  if (body.join('\n').trim()) continue;
  assert.equal(heading, 'react-remove-scroll-bar - 2.3.8 (MIT)', `Missing license text: ${heading}`);
  assert.ok(notices.includes('## react-remove-scroll-bar 2.3.8 (MIT)') && notices.includes('Copyright (c) 2025 Anton Korzunov'), 'Supplemental react-remove-scroll-bar license is missing');
}
const storage = {};
const local = {};
const listeners = {};
let granted = false;
let messageHandler;
let injections = 0;
let serializedCollector;
let taskTabId = 98;
const taskTabs = new Map();
const pageUrl = 'https://example.org/gallery';
const images = Array.from({ length: 1000 }, (_, i) => {
  const src = i === 0 ? 'https://image.imx.to/u/t/2026/09/26/765kix.jpg' : `https://t01.imx.to/t/2026/05/24/mountain-${i}.jpg`;
  return { currentSrc: src, alt: `Mountain ${i}`, naturalWidth: 200, naturalHeight: 300, closest: () => null, getAttribute: key => key === 'src' ? src : null };
});
const chrome = {
  runtime: { id: 'bundle-smoke', getURL: path => `chrome-extension://bundle-smoke${path}`, onMessage: { addListener: listener => { messageHandler = listener; } }, onStartup: { addListener: listener => { listeners.startup = listener; } } },
  permissions: { contains: async () => granted, onAdded: { addListener: listener => { listeners.added = listener; } }, onRemoved: { addListener: listener => { listeners.removed = listener; } } },
  tabs: { get: async id => taskTabs.get(id) || ({ id, url: id === 2 ? pageUrl + '-b' : pageUrl }), create: async options => { assert.equal(options.active, false); const tab = { id: ++taskTabId, url: options.url }; taskTabs.set(tab.id, tab); return tab; }, update: async (id, options) => { assert.equal(options.active, true); return taskTabs.get(id); }, onUpdated: { addListener: listener => { listeners.updated = listener; } }, onRemoved: { addListener: listener => { listeners.tabRemoved = listener; } } },
  storage: { local: { get: async () => structuredClone(local), set: async value => Object.assign(local, structuredClone(value)) }, session: { get: async () => structuredClone(storage), set: async value => Object.assign(storage, structuredClone(value)), remove: async key => { delete storage[key]; } } },
  scripting: { executeScript: async ({ func, injectImmediately, target }) => {
    const captureUrl = target.tabId === 2 ? pageUrl + '-b' : pageUrl;
    assert.equal(injectImmediately, true);
    injections++;
    serializedCollector = func.toString();
    // Chrome serializes the function into a separate page execution context.
    const result = vm.runInNewContext(`(${func.toString()})()`, { document: { title: target.tabId === 2 ? 'Page B fixture' : 'Local landscape fixture', baseURI: captureUrl, querySelectorAll: () => images, querySelector: () => null }, location: { href: captureUrl } });
    return [{ result }];
  } },
};
vm.runInNewContext(await readFile(new URL('background.js', buildRoot), 'utf8'), { chrome, URL, TextEncoder, crypto: webcrypto, console, setTimeout, clearTimeout });
assert.equal(chrome.downloads, undefined);
assert.equal(typeof listeners.updated, 'function');
async function send(message) {
  let timer;
  try {
    return await Promise.race([
      new Promise(resolve => { assert.equal(messageHandler(message, { id: chrome.runtime.id }, resolve), true); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`No response to ${message.type}`)), 1000); }),
    ]);
  } finally { clearTimeout(timer); }
}
assert.equal((await send({ type: 'RESUME_DOWNLOADS' })).ok, true);
const start = performance.now();
const analysisResponse = await send({ type: 'ANALYZE', tabId: 1, mode: 'large' });
assert.equal(analysisResponse.ok, true);
assert.equal(analysisResponse.analysis.status, 'done');
assert.equal(analysisResponse.analysis.job, storage['analysis:1'].job);
const elapsed = Number((performance.now() - start).toFixed(2));
assert.equal(storage['analysis:1'].status, 'done');
assert.equal(storage['analysis:1'].resolverVersion, ORIGINAL_RESOLVER_VERSION + ':sources-v5');
assert.equal(storage['analysis:1'].results.find(image => image.candidate && image.source === images[0].currentSrc).url, 'https://i02.imx.to/i/2026/09/26/765kix.jpg');
assert.equal(storage['analysis:1'].results.filter(image => image.candidate).length, 1000);
assert.equal(storage['analysis:1'].results.filter(image => !image.candidate).length, 1000);
assert.equal(storage['analysis:1'].selected.length, 1000);
assert.equal(storage['analysis:1'].title, 'Local landscape fixture');
assert.equal((await send({ type: 'DOWNLOAD', job: storage['analysis:1'].job, selected: storage['analysis:1'].selected })).ok, false);

const changedListeners = new Set();
const downloads = new Map();
let started = 0;
chrome.downloads = {
  onChanged: { addListener: listener => changedListeners.add(listener), removeListener: listener => changedListeners.delete(listener) },
  download: async () => { const id = ++started; downloads.set(id, { id, state: 'in_progress' }); return id; },
  search: async ({ id }) => [downloads.get(id)],
};
granted = true;
listeners.added({ permissions: ['downloads'] });
assert.equal((await send({ type: 'DOWNLOAD', job: storage['analysis:1'].job, selected: storage['analysis:1'].selected.slice(0, 2) })).ok, true);
assert.equal(changedListeners.size, 1);
for (let id = 1; id <= 2; id++) {
  downloads.get(id).state = 'complete';
  for (const listener of changedListeners) listener({ id, state: { current: 'complete' } });
  await send({ type: 'RESUME_DOWNLOADS' });
}
assert.equal(started, 2);
assert.deepEqual(storage.downloadBatch.jobs.map(job => job.status), ['complete', 'complete']);
assert.equal((await send({ type: 'DOWNLOAD_ZIP', job: storage['analysis:1'].job, selected: storage['analysis:1'].selected })).ok, true);
const archive = Object.values(local).find(value => value?.sourceTabId === 1);
assert.equal(archive.filename, 'Local landscape fixture.zip');
assert.equal(archive.items[0].filename, '001_765kix.jpeg');
assert.equal(archive.items[999].filename, '1000_mountain-999.jpeg');
assert.equal(archive.tabId, 99);
const pageAJob = storage['analysis:1'].job;
assert.equal((await send({ type: 'ANALYZE', tabId: 2, mode: 'large' })).ok, true);
assert.equal((await send({ type: 'DOWNLOAD_ZIP', job: storage['analysis:2'].job, selected: storage['analysis:2'].selected.slice(0, 1) })).ok, true);
const archives = Object.values(local).filter(value => value?.sourceTabId);
assert.equal(archives.length, 2);
assert.equal(archives.find(value => value.sourceTabId === 2).filename, 'Page B fixture.zip');
assert.equal(archives.find(value => value.sourceTabId === 2).tabId, 99);
assert.equal(taskTabs.size, 1);
assert.equal((await send({ type: 'OPEN_ARCHIVES' })).tabId, 99);
assert.equal(archives.find(value => value.sourceTabId === 1).id, archive.id);
assert.equal(archives.find(value => value.sourceTabId === 1).items.length, 1000);
assert.equal(storage['analysis:1'].job, pageAJob);
assert.equal((await send({ type: 'DOWNLOAD_ZIP', job: pageAJob, selected: storage['analysis:1'].selected })).ok, false);
console.log(JSON.stringify({ pageIsolation: 'passed A and B concurrent tasks with independent selections', version: manifest.version, productionBundleStartup: 'passed without downloads API', serializedCollector: 'passed', inputs: images.length, large: 1000, small: 1000, mockAnalysisMs: elapsed, injections, permissionGrantAndQueue: 'passed', zipTaskSnapshot: 'passed' }));

// Exercise new imported-HTML/SVG branches in the actual serialized production function.
const dom = new Window({ url: 'https://example.org/' });
const html = '<base href="https://cdn.example.org/pics/"><img src="one.jpg"><svg><symbol id="icon" viewBox="0 0 24 24"><path d="M0 0h24v24z"/></symbol></svg><svg viewBox="0 0 24 24"><use href="#icon"/></svg>';
const imported = vm.runInNewContext(`(${serializedCollector})({inline:true}, imported)`, { document: dom.document, URL, XMLSerializer: dom.XMLSerializer, imported: { html, url: '', title: 'saved.html' } });
assert.equal(imported.baseUrl, 'https://cdn.example.org/pics/');
const inline = imported.images.filter(image => image.source.startsWith('data:')).at(-1);
assert.match(decodeURIComponent(inline.source), /symbol[^>]+id="icon"/);
assert.match(decodeURIComponent(inline.source), /M0 0h24v24z/);
await dom.happyDOM.close();
console.log(JSON.stringify({ importedAbsoluteBase: 'passed', serializedSvgDependencies: 'passed' }));

const execute = chrome.scripting.executeScript;
chrome.scripting.executeScript = async options => {
  const capture = await execute(options);
  delete storage[`analysis:${options.target.tabId}`];
  return capture;
};
const interrupted = await send({ type: 'ANALYZE', tabId: 4 });
assert.equal(interrupted.ok, false);
assert.match(interrupted.message, /页面或分析任务已变化/);
chrome.scripting.executeScript = async () => { throw new Error('fixture injection failed'); };
const failed = await send({ type: 'ANALYZE', tabId: 5 });
assert.equal(failed.analysis.status, 'error');
assert.ok(failed.analysis.message.length > 0);
assert.equal(failed.analysis.message, storage['analysis:5'].message);
chrome.scripting.executeScript = execute;
console.log(JSON.stringify({ analysisResponse: 'passed', invalidatedJob: 'explicit error', injectionFailure: 'explicit error' }));

// Optional DOM-only capture from a user-reported page; never requests image bytes.
if (process.env.IMAGE_CAPTURE_FIXTURE) {
  const fixture = JSON.parse(await readFile(process.env.IMAGE_CAPTURE_FIXTURE, 'utf8'));
  const replay = new Window({ url: fixture.url });
  chrome.tabs.get = async id => ({ id, url: fixture.url });
  chrome.scripting.executeScript = async ({ func }) => [{ result: vm.runInNewContext(`(${func.toString()})({}, imported)`, {
    document: replay.document, URL, imported: fixture,
  }) }];
  const result = await send({ type: 'ANALYZE', tabId: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.analysis.status, 'done');
  const originals = result.analysis.results.filter(image => image.candidate && new URL(image.url).hostname === 'i02.imx.to');
  assert.equal(originals.length, 200);
  assert.ok(originals.some(image => image.url === 'https://i02.imx.to/i/2026/05/24/6s79sr.jpg'));
  assert.equal(result.analysis.selected.length, 200);
  await replay.happyDOM.close();
  console.log(JSON.stringify({ actualPageDomReplay: 'passed', originals: originals.length, selected: result.analysis.selected.length }));
}
