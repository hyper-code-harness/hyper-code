export const DEFAULT_BASE = 'https://hyper.niquola.in.hn.hyper-mesh.xyz';

/** Accept an HTTPS Hyper origin, or loopback HTTP for local development. */
export function normalizeBase(value = DEFAULT_BASE) {
  const url = new URL(value);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password
      || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Use an HTTPS Hyper origin, or HTTP on localhost');
  }
  return url.origin;
}

export function panelPath(tabId, windowId, nonce) {
  if (!Number.isInteger(tabId) || tabId < 0 || !Number.isInteger(windowId) || windowId < 0 || !nonce) {
    throw new Error('Invalid panel identity');
  }
  return `panel.html?${new URLSearchParams({tabId: String(tabId), windowId: String(windowId), nonce})}`;
}

export function parsePanelIdentity(search) {
  const params = new URLSearchParams(search);
  const tabId = Number(params.get('tabId'));
  const windowId = Number(params.get('windowId'));
  const nonce = params.get('nonce');
  if (!params.has('tabId') || !params.has('windowId') || !/^\d+$/.test(params.get('tabId'))
      || !/^\d+$/.test(params.get('windowId')) || !Number.isSafeInteger(tabId)
      || !Number.isSafeInteger(windowId) || !nonce) return null;
  return {tabId, windowId, nonce};
}

/** No URL/title fallback: identical URLs are deliberately different targets. */
export function targetForTab(targets, tabId) {
  const matches = targets.filter(target => target.tabId === tabId && target.type === 'page');
  if (matches.length !== 1 || !matches[0].id) throw new Error('Cannot identify this tab in Chrome debugger targets');
  return matches[0].id;
}

export function sourceLabel(tab) {
  try { return `${tab.title || 'Untitled'} · ${new URL(tab.url).host || new URL(tab.url).protocol}`; }
  catch { return tab.title || 'Unavailable page'; }
}

/** Never let a server response inject a remote privileged frame or different agent path. */
export function agentUrl(base, agentId, panel = true) {
  if (typeof agentId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(agentId)) throw new Error('Invalid agent ID');
  return `${normalizeBase(base)}/agent/${encodeURIComponent(agentId)}${panel ? '?presentation=sidebar' : ''}`;
}

/** Construct only the safe draft path; a binding id is not an auth token. */
export function draftUrl(base, bindingId, panel = true) {
  if (typeof bindingId !== 'string' || !/^[a-f0-9-]{36}$/.test(bindingId)) throw new Error('Invalid binding ID');
  return `${normalizeBase(base)}/sidebar/draft/${bindingId}${panel ? '?presentation=sidebar' : ''}`;
}
