// The live region behind the running-tool card. Returns an empty body when
// nothing is executing, which makes the card disappear on its own.
/** Handles the id active-tool get HTTP route.
 * @param opts.req Incoming HTTP request.
 * @param opts.params Route path parameters.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming HTTP request. */
        req: Request;
        /** Values bound to the operation. */
        params: Record<string, string>;
    },
): Promise<Response> {
    const id = opts.params.id!;
    const html = ctx.fns.agent.renderActiveToolCall({ agentId: id });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
