/** Returns the configured default model identifier. */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<string> {
    return (await ctx.fns.settings?.getString?.({
        module: 'llm',
        scopeType: 'global',
        key: 'defaultModel',
        fallback: ctx.env.MODEL ?? 'claude-code:claude-opus-5',
    })) ?? (ctx.env.MODEL ?? 'claude-code:claude-opus-5');
}
