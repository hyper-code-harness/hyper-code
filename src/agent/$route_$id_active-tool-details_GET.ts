// Refresh endpoint for the running-call popup, so its timer, tail and Stop
// button stay current while the popup is open. `?body=1` is the live region's
// own poll and returns the inner body without the popup shell.
/** Handles the id active-tool-details get HTTP route.
 * @param opts.req Incoming HTTP request.
 * @param opts.params Route path parameters.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming HTTP request. */
        req: Request;
        /** Values bound to the operation. */
        params: Record<string, string>;
    },
): Response {
    const id = opts.params.id!;
    const bodyOnly = new URL(opts.req.url).searchParams.get("body") === "1";
    return ctx.fns.agent.activeToolDetails({ agentId: id, bodyOnly });
}
