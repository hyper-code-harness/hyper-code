import { parseFragment, serialize } from "parse5";

function esc(s: any): string {
    return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]!));
}

// Assistant html is model/markdown output and may be malformed. We parse it
// with parse5 — the WHATWG-spec parser, the same algorithm the browser uses —
// and inject the re-serialized tree, so every element opened inside a bubble
// is closed inside that bubble and stray close tags are dropped. One bad
// bubble can no longer swallow the rest of the chat.
//
// Some tokenizer errors mean the tag itself is garbage, e.g. the model wrote
// `<strong Why this is better: …` without '>': the browser (and parse5) turn the
// following prose into attributes and the text silently disappears. For those
// we show the plain text in <pre> instead of the mangled tree.
const FATAL_PARSE_ERRORS = new Set([
    'unexpected-character-in-attribute-name',
    'unexpected-equals-sign-before-attribute-name',
    'unexpected-character-in-unquoted-attribute-value',
    'missing-whitespace-between-attributes',
    'unexpected-solidus-in-tag',
    'eof-in-tag',
    'eof-in-comment',
    'eof-in-script-html-comment-like-text',
]);
function safeAssistantHtml(html: string): string | null {
    let fatal = false;
    const fragment = parseFragment(html, { onParseError: (err) => { if (FATAL_PARSE_ERRORS.has(err.code)) fatal = true; } });
    return fatal ? null : serialize(fragment);
}

// The right-click menu of a chat message (w.menu items): copy its text, delete it, delete from it on.
function messageActions(idx: any, agentId: string): Array<"-" | { label: string; icon?: string; action?: types.w.Action; danger?: boolean }> {
    const items: Array<"-" | { label: string; icon?: string; action?: types.w.Action; danger?: boolean }> = [{ label: 'Copy text', icon: 'copy', action: { action: 'copy-text' } }];
    if (!agentId) return items;
    const url = '/agent/' + encodeURIComponent(agentId) + '/messages/delete';
    const del = (mode: 'one' | 'from', confirm: string) => ({ post: url, swap: 'none' as const, vals: { idx: String(idx), mode }, confirm });
    return [...items, '-',
        { label: 'Delete message', icon: 'trash', danger: true, action: del('one', 'delete this message?') },
        { label: 'Delete from here', icon: 'arrow-line-down', danger: true, action: del('from', 'delete this and everything after?') }];
}

/** Render event html for the runtime.  * @param opts.event Agent event to render.
 * @param opts.agentId Target agent identifier.
*/
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Event to persist or render. */
event: any;
        /** Agent id used by the operation. */
