function esc(s: any): string {
    return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]!));
}

// Tags whose imbalance would shred the page layout when injected into
// the chat stream. We don't try to balance every tag — just the ones
// that markdown.render or assistant prose tends to produce. If even one
// of these is mis-counted we fall back to a plain <pre> wrapper so a
// single bad bubble can't break everything below it. Catches the
// "heredoc / shell `>` / unclosed code block" class of bug.
const BALANCE_TAGS = ['div', 'p', 'span', 'pre', 'code', 'details', 'ul', 'ol', 'li', 'table', 'tbody', 'thead', 'tr', 'td', 'th'];
function isHtmlBalanced(html: string): boolean {
    for (const tag of BALANCE_TAGS) {
        const opens = html.match(new RegExp(`<${tag}(?:\\s|>|/)`, 'g')) ?? [];
        const closes = html.match(new RegExp(`</${tag}\\s*>`, 'g')) ?? [];
        // Treat self-closed (<tag/>) as both open and close — they cancel out.
        const selfClose = html.match(new RegExp(`<${tag}(?:\\s[^>]*)?/>`, 'g')) ?? [];
        const open = opens.length - selfClose.length;
        if (open !== closes.length) return false;
    }
    return true;
}

function deleteControls(ctx: Context, idx: any, agentId: string, allowOne = true, allowFrom = true, placement: 'overlay' | 'side' = 'overlay'): string {
    if (!agentId) return '';
    const url = '/agent/' + encodeURIComponent(agentId) + '/messages/delete';
    const actionControl = (mode: 'one' | 'from', title: string, confirm: string, icon: string) => ctx.fns.procs.ui.button({
        action: `delete-${mode}`, appearance: 'plain', html: `<i class="ph ${icon} text-sm" aria-hidden="true"></i><span class="sr-only">${title}</span>`,
        post: url, swap: 'none', vals: { idx: String(idx), mode }, title, ariaLabel: title,
        class: 'flex size-7 items-center justify-center rounded-full border border-ui-border bg-base-100/95 text-faint shadow-sm backdrop-blur transition hover:border-error/30 hover:bg-error/10 hover:text-error focus:outline-none focus:ring-2 focus:ring-error/30',
        attrs: { 'hx-confirm': confirm, 'hx-on::after-request': 'if (event.detail.successful) location.reload();' },
    });
    return '<div class="' + (placement === 'side' ? 'flex gap-1' : 'absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100') + '">'
        + (allowOne ? actionControl('one', 'Delete message', 'delete this message?', 'ph-trash') : '')
        + (allowFrom ? actionControl('from', 'Delete from here', 'delete this and everything after?', 'ph-arrow-line-down') : '')
        + '</div>';
}

/** Render event html for the runtime.  * @param opts.event Agent event to render.
 * @param opts.agentId Target agent identifier.
*/
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Event to persist or render. */
event: any;
        /** Agent id used by the operation. */
agentId?: string }): Promise<string> {

function messageTime(ts: any): string {
    const value = Number(ts);
    if (!Number.isFinite(value)) return '';
    return new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(value));
}

function timeHtml(ts: any, tone: 'dark' | 'light', suffix = ''): string {
    const time = messageTime(ts);
    if (!time) return '';
    // Telegram-style: an inline stamp consumes only the tail of the final line.
    // It stays beside a one-liner and naturally lands at the lower-right when
    // text wraps.
    return '<span class="inline-block ml-2 whitespace-nowrap text-3xs leading-none '
        + (tone === 'dark' ? 'text-white/70' : 'text-muted')
        + '">' + esc(time) + suffix + '</span>';
}

