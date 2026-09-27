/**
 * Maps one finished spoken phrase to a single Hyper runtime call (command name + opts) without executing it.
 * Rule-based, Russian and English: "switch to/открой <agent>" → ui.openAgent, "stop/стоп" → agent.stop,
 * "new agent/новый агент ..." → ui.createAgent, "кто ждёт/непрочитанные" → whisper.waiting, "отмена/cancel" → cancel of the
 * pending dictation, anything else → ui.sendToAgent to the focused agent. `confident` marks commands that are safe to act on
 * from a partial transcript (the phrase is already complete and unambiguous).
 * Agent names are fuzzy-matched against session titles and ids (Cyrillic transliterated). Use as the top-level voice dispatcher.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Finished transcript of one utterance. */
    text: string;
    /** Id of the agent that currently has voice focus; receives plain dictation. */
    focusAgentId?: string;
    /** The text is a running partial transcript; only unambiguous complete commands are marked confident. @default false */
    partial?: boolean;
}): Promise<{
    kind: "command" | "dictation" | "cancel" | "none";
    command: string | null;
    opts: Record<string, unknown>;
    reason: string;
    confident: boolean;
    match?: { id: string; title: string; score: number }[];
    preview?: unknown;
}> {
    const raw = (opts.text ?? "").trim();
    const text = raw.toLowerCase().replace(/[.,!?…:;«»"]+/g, " ").replace(/\s+/g, " ").trim();
    const focus = opts.focusAgentId || undefined;
    const partial = opts.partial === true;
    if (!text) return { kind: "none", command: null, opts: {}, reason: "empty", confident: false };

    const TR: Record<string, string> = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"i",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"ch",ш:"sh",щ:"sh",ъ:"",ы:"y",ь:"",э:"e",ю:"u",я:"ya" };
    const norm = (s: string) => s.toLowerCase().split("").map((c) => TR[c] ?? c).join("").replace(/[^a-z0-9]+/g, "");
    const lev = (a: string, b: string) => {
        let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            const cur = [i];
            for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
            prev = cur;
        }
        return prev[b.length]!;
    };
    const sim = (a: string, b: string) => { if (!a || !b) return 0; if (a === b) return 1; if (b.length >= 3 && a.includes(b)) return 0.9; return 1 - lev(a, b) / Math.max(a.length, b.length); };

    const list: any = await ctx.fns.session.list({});
    const agents: { id: string; title: string }[] = (Array.isArray(list) ? list : []).filter((s: any) => !s.archivedAt && !s.parentId && s.visibility !== "hidden").map((s: any) => ({ id: s.id, title: String(s.title || s.id) }));
    type Match = { id: string; title: string; score: number };
    const findAgent = (q: string): Match[] => {
        const nq = norm(q);
        return agents.map((a) => ({ ...a, score: Math.round(Math.max(sim(nq, norm(a.title)), sim(nq, norm(a.id)) * 0.95) * 100) / 100 }))
            .sort((x, y) => y.score - x.score).slice(0, 3);
    };

    const SWITCH = /^(?:(?:пожалуйста|please|ok|окей|давай)\s+)?(?:переключись|переключи|переключиться|перейди|открой|покажи|switch|go|open|show)(?:\s+(?:на|в|к|to|agent|агента|агент))*\s+(.+)$/;
    const STOP = /^(?:стоп|stop|останови(?:сь)?|хватит|abort)(?:\s+(.+))?$/;
    const CANCEL = /^(?:отмена|отмени|отменить|не отправляй|cancel|undo|scratch that)$/;
    const WAITING = /^(?:кто (?:ждёт|ждет|ждут)|что (?:ждёт|ждет|нового)|(?:покажи )?непрочитанн\S*|(?:who(?:'s| is)? waiting)|(?:show )?unread|inbox)$/;
    const NEW = /^(?:создай|новый|new|create|start)\s+(?:нового\s+)?(?:агент[а]?|agent|чат|chat|задач[уа]|task)(?:\s+(.+))?$/;

    const best = (ms: Match[]) => (ms[0] && ms[0].score >= 0.6 ? ms[0] : null);
    // confident on a partial only if nothing longer could still be meant (no other title extends the match)
    const sure = (b: Match) => b.score >= 0.85 && !agents.some((a) => a.id !== b.id && norm(a.title).startsWith(norm(b.title)));
    type R = Awaited<ReturnType<typeof run>>;
    async function run() {
        if (CANCEL.test(text)) return { kind: "cancel" as const, command: null, opts: {}, reason: "cancel pending dictation", confident: true };
        if (WAITING.test(text)) {
            const preview = await ctx.fns.whisper.waiting({});
            return { kind: "command" as const, command: "whisper.waiting", opts: {}, reason: "who needs attention", confident: true, preview };
        }
        let m = text.match(NEW);
        if (m) return { kind: "command" as const, command: "ui.createAgent", opts: { open: true, ...(m[1] ? { startText: raw.slice(raw.length - m[1].length) } : {}) }, reason: "new agent phrase", confident: false };
        m = text.match(STOP);
        if (m) {
            if (m[1]) {
                const match = findAgent(m[1]), b = best(match);
                if (b) return { kind: "command" as const, command: "agent.stop", opts: { agentId: b.id }, reason: `stop named agent "${b.title}"`, confident: sure(b), match };
            } else if (focus) return { kind: "command" as const, command: "agent.stop", opts: { agentId: focus }, reason: "stop focused agent", confident: true };
            else return { kind: "none" as const, command: null, opts: {}, reason: "stop, but no focused agent", confident: false };
        }
        m = text.match(SWITCH);
        if (m) {
            const match = findAgent(m[1] ?? ""), b = best(match);
            if (b) return { kind: "command" as const, command: "ui.openAgent", opts: { agentId: b.id }, reason: `switch to "${b.title}"`, confident: sure(b), match };
            if (!partial) return { kind: "none" as const, command: null, opts: {}, reason: `switch phrase, no agent like "${m[1]}"`, confident: false, match };
        }
        if (focus) return { kind: "dictation" as const, command: "ui.sendToAgent", opts: { agentId: focus, text: raw }, reason: "dictation to focused agent", confident: false };
        return { kind: "dictation" as const, command: null, opts: { text: raw }, reason: "dictation, no focused agent", confident: false };
    }
    const r: R = await run();
    return r;
}
