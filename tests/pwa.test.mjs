import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root = existsSync(new URL('../dist/index.html', import.meta.url))
  ? new URL('../dist/', import.meta.url)
  : new URL('../', import.meta.url);
const workerCode = await readFile(new URL('sw.js', root), 'utf8');

function workerHarness(base = 'https://example.github.io/dhikr/') {
  const listeners = new Map();
  const buckets = new Map();
  const network = {offline:false, failPath:null, requests:[]};
  const lifecycle = {claimed:false, skipWaitingCalled:false};
  const fetch = async request => {
    const url = typeof request === 'string' ? request : request.url;
    network.requests.push(url);
    if (network.offline) throw new TypeError('Network unavailable');
    return new Response('file:' + new URL(url).pathname, {status:new URL(url).pathname === network.failPath ? 503 : 200});
  };
  const caches = {
    keys:async () => [...buckets.keys()],
    delete:async name => buckets.delete(name),
    open:async name => {
      if (!buckets.has(name)) buckets.set(name, new Map());
      const bucket = buckets.get(name);
      return {
        addAll:async requests => {
          const results = await Promise.all(requests.map(async request => {
            const response = await fetch(request);
            if (!response.ok) throw new TypeError('A required asset failed');
            return [request.url, response];
          }));
          for (const [url, response] of results) bucket.set(url, response);
        },
        match:async key => bucket.get(typeof key === 'string' ? key : key.url)?.clone()
      };
    }
  };
  const self = {
    location:{href:new URL('sw.js', base).href},
    registration:{scope:base},
    clients:{claim:async () => {lifecycle.claimed = true;}},
    skipWaiting:() => {lifecycle.skipWaitingCalled = true;},
    addEventListener:(type, handler) => listeners.set(type, handler)
  };
  vm.runInNewContext(workerCode, {self, caches, URL, Request, Response, fetch, Set, Promise}, {filename:'sw.js'});
  const runLifecycle = async type => {
    let task;
    listeners.get(type)({waitUntil:value => {task = value;}});
    await task;
  };
  const request = async (path, options = {}) => {
    let response;
    listeners.get('fetch')({
      request:{url:new URL(path, base).href, method:'GET', mode:'cors', ...options},
      respondWith:value => {response = value;}
    });
    return response ? await response : undefined;
  };
  return {base, buckets, network, lifecycle, runLifecycle, request};
}

test('precache stays under the GitHub project path and makes the app available offline', async () => {
  const h = workerHarness();
  await h.runLifecycle('install');
  await h.runLifecycle('activate');
  assert.equal(h.lifecycle.claimed, true);
  assert.equal(h.lifecycle.skipWaitingCalled, false);
  assert.ok(h.network.requests.length > 10);
  assert.ok(h.network.requests.every(url => url.startsWith(h.base)));
  h.network.offline = true;
  assert.equal(await (await h.request('./', {mode:'navigate'})).text(), 'file:/dhikr/index.html');
  assert.equal(await (await h.request('./index.html?from=icon', {mode:'navigate'})).text(), 'file:/dhikr/index.html');
  assert.equal(await (await h.request('./assets/olive-lush.png')).text(), 'file:/dhikr/assets/olive-lush.png');
  assert.equal(await (await h.request('./app.mjs')).text(), 'file:/dhikr/app.mjs');
});

test('the same package also works at a domain root', async () => {
  const h = workerHarness('https://example.github.io/');
  await h.runLifecycle('install');
  h.network.offline = true;
  assert.equal(await (await h.request('/', {mode:'navigate'})).text(), 'file:/index.html');
  assert.equal(await (await h.request('/style.css')).text(), 'file:/style.css');
});

test('external hosts, neighbouring projects, unknown routes and writes are untouched', async () => {
  const h = workerHarness();
  await h.runLifecycle('install');
  h.network.offline = true;
  assert.equal(await h.request('https://other.example/dhikr/index.html', {mode:'navigate'}), undefined);
  assert.equal(await h.request('/other/index.html', {mode:'navigate'}), undefined);
  assert.equal(await h.request('/dhikr-else/index.html', {mode:'navigate'}), undefined);
  assert.equal(await h.request('./unknown.png'), undefined);
  assert.equal(await h.request('./README.md', {mode:'navigate'}), undefined);
  assert.equal(await h.request('./app.mjs', {method:'POST'}), undefined);
});

test('activation deletes only older caches belonging to this exact installation path', async () => {
  const h = workerHarness();
  await h.runLifecycle('install');
  const current = [...h.buckets.keys()][0];
  const old = 'dhikr-shell:' + h.base + ':old';
  const neighbour = 'dhikr-shell:https://example.github.io/other/:old';
  h.buckets.set(old, new Map());
  h.buckets.set(neighbour, new Map());
  h.buckets.set('unrelated-app', new Map());
  await h.runLifecycle('activate');
  assert.equal(h.buckets.has(old), false);
  assert.equal(h.buckets.has(current), true);
  assert.equal(h.buckets.has(neighbour), true);
  assert.equal(h.buckets.has('unrelated-app'), true);
});

test('an incomplete download fails installation instead of claiming offline readiness', async () => {
  const h = workerHarness();
  h.network.failPath = '/dhikr/assets/olive-lush.png';
  await assert.rejects(h.runLifecycle('install'), /required asset failed/);
  assert.equal(h.lifecycle.claimed, false);
  assert.equal(h.lifecycle.skipWaitingCalled, false);
});

test('one cached release remains coherent while a newer version waits', async () => {
  const h = workerHarness();
  await h.runLifecycle('install');
  const requestCount = h.network.requests.length;
  assert.equal(await (await h.request('./', {mode:'navigate'})).text(), 'file:/dhikr/index.html');
  assert.equal(await (await h.request('./style.css?cachebust=1')).text(), 'file:/dhikr/style.css');
  assert.equal(h.network.requests.length, requestCount);
  assert.equal(h.lifecycle.skipWaitingCalled, false);
});

test('manifest is portable and all installation icons and precached assets exist', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(manifest.id, './');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  for (const icon of manifest.icons) await access(fileURLToPath(new URL(icon.src, root)));
  const h = workerHarness();
  await h.runLifecycle('install');
  for (const url of h.network.requests) await access(fileURLToPath(new URL(url.slice(h.base.length), root)));
});