function appendTime(html: string, ts: any, tone: 'dark' | 'light', suffix = ''): string {
    const stamp = timeHtml(ts, tone, suffix);
    if (!stamp) return html;
    // Markdown's common one-line shape is <p>…</p>. Keeping the float inside
    // that final paragraph lets it share the line instead of creating a row.
    if (/<\/p>\s*$/.test(html)) return html.replace(/<\/p>\s*$/, stamp + '</p>');
    return html + stamp;
}
    const ev = opts.event;
    const agentId = String(opts.agentId ?? ev?.agentId ?? '');
    if (!ev || typeof ev !== "object") return "";
    const eventCard = (card: any) => (ctx as any).fns.ui.chatEventCard
        ? (ctx as any).fns.ui.chatEventCard(card)
        : `<div class="w-full rounded-lg border border-ui-border bg-base-200/45 px-3 py-2"><div class="flex items-center gap-2 text-xs font-semibold">${card.icon ? `<i class="ph ph-${esc(card.icon)}"></i>` : ''}<span>${esc(card.title)}</span>${card.badge ?? ''}</div>${card.body ? `<div class="mt-1 text-2xs">${card.body}</div>` : ''}${card.details ? `<details><summary>Details</summary>${card.details}</details>` : ''}</div>`;
    const badge = (label: string, tone: 'neutral' | 'info' | 'success' | 'warning' | 'error' = 'neutral') => (ctx as any).fns.ui.statusBadge
        ? (ctx as any).fns.ui.statusBadge({ label, tone })
        : `<span class="badge badge-sm">${esc(label)}</span>`;

    if (ev.excludedFromLlm) {
        // Collapsed out of the LLM's view after a successful correction — the
        // audit stays visible, dimmed, with an out-of-context chip. Recurse
        // through the registry for the normal rendering of the same event.
        const inner: string = await (ctx as any).fns.agent.renderEventHtml({ event: { ...ev, excludedFromLlm: false }, agentId });
        return '<div class="relative opacity-50"><span class="absolute -top-2 right-2 z-10 text-3xs px-1.5 py-0.5 rounded-full border border-ui-border bg-base-200 text-subtle">вне контекста</span>' + inner + '</div>';
    }

    if (ev.type === "user") {
        const idx = ev.messageIdx ?? ev.idx ?? 0;
        const ragFunctions = Array.isArray(ev.functionRag?.functions) ? ev.functionRag.functions : [];
        const ragNames = ragFunctions.map((item: any) => String(typeof item === "string" ? item : item?.name ?? "")).filter(Boolean);
        const injected = String(ev.functionRag?.injected ?? ragNames.join("\n"));
        // Separate heuristic gate and retrieval outcomes, including empty results.
        const ragGate = String(ev.functionRag?.gate ?? "off");
        const ragReranked = ev.functionRag?.reranked === true;
        const needsTool = ev.functionRag?.needsTool;
        const retrieved = Number(ev.functionRag?.retrieved ?? 0);
        const badge = (html: string, label: string, tip: string) =>
            '<span class="group/rag relative ml-2 inline-flex items-center gap-1 align-middle" aria-label="' + esc(label) + '" tabindex="0">' + html
            + '<span role="tooltip" class="pointer-events-none invisible absolute bottom-full right-0 z-30 mb-2 w-max max-w-[32rem] whitespace-pre-wrap rounded-lg border border-ui-border bg-base-100 px-3 py-2 font-mono text-3xs leading-4 text-muted opacity-0 shadow-xl transition group-hover/rag:visible group-hover/rag:opacity-100 group-focus/rag:visible group-focus/rag:opacity-100">' + esc(tip) + '</span></span>';
        const gateBadge = !ev.functionRag ? '' : badge(
            ragGate === "closed"
                ? '<span class="h-1.5 w-1.5 rounded-full border border-white/50" aria-hidden="true"></span>'
                : ragGate === 'error' ? '<span class="text-error text-3xs" aria-hidden="true">!</span>'
                : ragGate === 'off' ? '<span class="text-white/40 text-3xs" aria-hidden="true">−</span>'
                : '<span class="h-1.5 w-1.5 rounded-full" style="background:rgb(251 191 36)" aria-hidden="true"></span>',
            `Gate: ${ragGate}`,
            `gate ${ragGate}` + (needsTool == null ? '' : ` · heuristic score ${Number(needsTool).toFixed(2)}`)
                + (ragGate === 'error' ? '\nclassification failed; retrieval allowed' : '')
                + (ragGate === 'closed' ? '\nno retrieval, nothing injected' : `\nretrieved ${retrieved}`),
        );
        const dotColor = ragReranked ? 'background:rgb(52 211 153)' : 'background:rgb(165 180 252)';
        const dots = ragNames.map(() => '<span class="h-1.5 w-1.5 rounded-full" style="' + dotColor + '" aria-hidden="true"></span>').join('');
        const scores = ragFunctions.filter((fn: any) => typeof fn !== 'string').map((fn: any) => `${fn.name}: RRF ${fn.score ?? 'n/a'} · BM25 ${fn.bm25 ?? 'n/a'} · cosine ${fn.similarity ?? 'n/a'} · rerank ${fn.jev ?? 'n/a'}`).join('\n');
        const ragIcon = gateBadge + (ev.functionRag
            ? badge(dots || '<span aria-hidden="true">0</span>', `Function RAG: retrieved ${retrieved}, kept ${ragNames.length}`,
                `retrieved ${retrieved} · kept ${ragNames.length} · rerank ${ev.functionRag.rerankStatus ?? (ragReranked ? 'ok' : 'off')}\n${scores}\n${injected}`)
            : '');
        const attachmentHtml = Array.isArray(ev.attachments) && ev.attachments.length
            ? '<div class="mb-2 flex flex-wrap justify-end gap-2">' + ev.attachments.map((item: any) => {
                const url = '/attachments/' + encodeURIComponent(agentId) + '/' + encodeURIComponent(String(item.id));
                if (String(item.mimeType).startsWith('image/')) return '<a href="' + url + '" target="_blank" rel="noopener" class="block"><img src="' + url + '" alt="' + esc(item.fileName) + '" class="h-20 max-w-40 rounded-lg border border-white/25 object-cover"></a>';
                return '<a href="' + url + '" target="_blank" rel="noopener" class="inline-flex max-w-56 items-center gap-2 rounded-lg border border-white/25 bg-black/10 px-3 py-2 text-left text-xs"><i class="ph ph-file"></i><span class="truncate">' + esc(item.fileName) + '</span></a>';
            }).join('') + '</div>'
            : '';
        return '<div class="group relative flex justify-end pb-0">'
            + '<div class="relative ml-auto max-w-[80%]">'
            + '<div class="chat-glass-primary rounded-xl px-4 py-3 text-white whitespace-pre-wrap break-words shadow-sm border border-black/20">'
            + attachmentHtml
            + appendTime((ev.text ? esc(ev.text) : '') + ragIcon, ev.ts, 'dark')
            + '</div>'
            + '<div class="absolute left-full top-1/2 z-10 ml-2 flex -translate-y-1/2 gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">' + deleteControls(ctx, idx, agentId, true, true, 'side') + '</div>'
            + '</div></div>';
    }

    if (ev.type === "assistant") {
        const idx = ev.messageIdx ?? ev.idx ?? 0;
        const usage = '';
        // Defensive: if the pre-rendered html is unbalanced (markdown.render
        const indicators = ev.instructionIndicators ?? {};
        const statusDot = indicators.statusLine
            ? '<span title="Status line: ' + esc(indicators.statusLine) + '" aria-label="status line applied" class="ml-1.5 inline-block size-1.5 rounded-full bg-base-300 align-middle"></span>'
            : '';
        const instructionMarks = statusDot;
        // sometimes chokes on heredoc / shell `>` / mixed-code prose) fall
        // back to a plain escaped <pre>. One bad bubble must not break the
        // whole page layout below it.
        const rawHtml = ev.html || ('<p>' + esc(ev.text || '') + '</p>');
        const safeHtml = isHtmlBalanced(rawHtml)
            ? rawHtml
            : '<pre class="text-xs whitespace-pre-wrap break-words">' + esc(ev.text || '') + '</pre>';
        return '<div class="group relative flex justify-start">'
            + '<div class="assistant chat-glass w-full rounded-2xl px-4 py-3 text-base-content shadow-sm border border-ui-border">'
            + '<div class="prose prose-sm max-w-none text-base-content prose-headings:text-base-content prose-p:text-base-content prose-li:text-base-content prose-strong:text-base-content prose-code:text-base-content prose-a:text-muted prose-p:my-1 prose-headings:my-2 prose-pre:my-2">'
            + appendTime(safeHtml, ev.ts, 'light', instructionMarks)
            + '</div>'
            + usage
            + '</div>'
            + '<div class="absolute left-full top-1/2 z-10 ml-2 flex -translate-y-1/2 gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">' + deleteControls(ctx, idx, agentId, true, true, 'side') + '</div>'
            + '</div>';
    }

    if (ev.type === "thinking") {
        return eventCard({ title: `Thinking · ${ev.text?.length ?? 0} chars`, icon: 'brain', tone: 'neutral', details: `<pre class="whitespace-pre-wrap font-mono text-2xs leading-snug text-muted">${esc(ev.text || '')}</pre>` });
    }

    if (ev.type === "tool_call") {
        const meta = (ctx as any).fns.agent.toolMeta({ name: ev.name, args: ev.args });
        // File-changing tools get a stronger outline; errors take precedence.
        const destructive = new Set(['write', 'edit', 'remove', 'rename']).has(String(ev.name ?? ''));
        const cardStyle = ev.isError
            ? 'border-error/55 bg-error/10 text-error'
            : destructive ? 'border-ui-border-strong bg-transparent text-muted' : 'border-ui-border-strong bg-transparent text-subtle';
        const bodyMethod = agentId && ev.idx != null ? 'agent.toolDetails' : '';
        const title = String(meta.label + ' ' + meta.subject).trim();

        return (ctx as any).fns.ui.popup({
            method: bodyMethod,
            params: { agentId, idx: Number(ev.idx) },
            html: '<i class="ph ' + esc(meta.icon) + '" aria-hidden="true"></i>',
            attrs: 'class="tool tool-tucked shrink-0 rounded-full border ' + cardStyle + '" data-tool="' + esc(ev.name || 'tool') + '" data-title="' + esc(title) + '"' + (ev.isError ? ' data-error="1"' : '') + ' title="' + esc(title) + '" aria-label="' + esc(title) + '"',
        });
    }

    if (ev.type === "plan_activation") {
        return eventCard({ title: 'Plan task injected', icon: 'list-checks', tone: 'info', body: `<div class="font-medium text-muted">${esc(ev.title ?? ev.taskId ?? "Task")}</div>${ev.instructions ? `<div class="mt-1 whitespace-pre-wrap">${esc(ev.instructions)}</div>` : ""}` });
    }


    if (ev.type === "wake_up") {
        const watched = !!ev.watchId;
        const ready = ev.watchStatus === "ready";
        const title = watched ? (ready ? "Condition met" : "Condition timed out") : "Scheduled wake-up";
        const icon = watched ? (ready ? "ph-check-circle" : "ph-timer") : "ph-alarm";
        const result = ev.result == null ? "" : JSON.stringify(ev.result, null, 2);
        return eventCard({ title, icon: icon.replace(/^ph-/, ''), tone: ready || !watched ? 'info' : 'warning', badge: watched ? badge('watch', ready ? 'success' : 'warning') : undefined, body: esc(ev.reason ?? ev.summary ?? ""), details: result ? `<pre class="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-ui-border bg-base-100 p-2 font-mono text-3xs leading-4 text-muted">${esc(result)}</pre>` : undefined });
    }


    if (ev.type === "parked") {
        // The quota is spent, not the agent broken. Say when it resumes and by
        // whose doing — otherwise a silent agent reads as a hang.
        const account = ev.account && ev.account !== "default" ? `/${ev.account}` : "";
        const resetsAt = Number(ev.resetsAt ?? ev.wakeAt ?? 0);
        const when = resetsAt ? new Date(resetsAt).toLocaleString() : "время неизвестно";
        return eventCard({
            title: "Припаркован — лимит подписки",
            icon: "pause-circle",
            tone: "warning",
            badge: badge(`${ev.provider ?? "provider"}${account}`, "warning"),
            body: `${esc(ev.message ?? "Квота исчерпана.")}<div class="mt-1 text-subtle">Проснусь сам ${esc(when)} и продолжу. Можно не ждать: переключите модель или аккаунт.</div>`,
        });
    }

    if (ev.type === "unparked") {
        const why = ev.reason === "wake" ? "квота вернулась" : ev.reason === "model-switch" ? "смена модели" : "снято вручную";
        return eventCard({
            title: "Парковка снята",
            icon: "play-circle",
            tone: "info",
            body: `${esc(why)}${ev.resumed ? " — продолжаю незаконченную работу" : ""}`,
        });
    }

    if (ev.type === "model_changed") {
        return eventCard({
            title: "Модель изменена",
            icon: "swap",
            tone: "info",
            body: `<span class="font-mono text-2xs">${esc(ev.from ?? "?")}</span> → <span class="font-mono text-2xs">${esc(ev.to ?? "?")}</span>`,
        });
    }

    if (ev.type === "goal_activation") {
        return eventCard({ title: `Goal enabled · ${Number(ev.iterations ?? 3)} iterations`, icon: 'target', tone: 'info', body: esc(ev.text ?? '') });
    }


    if (ev.type === "goal_check") {
        const status = String(ev.status ?? "unclear");
        const achieved = status === "achieved";
        const limited = status === "limit_reached";
        const tone = achieved ? 'success' : limited ? 'error' : status === 'continue' ? 'info' : 'warning';
        const icon = achieved ? "ph-check-circle" : limited ? "ph-stop-circle" : status === "continue" ? "ph-target" : "ph-warning-circle";
        const count = ev.maxIterations ? ` · ${Number(ev.iteration ?? 0)}/${Number(ev.maxIterations)}` : "";
        return eventCard({ title: `Goal check: ${status}${count}`, icon: icon.replace(/^ph-/, ''), tone, badge: badge(status, tone), body: `${esc(ev.reason ?? '')}${ev.nextStep ? `<div class="mt-1"><span class="font-medium text-muted">Next:</span> ${esc(ev.nextStep)}</div>` : ''}` });
    }


    if (ev.type === "attempt") {
        // A protocol-invalid candidate that was repaired before commit — never
        // part of the LLM transcript; kept for the audit trail.
        return '<div class="relative opacity-60">' + eventCard({ title: 'Invalid attempt · repaired before commit', icon: 'wrench', tone: 'warning', badge: badge('audit', 'warning'), body: esc(String(ev.error ?? '').slice(0, 160)), details: `<pre class="whitespace-pre-wrap break-words font-mono text-3xs text-muted">${esc(ev.text)}</pre>` }) + '</div>';
    }

    if (ev.type === "team_update") {
        const title = ev.taskTitle ? `Agent ${ev.memberId} · ${ev.taskTitle}` : `Agent ${ev.memberId} · ${ev.event}`;
        return eventCard({ title, icon: 'users-three', tone: ev.event === 'failed' || ev.event === 'blocked' ? 'error' : ev.event === 'completed' ? 'success' : 'info', badge: badge(String(ev.event ?? 'update'), ev.event === 'failed' || ev.event === 'blocked' ? 'error' : ev.event === 'completed' ? 'success' : 'info'), href: '/agent/' + encodeURIComponent(String(ev.memberId ?? '')), body: esc(ev.summary ?? ''), attrs: 'data-team-update="' + esc(ev.event) + '"' });
    }


    if (ev.type === "compaction_start") {
        return eventCard({ title: `Compacting context · v${Number(ev.revision ?? 0)}`, icon: 'arrows-in-line-vertical', tone: 'info', badge: badge('working', 'info') });
    }
    if (ev.type === "compaction_completed") {
        const before = Math.round(Number(ev.tokensBefore ?? 0) / 1000);
        const after = Math.round(Number(ev.tokensAfter ?? 0) / 1000);
        return eventCard({ title: `Context compacted · ${before}k → ${after}k`, icon: 'arrows-in-line-vertical', tone: 'success', badge: badge(`${Number(ev.keptMessages ?? 0)} kept`, 'success'), details: `<pre class="whitespace-pre-wrap text-xs text-muted">${esc(ev.summary ?? '')}</pre>` });
    }
    if (ev.type === "compaction_failed") {
        return eventCard({ title: 'Context compaction failed', icon: 'warning-circle', tone: 'error', body: `Context unchanged · ${esc(ev.error ?? '')}` });
    }


    if (ev.type === "error") {
        // Errors surface as a toast (session.appendErrorEvent notifies) and in
        // the status bar; the row stays in the events table for the audit.
        // Keeping a red slab in the transcript on top of that was three copies
        // of the same bad news, and the only one that could not be dismissed.
        return '';
    }

    if (ev.type === "job") {
        return '';
    }

    return '';
}
