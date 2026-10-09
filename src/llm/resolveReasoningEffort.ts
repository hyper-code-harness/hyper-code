/**
 * Resolves an agent reasoning preference into a provider-safe effort
 *
 * Resolve auto and unsupported reasoning preferences against model capabilities. Returns the requested preference and a safe applied wire-neutral level, downgrading to the nearest supported level without overwriting the user preference.
 * @param opts.model Concrete model route.
 * @param opts.effort Agent reasoning preference. @default auto
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Concrete model route. */
        model: string;
        /** Agent reasoning preference. @default auto */
        effort?: types.llm.ReasoningEffort;
    },
): Promise<{ requested: types.llm.ReasoningEffort; applied: Exclude<types.llm.ReasoningEffort, "auto">; mode: types.llm.ReasoningProfile["mode"]; downgraded: boolean; reason: string | null }> {
    const allowed: types.llm.ReasoningEffort[] = ["auto", "off", "minimal", "low", "medium", "high", "xhigh"];
    const requested = allowed.includes(opts.effort ?? "auto") ? (opts.effort ?? "auto") : "auto";
    const caps = await ctx.fns.llm.reasoningCapabilities({ model: opts.model });
    if (requested === "auto") return { requested, applied: caps.defaultEffort, mode: caps.mode, downgraded: false, reason: null };
    if (caps.supported.includes(requested)) return { requested, applied: requested as Exclude<types.llm.ReasoningEffort, "auto">, mode: caps.mode, downgraded: false, reason: null };
    const order: Array<Exclude<types.llm.ReasoningEffort, "auto">> = ["off", "minimal", "low", "medium", "high", "xhigh"];
    const start = order.indexOf(requested as any);
    let applied: Exclude<types.llm.ReasoningEffort, "auto"> = caps.defaultEffort;
    let found = false;
    for (let i = start; i >= 0; i--) if (caps.supported.includes(order[i]!)) { applied = order[i]!; found = true; break; }
    // Nothing at or below the request (e.g. "off" on a model that always reasons): take the lowest supported level above it.
    if (!found) for (let i = start + 1; i < order.length; i++) if (caps.supported.includes(order[i]!)) { applied = order[i]!; break; }
    return { requested, applied, mode: caps.mode, downgraded: applied !== requested, reason: `${requested} is unsupported by ${opts.model}; using ${applied}` };
}
