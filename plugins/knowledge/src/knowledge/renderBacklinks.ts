/**
 * Render unique persisted chat-message backlinks for an entity’s provenance.
 *
 * Use on Knowledge entity detail pages to group explicit chat source URLs by agent and message, batch-enrich cards with persisted chat titles and message dates (including archived chats), and render escaped evidence and attribute chips. Missing metadata falls back to the agent ID; non-chat sources are ignored and remain in provenance.
 * @param opts.provenance Entity provenance observations; only explicit canonical or legacy agent message URLs create backlinks.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Entity provenance observations; only explicit canonical or legacy agent message URLs create backlinks. */
        provenance: Array<{ url?: string | null; attribute: string; evidence?: string | null }>;
    },
): Promise<{ html: string; count: number }> {
    const esc = (value: string) => ctx.fns.procs.ui.escape({ text: value });
    const groups = new Map<string, { agent: string; idx: number; attributes: Set<string>; evidence: string[] }>();
    for (const item of opts.provenance) {
        const match = /^(?:hyper:\/\/agent\/|\/agent\/)([^/?#]+)\/message\/(\d+)$/.exec(item.url ?? '');
        if (!match) continue;
        let agent: string;
        try { agent = decodeURIComponent(match[1]!); } catch { continue; }
        if (!/^[A-Za-z0-9_-]+$/.test(agent)) continue;
        const idx = Number(match[2]);
        if (!Number.isSafeInteger(idx) || idx > 2147483647) continue;
        const key = agent + ':' + idx;
        let group = groups.get(key);
        if (!group) { group = { agent, idx, attributes: new Set(), evidence: [] }; groups.set(key, group); }
        group.attributes.add(item.attribute);
        const evidence = item.evidence?.replace(/\s+/g, ' ').trim();
        if (evidence && !group.evidence.includes(evidence)) group.evidence.push(evidence);
    }
    const metadata = new Map<string, { title: string | null; ts: number | string | null }>();
    if (groups.size) {
        try {
            const rows = await ctx.fns.procs.db.select({
                sql: 'SELECT s.agent, s.idx, a.title, m.ts FROM jsonb_to_recordset(?::jsonb) AS s(agent text, idx integer) LEFT JOIN agents a ON a.id = s.agent LEFT JOIN messages m ON m.agent_id = s.agent AND m.idx = s.idx',
                params: [JSON.stringify([...groups.values()].map(({ agent, idx }) => ({ agent, idx })))],
            });
            for (const row of rows) metadata.set(row.agent + ':' + row.idx, { title: row.title, ts: row.ts });
        } catch { /* Backlinks remain usable when metadata is unavailable. */ }
    }
    const cards = [...groups.entries()].map(([key, group]) => {
        const info = metadata.get(key);
        const title = info?.title?.trim() || group.agent;
        const timestamp = info?.ts == null ? NaN : Number(info.ts);
        const date = Number.isFinite(timestamp) ? new Date(timestamp) : null;
        const iso = date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
        const quote = group.evidence[0] ?? '';
        const short = quote.length > 240 ? quote.slice(0, 239) + '…' : quote;
        const chips = [...group.attributes].map(attribute => '<span class="rounded-full border border-base-300 px-2 py-0.5 font-mono text-3xs">' + esc(attribute) + '</span>').join('');
        return '<article class="rounded-lg border border-base-300 p-3"><a class="block truncate text-sm font-medium text-primary hover:underline" href="/agent/' + encodeURIComponent(group.agent) + '/message/' + group.idx + '">' + esc(title) + '</a><div class="mt-1 text-2xs text-faint">Message ' + group.idx + (iso ? ' · <time datetime="' + iso + '">' + esc(iso.slice(0, 10)) + '</time>' : '') + '</div>' + (short ? '<blockquote class="mt-2 text-xs leading-5 text-subtle">' + esc(short) + '</blockquote>' : '') + '<div class="mt-2 flex flex-wrap gap-1">' + chips + '</div></article>';
    }).join('');
    return { count: groups.size, html: '<section class="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm"><h2 class="mb-3 text-sm font-semibold">Mentioned in <span class="font-normal text-faint">' + groups.size + '</span></h2><div class="space-y-2">' + (cards || '<p class="py-2 text-xs text-faint">No chat message sources recorded. Messages appear here when observations include an explicit source-message link.</p>') + '</div></section>' };
}
