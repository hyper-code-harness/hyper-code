/**
 * Runs an html canvas tab's `load` code on the server and returns its JSON result for the page.
 *
 * The source is the body of an async function with `ctx` in scope; whatever it returns (JSON-serialisable,
 * up to 2 MB) reaches the page as `hyper.data`. Requires the canvas.allowEval setting. Not a sandbox: the
 * code can call any runtime function, so only trusted, read-only code belongs here.
 * @param opts.source TypeScript statements ending in `return <value>`.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** TypeScript statements ending in `return <value>`. */
    source: string;
}): Promise<unknown> {
    const enabled = await ctx.fns.settings.get({ module: "canvas", scopeType: "global", key: "allowEval" });
    if (enabled !== true) throw new Error("html load code requires canvas.allowEval");
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const compiled = await transpiler.transform(`export default async function __load(ctx) {\n${opts.source}\n}`);
    const fn = new Function(compiled.replace(/export\s+default\s+/, "return "))();
    const text = JSON.stringify((await fn(ctx)) ?? null);
    if (text.length > 2_000_000) throw new Error("html load: result is limited to 2 MB");
    return JSON.parse(text);
}
