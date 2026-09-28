import {describe, test, expect} from 'bun:test';
import {DEFAULT_BASE, normalizeBase, panelPath, parsePanelIdentity, targetForTab, sourceLabel, agentUrl, draftUrl} from './helpers.js';

describe('loopback configuration', () => {
  test('default configured HTTPS origin', () => {
    expect(normalizeBase()).toBe(DEFAULT_BASE);
    expect(normalizeBase('https://macstudio-nikolai.tail32c871.ts.net:3443/')).toBe(DEFAULT_BASE);
  });
  test('rejects remote hosts, credentials, scripts and path/query injection', () => {
    for (const value of ['https://localhost:3010', 'http://localhost.evil.test', 'http://user:secret@localhost:3010', 'http://localhost/a', 'http://localhost/?token=x', 'http://localhost/#x', 'javascript:alert(1)', 'http://[::1]:3010']) {
      expect(() => normalizeBase(value)).toThrow();
    }
  });
});
describe('tab-specific identity', () => {
  test('path round trip retains window and nonce', () => {
    const path = panelPath(19, 3, 'abc-def');
    expect(parsePanelIdentity(path.slice(path.indexOf('?')))).toEqual({tabId: 19, windowId: 3, nonce: 'abc-def'});
    expect(panelPath(20, 3, 'abc-def')).not.toBe(path);
    expect(panelPath(19, 4, 'abc-def')).not.toBe(path);
  });
  test('default and malformed panels cannot acquire arbitrary active tab', () => {
    for (const value of ['', '?tabId=1', '?tabId=-1&windowId=2&nonce=a', '?tabId=x&windowId=2&nonce=a', '?tabId=&windowId=2&nonce=a', '?tabId=1&windowId=2&nonce=']) expect(parsePanelIdentity(value)).toBeNull();
    expect(() => panelPath(-1, 2, 'n')).toThrow();
  });
});
describe('target mapping', () => {
  const targets = [{type: 'page', tabId: 11, id: 'A', url: 'https://example.org'}, {type: 'page', tabId: 12, id: 'B', url: 'https://example.org'}];
  test('same URL is never identity', () => {
    expect(targetForTab(targets, 11)).toBe('A');
    expect(targetForTab(targets, 12)).toBe('B');
    expect(() => targetForTab(targets, 13)).toThrow();
  });
  test('missing, non-page or ambiguous target fails closed', () => {
    expect(() => targetForTab([{tabId: 11, type: 'worker', id: 'A'}], 11)).toThrow();
    expect(() => targetForTab([...targets, targets[0]], 11)).toThrow();
    expect(() => targetForTab([{tabId: 11, type: 'page'}], 11)).toThrow();
  });
});
test('frame is existing sidebar UI on configured origin, without token', () => {
  expect(agentUrl(DEFAULT_BASE, 'ab')).toBe(`${DEFAULT_BASE}/agent/ab?presentation=sidebar`);
  expect(agentUrl(DEFAULT_BASE, 'ab', false)).toBe(`${DEFAULT_BASE}/agent/ab`);
  expect(() => agentUrl(DEFAULT_BASE, '../other?token=x')).toThrow();
});
test('source label tolerates unavailable URL', () => {
  expect(sourceLabel({title: '<script>', url: 'https://example.org/page'})).toBe('<script> · example.org');
  expect(sourceLabel({})).toBe('Unavailable page');
});
test('manifest is local MV3 with no injection or remote privileged scripts', async () => {
  const manifest = await Bun.file(new URL('./manifest.json', import.meta.url)).json();
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.host_permissions).toEqual(['https://macstudio-nikolai.tail32c871.ts.net:3443/*']);
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.permissions).toContain('debugger');
  expect(manifest.content_security_policy.extension_pages).toContain("script-src 'self'");
  const worker = await Bun.file(new URL('./worker.js', import.meta.url)).text();
  expect(worker).not.toContain('debugger.attach');
  expect(worker).toContain('chrome.debugger.getTargets()');
});


test('draft URL accepts only a safe binding identifier on configured loopback origin', () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  expect(draftUrl(DEFAULT_BASE, id)).toBe(`${DEFAULT_BASE}/sidebar/draft/${id}?presentation=sidebar`);
  for (const value of ['../agent/ab', `${id}?token=x`, 'https://evil.test', null]) expect(() => draftUrl(DEFAULT_BASE, value)).toThrow();
  expect(() => draftUrl('http://evil.test', id)).toThrow();
});
