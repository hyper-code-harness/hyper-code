/**
 * Resolve the private instance-wide tool result directory
 *
 * Resolves the configured absolute local instance root independently of agent workspace and SSH host. Used by result persistence and public-file access guards.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<string> {
    const { resolve, isAbsolute } = await import('node:path');
    const root = await ctx.fns.settings.getString({module:'resultStore',scopeType:'global',key:'instanceRoot',fallback:process.cwd()});
    if (!root || !isAbsolute(root)) throw new Error('resultStore.instanceRoot must be an absolute local directory');
    return resolve(root, '.hyper/results');
}
