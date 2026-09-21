import {DEFAULT_BASE, normalizeBase, panelPath, targetForTab, sourceLabel} from './helpers.js';

// Serialize mutations including network requests; Chrome may suspend us between events.
let queue = Promise.resolve();
const serial = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
let state;
let loading;
function load() {
  if (state) return Promise.resolve(state);
  return loading ||= loadState();
}
async function loadState() {
  await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  const local = await chrome.storage.local.get(['installationId', 'base']);
  if (!local.installationId) await chrome.storage.local.set({installationId: crypto.randomUUID()});
  if (!local.base) await chrome.storage.local.set({base: DEFAULT_BASE});
  const saved = await chrome.storage.session.get('sidebar');
  state = saved.sidebar || {epoch: crypto.randomUUID(), tabs: {}, closes: []};
  await save();
  return state;
}
async function save() { await chrome.storage.session.set({sidebar: state}); }
async function config() { return chrome.storage.local.get(['base', 'token', 'pairId', 'installationId']); }
async function api(action, body = {}, credentials) {
  const cfg = credentials || await config();
  if (action !== 'pair' && !cfg.token) throw new Error('Pair this extension in Settings first');
  const response = await fetch(`${normalizeBase(cfg.base)}/sidebar/api/${action}`, {
    method: 'POST', headers: {'Content-Type': 'application/json', ...(cfg.token && action !== 'pair' ? {Authorization: `Bearer ${cfg.token}`} : {})},
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000), credentials: 'omit', redirect: 'error',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Hyper returned HTTP ${response.status}`);
  return data;
}
async function announce(record) {
  await save();
  // A panel need not currently exist. Never broadcast the pairing credential.
  chrome.runtime.sendMessage({type: 'state', record}).catch(() => {});
}
async function ensure(tab) {
  let record = state.tabs[tab.id];
  if (pendingActions.has(tab.id)) return record;
  if (!record?.optedIn) {
    await chrome.sidePanel.setOptions({tabId: tab.id, enabled: false});
    return record;
  }
  record.windowId = tab.windowId;
  record.label = sourceLabel(tab);
  await chrome.sidePanel.setOptions({tabId: tab.id, enabled: true, path: panelPath(tab.id, tab.windowId, record.nonce)});
  await save();
  return record;
}
async function flushCloses() {
  const cfg = await config();
  if (!cfg.token) return;
  for (const item of [...state.closes]) {
    try {
      await api('close', {browserEpoch: state.epoch, tabId: item.tabId});
      state.closes = state.closes.filter(x => x !== item);
      await save();
    } catch { break; } // Durable retry on the next panel/update event, without timers.
  }
}
async function closeTab(tabId) {
  const record = state.tabs[tabId];
  if (!record) return;
  delete state.tabs[tabId];
  if (record.opened) state.closes.push({tabId});
  await announce({...record, closed: true, status: 'Tab closed; browser access revoked when Hyper is reachable'});
  await flushCloses();
}
async function refresh(tabId, opening = false) {
  let record = state.tabs[tabId];
  if (!record?.optedIn || (!opening && !record.opened)) return record;
  record.opened = true;
  await save(); // Persist intent before a bind request: retry is backend-idempotent.
  try {
    const tab = await chrome.tabs.get(tabId);
    record.label = sourceLabel(tab);
    const targetId = targetForTab(await chrome.debugger.getTargets(), tabId);
    if (record.targetId && record.targetId !== targetId) throw new Error('Tab target changed; original agent is not retargeted. Open a new tab to reconnect.');
    const data = await api(record.agentId ? 'context' : 'bind', {
      browserEpoch: state.epoch, tabId, targetId, url: tab.url || '', title: tab.title || '',
    });
    // A tab can close while fetch awaits, before its queued removal event runs.
    await chrome.tabs.get(tabId);
    if (record.agentId && record.agentId !== data.agentId) throw new Error('Backend changed agent identity; refusing to switch chat');
    if (data.targetId !== targetId) throw new Error('Backend target identity mismatch');
    Object.assign(record, {agentId: data.agentId, bindingId: data.bindingId, targetId, status: 'Connected', error: null});
  } catch (error) {
    record.error = String(error.message || error);
    record.status = 'Not connected';
  }
  await announce(record);
  await flushCloses();
  return record;
}
async function boot() {
  await load();
  // Clear the old installation's automatic/global action behavior as well.
  await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: false});
  await chrome.sidePanel.setOptions({enabled: false});
  const tabs = await chrome.tabs.query({});
  const live = new Set(tabs.map(tab => tab.id));
  for (const id of Object.keys(state.tabs)) if (!live.has(Number(id))) await closeTab(Number(id));
  for (const tab of tabs) await ensure(tab);
  await flushCloses();
}
const ready = serial(boot);
ready.catch(error => console.error('Sidebar initialization:', error));
function event(fn) { return (...args) => { serial(async () => { await load(); await fn(...args); }).catch(error => console.error('Sidebar:', error)); }; }
// Chrome drops the user gesture across even setOptions()'s promise (live-tested).
// Issue both API calls synchronously, in order, before awaiting anything. Persist
// through the queue before panel messages; a cold worker keeps the saved chat but
// uses a fresh panel nonce. Boot must not disable a click pending initialization.
const pendingActions = new Map();
chrome.action.onClicked.addListener(tab => {
  const nonce = state?.tabs[tab.id]?.nonce || crypto.randomUUID();
  pendingActions.set(tab.id, {tab, nonce});
  const configured = chrome.sidePanel.setOptions({tabId: tab.id, enabled: true, path: panelPath(tab.id, tab.windowId, nonce)});
  const opened = chrome.sidePanel.open({tabId: tab.id});
  Promise.all([configured, opened]).catch(error => console.error('Sidebar action:', error));
  return serial(async () => {
    await load();
    let record = state.tabs[tab.id];
    if (!record) record = state.tabs[tab.id] = {tabId: tab.id, status: 'Open panel to connect'};
    Object.assign(record, {optedIn: true, nonce, windowId: tab.windowId, label: sourceLabel(tab)});
    await save();
    pendingActions.delete(tab.id);
  }).catch(error => console.error('Sidebar action state:', error));
});
chrome.commands.onCommand.addListener(event(async command => {
  if (command !== 'previous-tab' && command !== 'next-tab') return;
  const tabs = (await chrome.tabs.query({currentWindow: true})).filter(tab => Number.isInteger(tab.index));
  if (tabs.length < 2) return;
  tabs.sort((a, b) => a.index - b.index);
  const current = tabs.findIndex(tab => tab.active);
  if (current < 0) return;
  const step = command === 'next-tab' ? 1 : -1;
  const target = tabs[(current + step + tabs.length) % tabs.length];
  await chrome.tabs.update(target.id, {active: true});
}));

chrome.runtime.onInstalled.addListener(event(boot));
chrome.runtime.onStartup.addListener(event(boot));
chrome.tabs.onCreated.addListener(event(ensure));
chrome.tabs.onRemoved.addListener(event(closeTab));
chrome.tabs.onUpdated.addListener(event(async (id, change, tab) => {
  await ensure(tab);
  if (change.url || change.title || change.status === 'complete') await refresh(id);
}));
chrome.tabs.onReplaced.addListener(event(async (addedId, removedId) => {
  // Fail closed: a replacement is a new identity, never transfer another agent.
  await closeTab(removedId);
  await ensure(await chrome.tabs.get(addedId));
}));
chrome.tabs.onAttached.addListener(event(async id => { await ensure(await chrome.tabs.get(id)); await refresh(id); }));
chrome.tabs.onActivated.addListener(event(async ({tabId}) => { await ensure(await chrome.tabs.get(tabId)); }));

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if (!['open', 'retry', 'config', 'pair', 'pairStatus', 'revoke'].includes(message.type)) return;
  serial(async () => {
    await load();
    if (message.type === 'config') {
      const cfg = await config();
      return {base: cfg.base, paired: !!cfg.token, pairId: cfg.pairId, installationId: cfg.installationId, extensionId: chrome.runtime.id};
    }
    if (message.type === 'pair') {
      const base = normalizeBase(message.base);
      const old = await config();
      if (old.token) await api('revoke', {}, old); // Do not abandon live server bindings silently.
      const pairing = await api('pair', {}, {base});
      // Revoke succeeded: invalidate old panels even if creating the new pair fails.
      for (const record of Object.values(state.tabs)) await announce({...record, closed: true, status: 'Pairing changed. Close and reopen this panel.'});
      const approval = new URL(pairing.approvalUrl, base);
      if (approval.origin !== base || approval.username || approval.password) throw new Error('Invalid approval URL');
      await chrome.storage.local.set({base, token: pairing.token, pairId: pairing.pairId});
      state = {epoch: crypto.randomUUID(), tabs: {}, closes: []};
      await save();
      await boot();
      await chrome.tabs.create({url: approval.href});
      return {pending: true};
    }
    if (message.type === 'pairStatus') return api('status');
    if (message.type === 'revoke') {
      await api('revoke');
      await chrome.storage.local.remove(['token', 'pairId']);
      for (const record of Object.values(state.tabs)) await announce({...record, closed: true, status: 'Pairing revoked'});
      state = {epoch: crypto.randomUUID(), tabs: {}, closes: []};
      await save(); await boot();
      return {revoked: true};
    }
    const record = state.tabs[message.tabId];
    if (!record?.optedIn || record.nonce !== message.nonce || record.windowId !== message.windowId) throw new Error('This panel is stale. Close and reopen it from its tab.');
    const current = await chrome.tabs.get(record.tabId);
    if (current.windowId !== record.windowId) throw new Error('Tab moved windows. Reopen its panel.');
    const result = await refresh(record.tabId, true);
    return {record: result, base: (await config()).base};
  }).then(data => reply({ok: true, data}), error => reply({ok: false, error: String(error.message || error)}));
  return true;
});
