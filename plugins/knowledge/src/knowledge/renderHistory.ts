/**
 * Render the latest durable canonical field changes for a Knowledge entity.
 *
 * Use on entity detail pages to read at most 31 journal rows and display the latest 30 transitions, newest first, with escaped evidence and original message backlinks. Reads only the forward journal; never reconstructs older history or mutates data.
 * @param opts.id Canonical Type/slug entity identifier whose durable change journal is displayed.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Canonical Type/slug entity identifier whose durable change journal is displayed. */
        id: string;
    },
): Promise<{ html: string; count: number; hasMore: boolean }> {
    type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
    type Change = { id: string | number; attribute: string; operation: 'create' | 'add' | 'correct'; before_value: Json; after_value: Json; source_agent_id: string; source_message_idx: number; url: string; evidence: string; changed_at: string | Date };
    const rows: Change[] = await ctx.fns.procs.db.select({ sql: 'SELECT id, attribute, operation, before_value, after_value, source_agent_id, source_message_idx, url, evidence, changed_at FROM knowledge.entity_changes WHERE subject = ? ORDER BY changed_at DESC, id DESC LIMIT ?', params: [opts.id, 31] });
    const hasMore = rows.length > 30, entries = rows.slice(0, 30);
    const esc = (text: string) => ctx.fns.procs.ui.escape({ text });
    const value = (item: Json): string => {
        if (item === null) return '<span class="text-subtle">null</span>';
        if (item === '') return '<code>""</code> <span class="text-subtle">(empty string)</span>';
        if (typeof item === 'string' && /^[A-Za-z][\w-]*\/[\w.@-]+$/.test(item)) return '<a class="text-primary underline" href="/knowledge/' + esc(item.split('/').map(encodeURIComponent).join('/')) + '">' + esc(item) + '</a>';
        if (Array.isArray(item)) return item.length ? '[' + item.map(value).join(', ') + ']' : '<code>[]</code> <span class="text-subtle">(empty array)</span>';
        return esc(typeof item === 'string' ? item : JSON.stringify(item));
    };
    const cards = entries.map(row => {
        const date = new Date(row.changed_at), validDate = Number.isFinite(date.getTime());
        const timestamp = validDate ? '<time datetime="' + date.toISOString() + '">' + esc(date.toISOString().replace('T', ' ').replace('.000Z', ' UTC')) + '</time>' : esc(String(row.changed_at));
        // Build links only from the journal's original source identity; arbitrary stored URL schemes cannot become executable links.
        const source = row.source_agent_id && Number.isSafeInteger(row.source_message_idx) && row.source_message_idx >= 0
            ? '<a class="text-primary underline break-all" href="/agent/' + esc(encodeURIComponent(row.source_agent_id)) + '/message/' + row.source_message_idx + '">Source chat · ' + esc(row.source_agent_id) + ' · message ' + row.source_message_idx + '</a>'
            : '<span class="text-subtle">Source message unavailable</span>';
        const before = row.before_value === null ? '<span class="text-subtle">Not set (added)</span>' : value(row.before_value);
        const operation = row.operation === 'correct' ? 'Corrected' : 'Added';
        return '<li class="min-w-0 border-t border-base-200 py-3 first:border-t-0"><div class="flex flex-wrap items-baseline justify-between gap-2"><span class="font-mono text-xs break-all">' + esc(row.attribute) + '</span><span class="text-2xs text-subtle">' + operation + ' · ' + timestamp + '</span></div><div class="mt-2 grid min-w-0 gap-1 text-xs sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"><div class="min-w-0 whitespace-pre-wrap break-words"><span class="sr-only">Before: </span>' + before + '</div><span aria-hidden="true">→</span><div class="min-w-0 whitespace-pre-wrap break-words"><span class="sr-only">After: </span>' + value(row.after_value) + '</div></div><div class="mt-2 text-2xs">' + source + '</div><details class="mt-2 text-xs"><summary class="cursor-pointer text-subtle">Evidence</summary><p class="mt-2 whitespace-pre-wrap break-words leading-5">' + (row.evidence ? esc(row.evidence) : 'No evidence recorded.') + '</p></details></li>';
    }).join('');
    const notice = hasMore ? 'Showing the latest 30 changes; older changes are not shown.' : 'Only canonical changes recorded since the journal was enabled appear here.';
    return { count: entries.length, hasMore, html: '<section aria-labelledby="knowledge-history-heading" class="min-w-0 rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm lg:col-span-2"><h2 id="knowledge-history-heading" class="mb-2 text-sm font-semibold">History <span class="font-normal text-faint">' + entries.length + (hasMore ? '+' : '') + '</span></h2><p class="mb-3 text-xs text-subtle">' + notice + '</p>' + (cards ? '<ol>' + cards + '</ol>' : '<p class="py-2 text-xs text-subtle">No recorded canonical changes. Earlier observations are not reconstructed as history.</p>') + '</section>' };
}
