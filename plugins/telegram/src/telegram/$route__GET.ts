/** Renders the personal Telegram direct-message client inside the shared Hyper page shell. */
export default async function (_ctx: Context, _session: Session | null, _opts: { req: Request; params: Record<string, string> }) {
    const main = `<div id="telegram-client" class="h-[calc(100vh-3.5rem)] min-h-[32rem] overflow-hidden bg-white">
  <div class="grid h-full grid-cols-[286px_minmax(0,1fr)] max-md:grid-cols-1">
    <aside class="flex min-h-0 flex-col border-r border-ui-border max-md:hidden">
      <div class="flex h-[58px] shrink-0 items-center border-b border-ui-border px-3"><input id="tg-search" class="w-full rounded-lg border border-ui-border bg-base-50 px-3 py-2 text-sm outline-none focus:border-ui-strong" placeholder="Поиск диалогов"></div>
      <div class="px-4 pb-2 pt-4 text-[10px] font-semibold uppercase tracking-widest text-muted">Личные сообщения</div>
      <div id="tg-dialogs" class="min-h-0 flex-1 overflow-y-auto px-2"><div class="p-4 text-sm text-muted">Загрузка…</div></div>
      <div class="flex items-center gap-2 border-t border-ui-border px-4 py-3 text-xs text-muted"><span class="h-2 w-2 rounded-full bg-emerald-500"></span>MTProto подключён</div>
    </aside>
    <section class="grid min-h-0 grid-rows-[58px_minmax(0,1fr)_76px]">
      <header class="flex items-center justify-between border-b border-ui-border px-5"><div><div id="tg-title" class="text-sm font-semibold">Выберите диалог</div><div id="tg-meta" class="mt-0.5 text-xs text-muted">Telegram · личные сообщения</div></div><button id="tg-refresh" class="rounded-lg border border-ui-border px-3 py-1.5 text-xs text-muted hover:bg-base-50">Обновить</button></header>
      <div id="tg-messages" class="min-h-0 overflow-y-auto bg-gradient-to-b from-white to-base-50 px-[10%] py-6 max-md:px-3"><div class="grid h-full place-items-center text-sm text-muted">Выберите личный диалог слева</div></div>
      <form id="tg-compose" class="flex items-center gap-2 border-t border-ui-border px-[8%] py-3 max-md:px-3"><input id="tg-input" class="min-w-0 flex-1 rounded-xl border border-ui-border bg-white px-4 py-3 text-sm outline-none focus:border-ui-strong" placeholder="Написать сообщение…" disabled><button id="tg-send" class="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-40" disabled>Отправить</button></form>
    </section>
  </div>
</div><script src="/telegram/client.js"></script>`;
    return { title: "Telegram", main };
}
