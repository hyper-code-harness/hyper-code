export const DEFAULT_BASE = 'https://macstudio-nikolai.tail32c871.ts.net:3443';
export const HYPER_TAB_URL = `${DEFAULT_BASE}/agent/bzxf`;

/** Accept the single configured HTTPS Hyper origin without paths or credentials. */
export function normalizeBase(value = DEFAULT_BASE) {
  const url = new URL(value);
  if (url.origin !== DEFAULT_BASE || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(`Use ${DEFAULT_BASE}`);
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


/** Construct only the safe, local draft path; a binding id is not an auth token. */
export function draftUrl(base, bindingId, panel = true) {
  if (typeof bindingId !== 'string' || !/^[a-f0-9-]{36}$/.test(bindingId)) throw new Error('Invalid binding ID');
  return `${normalizeBase(base)}/sidebar/draft/${bindingId}${panel ? '?presentation=sidebar' : ''}`;
}
