/** Relay a responses wire-format request from a node client (docs/hyper-node.md).
 * @param opts.req Incoming request. */
export default async function (ctx: Context, _session: Session | null, opts: { /** Incoming request. */ req: Request }): Promise<Response> {
    return ctx.fns.node.relay({ req: opts.req, api: "responses" });
}
