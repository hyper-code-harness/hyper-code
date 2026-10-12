/** Google Calendar day page: one day of your own calendars across every authorized account, each event with its details. Embeds in the gcal.calendar canvas tab with ?embed=1. */
export default async function (_ctx: Context, _session: Session | null, opts: { /** Incoming HTTP request. */ req: Request }) {
    const u = new URL(opts.req.url);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get("date") ?? "") ? u.searchParams.get("date")! : "";
    const init = JSON.stringify({ date, embed: u.searchParams.get("embed") === "1" }).replace(/</g, "\\u003c");
    const main = `<div class="gcal" id="gcal">
<header class="gc-top">
  <button class="gc-btn" data-act="today">Сегодня</button>
  <div class="gc-nav"><button class="gc-icon" data-act="prev" title="Назад">‹</button><button class="gc-icon" data-act="next" title="Вперёд">›</button></div>
  <h1 id="gc-title"></h1>
</header>
<section class="gc-main" id="gc-main"></section>
</div>
<script>window.__gcalInit=${init}</script><script src="/gcal/calendar.js"></script>`;
    return { title: "Calendar", main, headExtra: `<link rel="stylesheet" href="/gcal/calendar.css">` };
}
