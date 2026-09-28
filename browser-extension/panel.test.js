import {test, expect} from 'bun:test';

test('close/revoke invalidation unloads frame and link, and ignores stale responses', async () => {
  const old = {document: globalThis.document, chrome: globalThis.chrome, location: globalThis.location};
  const nodes = new Map();
  for (const id of ['source', 'status', 'error', 'chat', 'open', 'back', 'retry', 'settings']) {
    nodes.set(`#${id}`, {hidden: true, attributes: {}, addEventListener(name, fn) { this[name] = fn; }, removeAttribute(name) { delete this[name]; }});
  }
  const identity = {tabId: 11, windowId: 2, nonce: 'test'};
  let listener;
  let resolveOpen;
  try {
    globalThis.document = {querySelector: selector => nodes.get(selector)};
    globalThis.location = {search: '?tabId=11&windowId=2&nonce=test'};
    globalThis.chrome = {runtime: {
      sendMessage: () => new Promise(resolve => { resolveOpen = resolve; }),
      onMessage: {addListener: fn => { listener = fn; }}, openOptionsPage() {},
    }};
    await import(`./panel.js?test=${Date.now()}`);
    const record = {...identity, agentId: 'ab', status: 'Connected'};
    resolveOpen({ok: true, data: {base: 'https://macstudio-nikolai.tail32c871.ts.net:3443', record}});
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(nodes.get('#chat').src).toBe('https://macstudio-nikolai.tail32c871.ts.net:3443/agent/ab?presentation=sidebar');
    expect(nodes.get('#open').hidden).toBe(false);
    listener({type: 'state', record: {...record, label: 'Changed title'}});
    expect(nodes.get('#chat').src).toBe('https://macstudio-nikolai.tail32c871.ts.net:3443/agent/ab?presentation=sidebar');
    nodes.get('#retry').click(); // Pending old identity response must not remount.
    const pending = resolveOpen;
    listener({type: 'state', record: {...record, closed: true, status: 'Pairing revoked'}});
    expect(nodes.get('#chat').hidden).toBe(true);
    expect(nodes.get('#chat').src).toBeUndefined();
    expect(nodes.get('#open').hidden).toBe(true);
    expect(nodes.get('#open').href).toBeUndefined();
    pending({ok: true, data: {base: 'https://macstudio-nikolai.tail32c871.ts.net:3443', record}});
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(nodes.get('#chat').src).toBeUndefined();
    listener({type: 'state', record});
    expect(nodes.get('#chat').hidden).toBe(true);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});



test('draft frame survives binding-to-agent context refresh without remount', async () => {
  const old = {document: globalThis.document, chrome: globalThis.chrome, location: globalThis.location};
  const nodes = new Map(); let mounts = 0; let listener;
  for (const id of ['source', 'status', 'error', 'chat', 'open', 'back', 'retry', 'settings']) nodes.set(`#${id}`, {hidden: true, addEventListener() {}, removeAttribute(name) { delete this[name]; }});
  Object.defineProperty(nodes.get('#chat'), 'src', {get() { return this.value; }, set(v) { mounts++; this.value = v; }, configurable: true});
  const record = {tabId: 11, windowId: 2, nonce: 'draft', agentId: null, bindingId: '12345678-1234-1234-1234-123456789abc', status: 'Connected'};
  try {
    globalThis.document = {querySelector: selector => nodes.get(selector)};
    globalThis.location = {search: '?tabId=11&windowId=2&nonce=draft'};
    globalThis.chrome = {runtime: {sendMessage: async () => ({ok: true, data: {base: 'https://macstudio-nikolai.tail32c871.ts.net:3443', record}}), onMessage: {addListener: fn => { listener = fn; }}, openOptionsPage() {}}};
    await import(`./panel.js?draft-test=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(nodes.get('#chat').src).toContain('/sidebar/draft/');expect(mounts).toBe(1);
    listener({type: 'state', record: {...record, agentId: 'ab', label: 'Navigated'}});
    expect(mounts).toBe(1);expect(nodes.get('#open').href).toBe('https://macstudio-nikolai.tail32c871.ts.net:3443/agent/ab');
  } finally {
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
