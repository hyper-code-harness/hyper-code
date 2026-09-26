/**
 * Read the bearer token of a configured Hyper node from encrypted local storage
 * @param opts.name Node name.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Node name. */ name: string }): Promise<string> {
    const v = await ctx.fns.secrets.getLocal({ namespace: "node", name: `token:${String(opts.name)}` });
    if (!v) throw new Error(`node ${opts.name}: token is not configured`);
    return v;
}
