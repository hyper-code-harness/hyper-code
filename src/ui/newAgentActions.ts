// Collects the answers to `ui.newAgentActions` once, for every place that draws
// them (the /agent/new page and popup, the Chats and Recent menu widgets).
// Handlers are asked one by one with a time budget, so one that throws or hangs
// loses its own items and not the others'.

/**
 * Collects the quick "new chat" actions plugins add next to New agent.
 *
 * Runs the `ui.newAgentActions` extension point and returns the valid items in registration order: each has an id, a label and exactly one of href (local path or http(s) URL) or fn (runtime function opened in the popup). Invalid items, repeated ids and failing or slow handlers are dropped and logged. Returns [] when nobody answers. Use when drawing /agent/new or a menu's New agent row.
 * @param opts.timeoutMs Per-handler budget in milliseconds. @default 1000 @minimum 50 @maximum 10000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Per-handler budget in milliseconds. @default 1000 @minimum 50 @maximum 10000 */
        timeoutMs?: number;
    } = {},
): Promise<types.ui.NewAgentAction[]> {
    const handlers = ctx.state.procs?.hooks?.handlers?.["ui.newAgentActions"];
    if (!handlers?.size) return [];
    const budget = Math.max(50, Math.min(10_000, Number(opts?.timeoutMs ?? 1000) || 1000));
    const answers = await Promise.all([...handlers].map(async ([module, fn]) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const answer = await Promise.race([
                Promise.resolve(fn(ctx, session, {})),
                new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${budget}ms`)), budget); }),
            ]);
            return Array.isArray(answer) ? answer : [];
        } catch (error: any) {
            ctx.fns.procs.log.warn({ event: "ui.new-agent-actions.failed", msg: String(error?.message ?? error), module });
            return [];
        } finally {
            if (timer) clearTimeout(timer);
        }
    }));
    const seen = new Set<string>();
    const out: types.ui.NewAgentAction[] = [];
    for (const raw of answers.flat()) {
        const item = normalize(raw);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
    }
    return out;
}

function normalize(raw: any): types.ui.NewAgentAction | null {
    if (!raw || typeof raw !== "object") return null;
    const id = String(raw.id ?? "").trim();
    const label = String(raw.label ?? "").trim();
    const href = typeof raw.href === "string" ? raw.href.trim() : "";
    const fn = typeof raw.fn === "string" ? raw.fn.trim() : "";
    if (!id || !label || !!href === !!fn) return null;
    if (href && !((href.startsWith("/") && !href.startsWith("//")) || /^https?:\/\//.test(href))) return null;
    if (fn && !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(fn)) return null;
    const icon = /^ph-[a-z0-9-]+$/.test(String(raw.icon ?? "")) ? String(raw.icon) : undefined;
    return { id, label, ...(icon ? { icon } : {}), ...(href ? { href } : { fn }) };
}
