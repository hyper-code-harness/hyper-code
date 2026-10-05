/**
 * Checks a mounted plugin's generated API documentation and reports duplicated
 * function catalogues in SKILL.md. Intended for plugin authors before release.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: { /** Mounted plugin name or namespace. */ name: string; /** Treat warnings as failure. @default false */ strict?: boolean },
): Promise<{ ok: boolean; name: string; errors: string[]; warnings: string[]; functions: number }> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let docs: ReturnType<typeof ctx.fns.plugins.docs>;
    try {
        docs = ctx.fns.plugins.docs({ name: opts.name });
    } catch (error: any) {
        return { ok: false, name: opts.name, errors: [error?.message ?? String(error)], warnings, functions: 0 };
    }
    for (const fn of docs.functions) {
        try {
            const result = await ctx.fns.runtime.docs.validate({ name: fn.name, strict: false, typecheck: false, checkIndex: false });
            errors.push(...result.errors.map((message: string) => `${fn.name}: ${message}`));
            warnings.push(...result.warnings.map((message: string) => `${fn.name}: ${message}`));
        } catch (error: any) {
            errors.push(`${fn.name}: ${error?.message ?? String(error)}`);
        }
    }
    const plugin = await ctx.fns.plugins.read({ name: opts.name, includeFunctions: false });
    const markdown = String(plugin.overview?.markdown ?? "");
    if (/^##\s+(Functions?|API|Methods?)\s*$/im.test(markdown)) {
        warnings.push("SKILL.md contains a manual function catalogue; remove it because plugins.read generates live function docs");
    }
    // A fence is an output channel an agent can only use if the system prompt
    // mentions it, and the prompt lists exactly those that export a hint.
    // Shipping one without a hint means shipping something nobody will reach.
    const fences = (ctx.state as any)?.markdown?.fences as types.markdown.State["fences"];
    for (const fence of Object.values(fences ?? {})) {
        if (fence.module !== docs.plugin.name) continue;
        if (!fence.hint) warnings.push(`${fence.rel}: export a \`hint\` so the \`\`\`${fence.lang} fence is advertised in the system prompt`);
    }
    return {
        ok: errors.length === 0 && (!opts.strict || warnings.length === 0),
        name: docs.plugin.name,
        errors,
        warnings,
        functions: docs.functions.length,
    };
}
