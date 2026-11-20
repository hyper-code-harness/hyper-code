/**
 * Handles POST /skills/act — one button of the Skills pages (install, remove, allow) pressed by a signed-in person.
 * Same-origin, CSRF-checked form posts only; a call that carries an agent session is refused. Answers with the
 * re-drawn button block (skills.actions) carrying the result, and refreshes the open Skills pages.
 * @param opts.req Incoming HTTP request.
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Incoming HTTP request. */
    req: Request;
}): Promise<Response> {
    const req = opts.req;
    const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    if (req.headers.get("sec-fetch-site") === "cross-site") return new Response("Same-origin request required", { status: 403 });
    if (!await ctx.fns.auth.verifyCsrf({ req, token: req.headers.get("x-csrf-token") ?? "" })) return Response.json({ error: "invalid csrf token" }, { status: 403 });
    if (session?.agentId || session?.agent) return new Response("Agents cannot change installed skills", { status: 403 });
    if (Number(req.headers.get("content-length") ?? 0) > 8192) return new Response("Request too large", { status: 413 });
    const form = await req.formData();
    const field = (name: string) => { const v = form.get(name); return typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : undefined; };
    const op = field("op");
    if (op !== "install" && op !== "remove" && op !== "allow" && op !== "deny" && op !== "enable" && op !== "disable") return new Response("Invalid operation", { status: 400 });
    const target = { repo: field("repo"), pack: field("pack"), skill: field("skill"), ref: field("ref") };
    let message: string, tone: "success" | "danger" = "success";
    try {
        message = (await ctx.fns.skills.act({ op, ...target, all: field("all") === "1" })).message;
        ctx.fns.procs.events.refresh({ topic: "skills", reason: op });
    } catch (error: any) {
        message = String(error?.message ?? error).slice(0, 400);
        tone = "danger";
    }
    return html(await ctx.fns.skills.actions({ ...target, ...(op === "enable" || op === "disable" ? { global: true } : {}), message, tone }));
}
