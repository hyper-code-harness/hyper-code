import {test, expect} from 'bun:test';
import vm from 'node:vm';
import * as helpers from './helpers.js';

const source = (await Bun.file(new URL('./worker.js', import.meta.url)).text()).replace(/^import .*?;\n/, '');
async function worker(saved, cold = false) {
  const hooks = {}, options = new Map(), opened = [], behavior = [];
  const tabs = new Map([1, 2].map(id => [id, {id, windowId: 10, title: `Tab ${id}`, url: 'https://example.com'}]));
  const session = saved ? {sidebar: structuredClone(saved)} : {};
  const local = {base: 'http://localhost:3010', installationId: 'install'};
  const event = name => ({addListener(fn) { hooks[name] = fn; }});
  const chrome = {
    storage: {local: {setAccessLevel: async () => {}, get: async () => local, set: async x => Object.assign(local, x)}, session: {get: async () => structuredClone(session), set: async x => Object.assign(session, structuredClone(x))}},
    sidePanel: {setOptions: async opts => options.set(opts.tabId ?? 'global', opts), setPanelBehavior: async x => behavior.push(x), open: async x => {
      expect(options.get(x.tabId)?.enabled).toBe(true); opened.push(x);
    }},
    action: {onClicked: event('click')},
    commands: {onCommand: event('command')},
    runtime: {id: 'test', getURL: path => `chrome-extension://test/${path}`, sendMessage: async () => {}, onInstalled: event('install'), onStartup: event('startup'), onMessage: event('message')},
    tabs: {query: async query => query?.currentWindow ? [...tabs.values()].map((tab, index) => ({...tab, index, active: index === 0})) : query?.url ? [...tabs.values()].filter(tab => tab.url?.startsWith('http://localhost:3010/')) : [...tabs.values()], get: async id => { if (!tabs.has(id)) throw Error('Missing tab'); return tabs.get(id); }, update: async (id, changes) => Object.assign(tabs.get(id), changes), create: async changes => { const id = Math.max(...tabs.keys()) + 1; const tab = {id, windowId: 10, ...changes}; tabs.set(id, tab); return tab; },
      ...Object.fromEntries(['Created', 'Removed', 'Updated', 'Replaced', 'Attached', 'Activated'].map(name => [`on${name}`, event(name)]))},
    windows: {update: async () => {}},
  };
  const context = vm.createContext({chrome, ...helpers, crypto, console, URL, AbortSignal, fetch: async () => { throw Error('Unexpected network'); }});
  vm.runInContext(source, context);
  const settle = () => vm.runInContext('queue', context);
  if (!cold) await settle();
  return {hooks, options, opened, session, tabs, behavior, settle};
}

test('boot, creation, activation and updates never opt untouched tabs in', async () => {
  const w = await worker();
  expect(w.options.get('global').enabled).toBe(false);
  expect(w.behavior.every(x => x.openPanelOnActionClick === false)).toBe(true);
  expect(w.session.sidebar.tabs).toEqual({});
  w.tabs.set(3, {id: 3, windowId: 10});
  w.hooks.Created(w.tabs.get(3)); w.hooks.Activated({tabId: 2});
  w.hooks.Updated(1, {title: 'new'}, w.tabs.get(1));
  await w.settle();
  for (const id of [1, 2, 3]) expect(w.options.get(id).enabled).toBe(false);
  expect(w.session.sidebar.tabs).toEqual({});
  expect(w.opened).toEqual([]);
});

test('action enables only clicked tab, returning preserves its identity and worker restart restores opt-in', async () => {
  const w = await worker();
  const click = w.hooks.click(w.tabs.get(1));
  // open must happen on the original synchronous gesture stack.
  expect(w.opened).toEqual([{tabId: 1}]);
  await click;
  const record = w.session.sidebar.tabs[1];
  expect(record.optedIn).toBe(true);
  expect(w.opened).toEqual([{tabId: 1}]);
  w.hooks.Activated({tabId: 2}); w.hooks.Activated({tabId: 1}); await w.settle();
  expect(w.options.get(2).enabled).toBe(false);
  expect(w.session.sidebar.tabs[1].nonce).toBe(record.nonce);
  const saved = structuredClone(w.session.sidebar);
  saved.tabs[1].agentId = 'existing-chat';
  const restarted = await worker(saved);
  expect(restarted.options.get(1).enabled).toBe(true);
  expect(restarted.options.get(2).enabled).toBe(false);
  expect(restarted.session.sidebar.tabs[1].agentId).toBe('existing-chat');
  expect(restarted.session.sidebar.tabs[1].nonce).toBe(record.nonce);
  expect(restarted.opened).toEqual([]);
});

test('legacy records stay disabled until explicit click; preserve bound chat on opt-in', async () => {
  const w = await worker({epoch: 'epoch', closes: [], tabs: {1: {tabId: 1, windowId: 10, nonce: 'old', agentId: 'chat', opened: true}}});
  expect(w.options.get(1).enabled).toBe(false);
  w.hooks.Activated({tabId: 1}); await w.settle();
  expect(w.options.get(1).enabled).toBe(false);
  await w.hooks.click(w.tabs.get(1));
  expect(w.options.get(1).enabled).toBe(true);
  expect(w.session.sidebar.tabs[1]).toMatchObject({nonce: 'old', agentId: 'chat', optedIn: true});
});

test('replacement never inherits opt-in or chat; removed opted-in record is deleted', async () => {
  const w = await worker();
  await w.hooks.click(w.tabs.get(1));
  w.tabs.set(3, {id: 3, windowId: 10}); w.tabs.delete(1);
  w.hooks.Replaced(3, 1); await w.settle();
  expect(w.options.get(3).enabled).toBe(false);
  expect(w.session.sidebar.tabs[1]).toBeUndefined();
  expect(w.session.sidebar.tabs[3]).toBeUndefined();
  await w.hooks.click(w.tabs.get(2));
  w.tabs.delete(2); w.hooks.Removed(2); await w.settle();
  expect(w.session.sidebar.tabs[2]).toBeUndefined();
});

test('cold-worker action opens synchronously and boot cannot disable its pending opt-in', async () => {
  const w = await worker({epoch: 'epoch', closes: [], tabs: {1: {tabId: 1, windowId: 10, nonce: 'old', agentId: 'chat'}}}, true);
  const click = w.hooks.click(w.tabs.get(1));
  expect(w.opened).toEqual([{tabId: 1}]);
  await click; await w.settle();
  expect(w.options.get(1).enabled).toBe(true);
  expect(w.session.sidebar.tabs[1]).toMatchObject({optedIn: true, agentId: 'chat'});
});

test('a panel message cannot opt in a legacy tab', async () => {
  const w = await worker({epoch: 'epoch', closes: [], tabs: {1: {tabId: 1, windowId: 10, nonce: 'old'}}});
  const reply = await new Promise(resolve => w.hooks.message({type: 'open', tabId: 1, windowId: 10, nonce: 'old'}, {id: 'test', url: 'chrome-extension://test/panel.html'}, resolve));
  expect(reply.ok).toBe(false);
  expect(w.session.sidebar.tabs[1].optedIn).toBeUndefined();
  expect(w.options.get(1).enabled).toBe(false);
});