agentId?: string }): Promise<string> {

// @mentions of known people become chips; a renderer without the mentions module keeps the plain text.
async function mentionChips(ctx: Context, html: string, tone: 'dark' | 'light'): Promise<string> {
    const highlight = (ctx.fns as any).mentions?.highlight;
    return highlight ? await highlight({ html, tone }).catch(() => html) : html;
}
    const ev = opts.event;
    const agentId = String(opts.agentId ?? ev?.agentId ?? '');
    if (!ev || typeof ev !== "object") return "";
    const ts = Number(ev.ts) || undefined;
    // Lifecycle events (plan, goal, wake, delegation, compaction…) are quiet lines in the conversation
    // (w.eventNote), not cards: a tone on the icon, a short badge, the body under the line, details folded.
    type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
    const wTone = (tone?: Tone): types.w.Tone => tone === 'error' ? 'danger' : (tone ?? 'neutral');
    const eventCard = (card: { title: string; icon?: string; tone?: Tone; badge?: string; body?: string; details?: string; href?: string }) =>
        ctx.fns.w.eventNote({ text: card.title, icon: card.icon, tone: wTone(card.tone), badge: card.badge, body: card.body, details: card.details, href: card.href, ts });
    // The badge is its label; the note draws it in the note's tone.
    const badge = (label: string, _tone?: Tone) => label;
    // Atoms for the parts inside a note: a literal line, a paragraph, a JSON dump.
    const literal = (text: string) => ctx.fns.w.box({ body: esc(text), mix: { mono: true, text: 'small' } });
    const para = (html: string, mix: types.w.Mixin = {}) => ctx.fns.w.box({ body: html, mix: [{ padY: 's1' }, mix] });
    const dump = (text: string) => ctx.fns.w.code({ code: text, lang: 'json' });

    if (ev.excludedFromLlm) {
        // Collapsed out of the LLM's view after a successful correction — the audit stays visible, dimmed.
        const inner: string = await (ctx as any).fns.agent.renderEventHtml({ event: { ...ev, excludedFromLlm: false }, agentId });
        return ctx.fns.w.dim({ body: inner, label: 'outside context' });
    }

    if (ev.type === "user") {
        const idx = ev.messageIdx ?? ev.idx ?? 0;
        const id = 'm-' + idx;
        const actions = messageActions(idx, agentId);
        // Another agent speaking in this chat under its own name (agent.message): an incoming message
        // with the sender's face and name/link, hop counter and the owner it acts for.
        if (ev.agentMessage || String(ev.actor ?? '').startsWith('agent:')) {
            const am = ev.agentMessage ?? {};
            const fromId = String(am.from ?? String(ev.actor ?? '').slice(6));
            const sender = (ctx as any).fns.auth?.author ? await (ctx as any).fns.auth.author({ userId: 'agent:' + fromId }).catch(() => null) : null;
            const name = sender?.name ?? ('agent ' + fromId);
            const body = String(am.body ?? ev.text ?? '');
            const ownerName = am.onBehalfOf ? await (ctx as any).fns.auth?.getUser?.({ id: String(am.onBehalfOf) }).then((u: any) => u?.name ?? null).catch(() => null) : null;
            const meta = ['agent', am.hop ? 'hop ' + am.hop : '', ownerName ? 'for ' + ownerName : ''].filter(Boolean).join(' · ');
            const href = '/agent/' + encodeURIComponent(fromId);
            const avatar = '<a href="' + esc(href) + '" title="' + esc(name) + '" data-author="agent:' + esc(fromId) + '">' + await ctx.fns.w.avatar({ agentId: fromId, name, size: 32 }) + '</a>';
            return ctx.fns.w.message({ role: 'peer', id, author: name, authorHref: href, meta, avatar, html: esc(body), ts, actions, marks: { 'agent-message': fromId } });
        }
        // Function RAG for this turn: the gate's state and one dot per injected function, the details on hover.
        const rag = ev.functionRag;
        let trail = '';
        if (rag) {
            const fns = Array.isArray(rag.functions) ? rag.functions : [];
            const names = fns.map((item: any) => String(typeof item === "string" ? item : item?.name ?? "")).filter(Boolean);
            const gate = String(rag.gate ?? "off");
            const retrieved = Number(rag.retrieved ?? 0);
            const scores = fns.filter((fn: any) => typeof fn !== 'string').map((fn: any) => `${fn.name}: RRF ${fn.score ?? 'n/a'} · BM25 ${fn.bm25 ?? 'n/a'} · cosine ${fn.similarity ?? 'n/a'} · rerank ${fn.jev ?? 'n/a'}`).join(' · ');
            const gateTip = `gate ${gate}` + (rag.needsTool == null ? '' : ` · heuristic score ${Number(rag.needsTool).toFixed(2)}`)
                + (gate === 'error' ? ' · classification failed; retrieval allowed' : gate === 'closed' ? ' · no retrieval, nothing injected' : ` · retrieved ${retrieved}`);
            const gateState = gate === 'closed' ? 'idle' : gate === 'error' ? 'error' : gate === 'off' ? 'idle' : 'warning';
            const injected = String(rag.injected ?? names.join(', '));
            const ragTip = `Function RAG: retrieved ${retrieved} · kept ${names.length} · rerank ${rag.rerankStatus ?? (rag.reranked === true ? 'ok' : 'off')}${scores ? ' · ' + scores : ''}${injected ? ' · ' + injected : ''}`;
            trail = ctx.fns.w.tooltip({ label: gateTip, html: ctx.fns.w.dot({ state: gateState }) })
                + ctx.fns.w.tooltip({ label: ragTip, html: names.length ? names.map(() => ctx.fns.w.dot({ state: rag.reranked === true ? 'done' : 'unread' })).join('') : ctx.fns.w.badge({ text: 0 }) });
        }
        const attachments = (Array.isArray(ev.attachments) ? ev.attachments : []).map((item: any) => ({
            url: '/attachments/' + encodeURIComponent(agentId) + '/' + encodeURIComponent(String(item.id)),
            name: String(item.fileName ?? 'file'),
            image: String(item.mimeType).startsWith('image/'),
        }));
        // Messenger-style author (only when several people share the chat): name inside the bubble, face beside it.
        const author = (ctx as any).fns.auth?.author ? await (ctx as any).fns.auth.author({ userId: ev.actor ?? null }).catch(() => null) : null;
        const avatar = author ? '<span data-author="' + esc(author.id) + '">' + await ctx.fns.w.avatar({ name: author.name, src: author.picture || undefined, size: 24 }) + '</span>' : undefined;
        return ctx.fns.w.message({ role: 'user', id, author: author?.name, avatar, html: ev.text ? await mentionChips(ctx, esc(ev.text), 'dark') : '', ts, trail, attachments, actions });
    }

    if (ev.type === "assistant") {
        const idx = ev.messageIdx ?? ev.idx ?? 0;
        // A quiet mark that the person's status line was applied to this answer.
        const statusLine = ev.instructionIndicators?.statusLine;
        const trail = statusLine ? ctx.fns.w.tooltip({ label: 'Status line: ' + String(statusLine), html: `<span aria-label="status line applied">${ctx.fns.w.dot({ state: 'idle' })}</span>` }) : '';
        // Defensive: if the pre-rendered html is unbalanced (markdown.render sometimes chokes on heredoc / shell
        // `>` / mixed-code prose) fall back to the plain text as code. One bad answer must not break the page.
        const rawHtml = ev.html || ('<p>' + esc(ev.text || '') + '</p>');
        const safe = safeAssistantHtml(rawHtml) ?? await ctx.fns.w.code({ code: String(ev.text || '') });
        return ctx.fns.w.message({ role: 'agent', id: 'm-' + idx, html: await mentionChips(ctx, safe, 'light'), ts, trail, actions: messageActions(idx, agentId) });
    }
    if (ev.type === "thinking") {
        return ctx.fns.w.thinking({ text: String(ev.text ?? ''), seconds: Number(ev.seconds ?? ev.durationSec) || undefined });
    }

    if (ev.type === "tool_call") {
        // Alone, a call is a one-cell row; the transcript draws runs of calls as one row (agent.renderEventsHtml).
        return ctx.fns.agent.renderToolRun({ agentId, events: [ev] });
    }

    // "Message received; here is what is blocking it." This card is a permanent
    // transcript entry; the ticking card above the composer is live. Both can
    // appear at once: one records history, the other shows the current state.
    if (ev.type === "tool_busy") {
        const secs = Number(ev.elapsedSec ?? 0);
        const mins = Math.floor(secs / 60);
        const been = mins >= 1 ? `${mins} min` : `${secs} s`;
        const limit = Number(ev.timeoutMs) > 0 ? ` of a ${Math.round(Number(ev.timeoutMs) / 60000)} min limit` : '';
        const stop = ev.runId && agentId
            ? para(ctx.fns.w.button({ label: `Stop ${String(ev.name ?? 'tool')}`, size: "sm", action: { post: `/agent/${encodeURIComponent(agentId)}/tool/${encodeURIComponent(String(ev.runId))}/abort`, swap: 'none' }, marks: { action: 'abort-tool-call' }, title: 'Stop only this call — the agent will continue and read your message' }))
            : '';
        return eventCard({
            title: `Message received: ${String(ev.name ?? 'tool')} had been running for ${been}${limit}`,
            icon: 'hourglass-high',
            tone: 'warning',
            body: literal(String(ev.subject ?? ''))
                + para('Message received and queued — the agent will read it when the call finishes.') + stop,
        });
    }

    if (ev.type === "tool_aborted") {
        return eventCard({
            title: `Call ${String(ev.name ?? 'tool')} stopped by the user`,
            icon: 'hand-palm',
            tone: 'warning',
            badge: badge(`${Number(ev.elapsedSec ?? 0)}s`, 'warning'),
            body: literal(String(ev.subject ?? '')),
        });
    }

    if (ev.type === "input") {
        // A chat input (input.request): the card renders the row's CURRENT state,
        // so the same event shows the live form first and the answer later.
        return (ctx as any).fns.input?.card ? await (ctx as any).fns.input.card({ id: String(ev.inputId ?? '') }) : '';
    }

    if (ev.type === "canvas_ping") {
        // A canvas tab's page called hyper.ping: it woke the agent with this.
        const data = ev.data === undefined ? "" : JSON.stringify(ev.data, null, 2);
        return eventCard({ title: `Canvas: ${String(ev.title ?? "tab")}`, icon: 'square-half', tone: 'info', body: esc(String(ev.text ?? "")), details: data ? await dump(data) : undefined });
    }

    if (ev.type === "plan_activation") {
        return eventCard({ title: 'Plan task injected', icon: 'list-checks', tone: 'info', body: ctx.fns.w.box({ body: esc(ev.title ?? ev.taskId ?? "Task"), mix: { weight: 'strong' } }) + (ev.instructions ? para(esc(ev.instructions)) : "") });
    }


    if (ev.type === "attachment_event") {
        const source = String(ev.source ?? "external");
        const payload = ev.payload && typeof ev.payload === "object" ? ev.payload : {};
        const isTelegram = source === "telegram";
        const chat = String(payload.chatTitle ?? payload.chatId ?? source);
        const sender = String(payload.senderName ?? payload.senderId ?? "");
        const text = String(payload.text ?? payload.summary ?? "");
        const title = isTelegram ? `${chat} · new message` : `${source} · ${String(ev.eventType ?? "new event")}`;
        const body = (sender ? ctx.fns.w.box({ body: esc(sender), mix: { text: 'small', weight: 'strong' } }) : "") + para(esc(text));
        const details = await dump(JSON.stringify(payload, null, 2));
        return eventCard({ title, icon: isTelegram ? "telegram-logo" : "broadcast", tone: "info", badge: badge(source, "info"), body, details });
    }


    if (ev.type === "wake_up") {
        const watched = !!ev.watchId;
        const ready = ev.watchStatus === "ready";
        const title = watched ? (ready ? "Condition met" : "Condition timed out") : "Scheduled wake-up";
        const icon = watched ? (ready ? "ph-check-circle" : "ph-timer") : "ph-alarm";
        const result = ev.result == null ? "" : JSON.stringify(ev.result, null, 2);
        return eventCard({ title, icon: icon.replace(/^ph-/, ''), tone: ready || !watched ? 'info' : 'warning', badge: watched ? badge('watch', ready ? 'success' : 'warning') : undefined, body: esc(ev.reason ?? ev.summary ?? ""), details: result ? await dump(result) : undefined });
    }


    if (ev.type === "parked") {
        // The quota is spent, not the agent broken. Say when it resumes and by
        // whose doing — otherwise a silent agent reads as a hang.
        const account = ev.account && ev.account !== "default" ? `/${ev.account}` : "";
        const resetsAt = Number(ev.resetsAt ?? ev.wakeAt ?? 0);
        const when = resetsAt ? new Date(resetsAt).toLocaleString() : "time unknown";
        return eventCard({
            title: "Parked — subscription limit",
            icon: "pause-circle",
            tone: "warning",
            badge: badge(`${ev.provider ?? "provider"}${account}`, "warning"),
            body: `${esc(ev.message ?? "Quota exhausted.")}${para(`I will wake automatically at ${esc(when)} and continue. To resume sooner, switch models or accounts.`, { ink: 'faint' })}`,
        });
    }

    if (ev.type === "unparked") {
        const why = ev.reason === "wake" ? "quota restored" : ev.reason === "model-switch" ? "model changed" : "cleared manually";
        return eventCard({
            title: "Unparked",
            icon: "play-circle",
            tone: "info",
            body: `${esc(why)}${ev.resumed ? " — resuming unfinished work" : ""}`,
        });
    }

    if (ev.type === "model_changed") {
        return eventCard({
            title: "Model changed",
            icon: "swap",
            tone: "info",
            body: literal(`${ev.from ?? "?"} → ${ev.to ?? "?"}`),
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
        return eventCard({ title: `Goal check: ${status}${count}`, icon: icon.replace(/^ph-/, ''), tone, badge: badge(status, tone), body: esc(ev.reason ?? '') + (ev.nextStep ? para('Next: ' + esc(ev.nextStep)) : '') });
    }


    if (ev.type === "attempt") {
        // A protocol-invalid candidate that was repaired before commit — never
        // part of the LLM transcript; kept for the audit trail.
        return ctx.fns.w.dim({ body: eventCard({ title: 'Invalid attempt · repaired before commit', icon: 'wrench', tone: 'warning', badge: badge('audit', 'warning'), body: esc(String(ev.error ?? '').slice(0, 160)), details: await ctx.fns.w.code({ code: String(ev.text ?? '') }) }) });
    }

    if (ev.type === "team_update") {
        const title = ev.taskTitle ? `Agent ${ev.memberId} · ${ev.taskTitle}` : `Agent ${ev.memberId} · ${ev.event}`;
        return eventCard({ title, icon: 'users-three', tone: ev.event === 'failed' || ev.event === 'blocked' ? 'error' : ev.event === 'completed' ? 'success' : 'info', badge: badge(String(ev.event ?? 'update'), ev.event === 'failed' || ev.event === 'blocked' ? 'error' : ev.event === 'completed' ? 'success' : 'info'), href: '/agent/' + encodeURIComponent(String(ev.memberId ?? '')), body: esc(ev.summary ?? '') });
    }


    if (ev.type === "compaction_start") {
        // A quiet divider in the conversation, not a card: the work itself is shown when it completes.
        return ctx.fns.w.divider({ label: `Compacting context · v${Number(ev.revision ?? 0)}…`, icon: 'arrows-in-line-vertical' });
    }
    if (ev.type === "compaction_completed") {
        const before = Math.round(Number(ev.tokensBefore ?? 0) / 1000);
        const after = Math.round(Number(ev.tokensAfter ?? 0) / 1000);
        return eventCard({ title: `Context compacted · ${before}k → ${after}k`, icon: 'arrows-in-line-vertical', tone: 'success', badge: badge(`${Number(ev.keptMessages ?? 0)} kept`, 'success'), details: para(esc(ev.summary ?? '')) });
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

    if (ev.type === "stopped") {
        return ctx.fns.w.eventNote({ text: 'stopped by user', icon: 'stop-circle', ts });
    }

    if (ev.type === "job") {
        return '';
    }

    if (ev.type === "turn") {
        // The turn's total under its answer: overall time, calls, failures. A quick reply without tools says nothing.
        const ms = Number(ev.durationMs ?? 0);
        const tools = Number(ev.tools ?? 0);
        // The tool row already ends in the turn's time; a separate line only for a long turn without tools, or a stop/error.
        if (ev.outcome === 'ok' && (tools > 0 || ms < 5000)) return '';
        const s = Math.round(ms / 1000);
        const time = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`;
        const think = Math.round(Number(ev.thinkMs ?? 0) / 1000);
        const parts = [time, tools ? `${tools} tool call${tools === 1 ? '' : 's'}` : '', Number(ev.errors) ? `${Number(ev.errors)} failed` : '', ev.outcome === 'stopped' ? 'stopped' : ev.outcome === 'error' ? 'error' : ''].filter(Boolean);
        return `<div class="chat-turn w-time" title="turn ${esc(time)}${think ? ` · model ${think}s` : ''}">${ctx.fns.w.icon({ name: 'timer', size: 12 })} ${esc(parts.join(' · '))}</div>`;
    }

    return '';
}
