import { crossSiteCookie } from './cookies.js';

// One session rule per Hyper tab: inside that tab, frames (sub_frame) lose X-Frame-Options and CSP, so a
// site that forbids framing can be shown in the canvas. Pages outside Hyper tabs are untouched; the rule
// goes away when the tab closes or leaves Hyper.
const HYPER = /^(https:\/\/([a-z0-9-]+\.)*hyper-mesh\.xyz|http:\/\/(localhost|127\.0\.0\.1))(:\d+)?\//i;

const ruleFor = tabId => ({
  id: tabId,
  priority: 1,
  condition: { tabIds: [tabId], resourceTypes: ['sub_frame'] },
  action: {
    type: 'modifyHeaders',
    responseHeaders: [
      { header: 'x-frame-options', operation: 'remove' },
      { header: 'content-security-policy', operation: 'remove' },
    ],
  },
});

const enable = tabId => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId], addRules: [ruleFor(tabId)] });
const disable = tabId => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'hyper-canvas-tab' && sender.tab?.id >= 0 && sender.frameId === 0 && HYPER.test(sender.url || '')) enable(sender.tab.id);
});
chrome.tabs.onRemoved.addListener(tabId => disable(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url && !HYPER.test(info.url)) disable(tabId); });

// Logins inside the frame: a framed site is cross-site to Hyper, so Chrome drops its SameSite=Lax/Strict
// (or unmarked, i.e. Lax) session cookies and the login fails ("no session cookie", CSRF errors). For frames
// in Hyper tabs, each such Set-Cookie is stored again as SameSite=None; Secure, which Chrome sends from a
// frame. localhost counts as secure, so this works for local http services too. A Hyper tab is one with a
// session rule (rule id = tab id), so the set survives the worker being stopped.
const hyperTabs = async () => new Set((await chrome.declarativeNetRequest.getSessionRules()).map(r => r.id));

chrome.webRequest.onHeadersReceived.addListener(details => {
  if (details.frameId === 0 || details.tabId < 0) return;
  const lines = (details.responseHeaders || []).filter(h => h.name.toLowerCase() === 'set-cookie').map(h => h.value || '');
  if (!lines.length) return;
  hyperTabs().then(tabs => {
    if (!tabs.has(details.tabId)) return;
    for (const line of lines.flatMap(l => l.split('\n'))) {
      const cookie = crossSiteCookie(details.url, line);
      if (cookie) chrome.cookies.set(cookie).catch(e => console.warn('hyper canvas frames: cookie', cookie.name, e?.message));
    }
  });
}, { urls: ['http://*/*', 'https://*/*'] }, ['responseHeaders', 'extraHeaders']);
