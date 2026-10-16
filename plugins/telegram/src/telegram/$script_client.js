(() => {
  const root = document.querySelector('#telegram-client');
  if (!root) return;
  const dialogsEl = root.querySelector('#tg-dialogs');
  const messagesEl = root.querySelector('#tg-messages');
  const searchEl = root.querySelector('#tg-search');
  const titleEl = root.querySelector('#tg-title');
  const metaEl = root.querySelector('#tg-meta');
  const inputEl = root.querySelector('#tg-input');
  const sendEl = root.querySelector('#tg-send');
  const composeEl = root.querySelector('#tg-compose');
  const refreshEl = root.querySelector('#tg-refresh');
  let dialogs = [], active = null, lastSignature = '', polling = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const initials = title => String(title || '?').split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase();
  const avatar = (d, size = 'h-9 w-9') => `<span class="relative grid ${size} shrink-0 place-items-center overflow-hidden rounded-xl bg-sky-50 text-xs font-bold text-sky-700"><span>${esc(initials(d.title))}</span>${d.avatarUrl ? `<img src="${esc(d.avatarUrl)}" alt="" loading="lazy" class="absolute inset-0 h-full w-full object-cover" onerror="this.remove()">` : ''}</span>`;
  const when = value => { const d = new Date(value); return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); };
  async function json(url, options) { const res = await fetch(url, options); const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`); return body; }
  function renderDialogs() {
    const q = searchEl.value.trim().toLowerCase();
    const rows = dialogs.filter(d => !q || `${d.title} ${d.lastMessage || ''}`.toLowerCase().includes(q));
    dialogsEl.innerHTML = rows.length ? rows.map(d => `<button type="button" data-chat="${esc(d.id)}" class="grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-base-100 ${active?.id === d.id ? 'bg-base-100' : ''}">${avatar(d)}<span class="min-w-0"><span class="block truncate text-sm font-semibold">${esc(d.title)}</span><span class="mt-0.5 block truncate text-xs text-muted">${esc(d.lastMessage || 'Нет сообщений')}</span></span>${d.unreadCount ? `<span class="rounded-full bg-sky-600 px-1.5 py-0.5 text-[10px] text-white">${Number(d.unreadCount)}</span>` : ''}</button>`).join('') : '<div class="p-4 text-sm text-muted">Ничего не найдено</div>';
  }
  async function loadDialogs() {
    try { dialogs = (await json('/telegram/api/dialogs?max=150')).dialogs || []; renderDialogs(); if (!active && dialogs[0]) select(dialogs[0]); }
    catch (error) { dialogsEl.innerHTML = `<div class="p-4 text-sm text-red-600">${esc(error.message)}</div>`; }
  }
  async function loadMessages(silent = false) {
    if (!active) return;
    try {
      const messages = (await json(`/telegram/api/messages?chat=${encodeURIComponent(active.id)}&max=100`)).messages || [];
      const signature = messages.map(m => `${m.id}:${m.text}`).join('|'); if (silent && signature === lastSignature) return; lastSignature = signature;
      messagesEl.innerHTML = messages.length ? `<div class="mx-auto flex max-w-3xl flex-col gap-3">${messages.map(m => `<div class="flex max-w-[78%] gap-2 ${m.outgoing ? 'self-end flex-row-reverse' : 'self-start'}">${m.outgoing ? '<span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink text-[9px] font-bold text-white">Я</span>' : `<span class="relative grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg bg-base-100 text-[9px] font-bold text-muted"><span>${esc(initials(m.sender))}</span>${m.senderId ? `<img src="/telegram/api/avatar/${encodeURIComponent(m.senderId)}" alt="" loading="lazy" class="absolute inset-0 h-full w-full object-cover" onerror="this.remove()">` : ''}</span>`}<div class="rounded-xl border px-3 py-2 text-sm leading-relaxed ${m.outgoing ? 'border-ink bg-ink text-white' : 'border-ui-border bg-white'}"><div class="whitespace-pre-wrap break-words">${esc(m.text)}</div><div class="mt-1 text-[10px] ${m.outgoing ? 'text-white/60 text-right' : 'text-muted'}">${esc(m.sender)} · ${when(m.date)}</div></div></div>`).join('')}</div>` : '<div class="grid h-full place-items-center text-sm text-muted">В диалоге нет сообщений</div>';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } catch (error) { if (!silent) messagesEl.innerHTML = `<div class="p-4 text-sm text-red-600">${esc(error.message)}</div>`; }
  }
  function select(dialog) { active = dialog; titleEl.textContent = dialog.title; metaEl.textContent = 'Telegram · личный диалог'; inputEl.disabled = sendEl.disabled = false; lastSignature = ''; renderDialogs(); loadMessages(); clearInterval(polling); polling = setInterval(() => loadMessages(true), 3000); }
  dialogsEl.addEventListener('click', event => { const button = event.target.closest('[data-chat]'); if (!button) return; const dialog = dialogs.find(d => d.id === button.dataset.chat); if (dialog) select(dialog); });
  searchEl.addEventListener('input', renderDialogs); refreshEl.addEventListener('click', () => active ? loadMessages() : loadDialogs());
  composeEl.addEventListener('submit', async event => { event.preventDefault(); const text = inputEl.value.trim(); if (!active || !text) return; if (!confirm(`Отправить в Telegram пользователю «${active.title}»?\n\n${text}`)) return; sendEl.disabled = true; try { await json('/telegram/api/send', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat:active.id,text,confirm:true})}); inputEl.value = ''; await loadMessages(); } catch (error) { alert(error.message); } finally { sendEl.disabled = false; } });
  window.addEventListener('pagehide', () => clearInterval(polling), {once:true}); loadDialogs();
})();
