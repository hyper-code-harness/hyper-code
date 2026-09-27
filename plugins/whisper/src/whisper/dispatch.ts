/**
 * Maps one finished spoken phrase to a single Hyper runtime call (command name + opts) without executing it.
 * Rule-based, Russian and English: "switch to/открой <agent>" → ui.openAgent, "stop/стоп" → agent.stop,
 * "new agent/новый агент ..." → ui.createAgent, anything else → ui.sendToAgent to the focused agent.
 * Agent names are fuzzy-matched against session titles and ids (Cyrillic transliterated). Use as the top-level voice dispatcher.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Finished transcript of one utterance. */
    text: string;
    /** Id of the agent that currently has voice focus; receives plain dictation. */
    focusAgentId?: string;
}): Promise<{ command: string | null; opts: Record<string, unknown>; reason: string; match?: { id: string; title: string; score: number }[] }> {
    const raw = (opts.text ?? "").trim();
    const text = raw.toLowerCase().replace(/[.,!?…:;«»"]+/g, " ").replace(/\s+/g, " ").trim();
    const focus = opts.focusAgentId || undefined;
    if (!text) return { command: null, opts: {}, reason: "empty" };

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
    const STOP = /^(?:стоп|stop|останови(?:сь)?|хватит|отмена|cancel|abort)(?:\s+(.+))?$/;
    const NEW = /^(?:создай|новый|new|create|start)\s+(?:нового\s+)?(?:агент[а]?|agent|чат|chat|задач[уа]|task)(?:\s+(.+))?$/;

    const best = (ms: Match[]) => (ms[0] && ms[0].score >= 0.6 ? ms[0] : null);
    let m = text.match(NEW);
    if (m) return { command: "ui.createAgent", opts: { open: true, ...(m[1] ? { startText: raw.slice(raw.length - m[1].length) } : {}) }, reason: "new agent phrase" };

    m = text.match(STOP);
    if (m) {
        if (m[1]) { const match = findAgent(m[1]), b = best(match); if (b) return { command: "agent.stop", opts: { agentId: b.id }, reason: `stop named agent "${b.title}"`, match }; }
        if (focus) return { command: "agent.stop", opts: { agentId: focus }, reason: "stop focused agent" };
        return { command: null, opts: {}, reason: "stop, but no focused agent" };
    }

    m = text.match(SWITCH);
    if (m) {
        const match = findAgent(m[1] ?? ""), b = best(match);
        if (b) return { command: "ui.openAgent", opts: { agentId: b.id }, reason: `switch to "${b.title}"`, match };
        return { command: null, opts: {}, reason: `switch phrase, no agent like "${m[1]}"`, match };
    }

    if (focus) return { command: "ui.sendToAgent", opts: { agentId: focus, text: raw }, reason: "dictation to focused agent" };
    return { command: null, opts: { text: raw }, reason: "dictation, no focused agent" };
}
