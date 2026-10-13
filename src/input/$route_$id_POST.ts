// Submit or cancel a chat input from its card. Answers with the re-rendered
// card, which htmx swaps in place: the answer on success, the same form with
// the error under it on a validation failure.
/**
 * Handles POST /input/:id — submits or cancels a chat input and returns its re-rendered card.
 * @param opts.req Incoming HTTP request.
 * @param opts.params Route path parameters.
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Incoming HTTP request. */
    req: Request;
    /** Route path parameters. */
    params: Record<string, string>;
}): Promise<Response> {
    const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    if (!await ctx.fns.auth.verifyCsrf({ req: opts.req, token: opts.req.headers.get("x-csrf-token") ?? "" })) {
        return Response.json({ error: "invalid csrf token" }, { status: 403 });
    }
    if (Number(opts.req.headers.get("content-length") ?? 0) > 1_000_000) return Response.json({ error: "input too large" }, { status: 413 });
    const id = String(opts.params.id ?? "");
    const form = await opts.req.formData();
    const values: Record<string, string | string[]> = {};
    for (const [key, raw] of form.entries()) {
        if (typeof raw !== "string") continue;
        const prev = values[key];
        values[key] = prev === undefined ? raw : Array.isArray(prev) ? [...prev, raw] : [prev, raw];
    }
    const cancel = values._action === "cancel";
    delete values._action;
    const actor = (session as any)?.user?.id ?? null;
    try {
        const out = await ctx.fns.input.submit({ id, values, cancel, actor });
        return html(await ctx.fns.input.card({ id, error: out.error ?? null }));
    } catch (error: any) {
        return Response.json({ error: String(error?.message ?? error) }, { status: 404 });
    }
}
