/**
 * Builds the canonical address of a view function: `/rpc/<fn>?<json>`.
 *
 * Use to link to a page made by a `@view` function (from a canvas `view` tab, a chat message, another view's
 * links). The params are serialized as JSON with sorted keys, so the same call always has the same address
 * (history, share and dedupe of tabs rely on that). Empty params give a bare `/rpc/<fn>`.
 * @param opts.fn Full dotted function name, e.g. `memory.view`.
 * @param opts.params Arguments of the call; must be JSON-serializable. @default {}
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Full dotted function name, e.g. `memory.view`. */
    fn: string;
    /** Arguments of the call; must be JSON-serializable. @default {} */
    params?: Record<string, unknown>;
}): string {
    const fn = String(opts.fn ?? "").trim();
    if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(fn)) throw new Error(`rpc.url: not a function name: ${fn}`);
    const json = ctx.fns.rpc.canonicalJson({ value: opts.params ?? {} });
    return `/rpc/${fn}${json === "{}" ? "" : "?" + encodeURIComponent(json)}`;
}
