// Compatibility alias; new callers use plugins.read({ name }).
/**
 * Reads a mounted plugin's SKILL.md workflow text by plugin or namespace name (compatibility alias of plugins.read).
 * Use plugins.read for new code; this returns only the SKILL.md path, text and whether it was cut.
 * @param opts.name Plugin container name (browser) or one of its namespaces (cdp).
 * @param opts.maxChars Longest SKILL.md text to return; longer text is cut and marked truncated. @default 20000 @minimum 1 @maximum 100000
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Plugin container name (browser) or one of its namespaces (cdp). */
        name: string;
        /** Longest SKILL.md text to return; longer text is cut and marked truncated. @default 20000 @minimum 1 @maximum 100000 */
        maxChars?: number;
    },
): Promise<{ name: string; path: string; text: string; truncated: boolean }> {
    const plugin = await ctx.fns.plugins.read({ ...opts, includeFunctions: false });
    // plugins.read returns the SKILL.md as `overview` ({ path, markdown, truncated })
    if (!plugin.overview) throw new Error(`plugins.readSkill: "${plugin.name}" ships no SKILL.md`);
    return { name: plugin.name, path: plugin.overview.path, text: plugin.overview.markdown, truncated: plugin.overview.truncated };
}
