import {parsePanelIdentity, agentUrl, draftUrl} from './helpers.js';
const identity = parsePanelIdentity(location.search);
const source = document.querySelector('#source');
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const chat = document.querySelector('#chat');
const open = document.querySelector('#open');
const back = document.querySelector('#back');
let base;
let mountedAgent;
let generation = 0;
function showError(message) { error.textContent = message; error.hidden = !message; }
let invalidated = false;
function clearFrame() {
  chat.hidden = true;
  chat.removeAttribute('src');
  open.hidden = true;
  open.removeAttribute('href');
  back.hidden = true;
  mountedAgent = undefined;
  base = undefined;
}
function render(record) {
  if (!identity || record.tabId !== identity.tabId || record.nonce !== identity.nonce) return;
  source.textContent = record.label || 'Hyper Sidebar';
  source.title = record.label || '';
  status.textContent = record.status;
  showError(record.error || '');
  if (record.closed) {
    invalidated = true;
    ++generation; // Ignore a pending open response for a now revoked/closed identity.
    clearFrame();
    showError(record.status);
    return;
  }
  if (invalidated) return;
  if ((record.agentId || record.bindingId) && base) {
    open.href = record.agentId ? agentUrl(base, record.agentId, false) : draftUrl(base, record.bindingId, false);
    open.hidden = false;
    back.hidden = !record.agentId;
    // A mounted draft redirects itself after submit; context updates must not reload it.
    const mountKey = record.bindingId || record.agentId;
    if (mountedAgent !== mountKey) {
      chat.src = record.agentId ? agentUrl(base, record.agentId) : draftUrl(base, record.bindingId);
      mountedAgent = mountKey;
    }
    chat.hidden = false;
  }
}
async function connect() {
  const ticket = ++generation;
  if (invalidated) {
    clearFrame();
    showError('This panel identity was closed or revoked. Close and reopen the sidebar on its source tab.');
    return;
  }
  if (!identity) {
    status.textContent = 'No tab identity';
    showError('Close this default panel, then click the Hyper extension icon on your source tab. If just installed, reload the extension once initialization completes.');
    return;
  }
  status.textContent = 'Connecting…';
  try {
    const response = await chrome.runtime.sendMessage({type: 'open', ...identity});
    if (ticket !== generation) return;
    if (!response?.ok) throw new Error(response?.error || 'Extension worker unavailable');
    base = response.data.base;
    render(response.data.record);
  } catch (failure) { if (ticket === generation) { status.textContent = 'Not connected'; showError(failure.message); } }
}
chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'state') render(message.record);
});
document.querySelector('#retry').addEventListener('click', connect);
back.addEventListener('click', async () => {
  back.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({type: 'detach', ...identity});
    if (!response?.ok) throw new Error(response?.error || 'Could not return to chat list');
    base = response.data.base;
    mountedAgent = undefined;
    render(response.data.record);
  } catch (failure) { showError(failure.message); }
  finally { back.disabled = false; }
});
document.querySelector('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
chat.addEventListener('error', () => showError('Hyper frame could not load. Check the server and open this agent in Hyper to sign in.'));
connect();
