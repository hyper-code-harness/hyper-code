// GET /canvas/:id/watch — hold one mobile request until this agent's Canvas revision changes.
/** Long-polls an agent's Canvas revision for native clients without a browser EventSource. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    const agentId = String(opts.params.id ?? "");
    const known = ((await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM agents WHERE id = ?", params: [agentId] })) as any[]).length > 0;
    if (!known) return new Response("unknown agent", { status: 404 });

    const since = new URL(opts.req.url).searchParams.get("rev") ?? "";
    const response = (rev: string, changed: boolean) => Response.json({ rev, changed }, { headers: { "cache-control": "no-store" } });
    const current = (await ctx.fns.canvas.revision({ agentId })).panel;
    if (!since || current !== since) return response(current, !!since);

    return await new Promise<Response>((resolve) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let unsubscribe = () => {};
        const finish = async (changed: boolean) => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            unsubscribe();
            opts.req.signal.removeEventListener("abort", aborted);
            const rev = (await ctx.fns.canvas.revision({ agentId })).panel;
            resolve(response(rev, changed || rev !== since));
        };
        const aborted = () => { void finish(false); };
        unsubscribe = ctx.fns.procs.events.subscribe({
            handler: (event: any) => {
                if (event?.type === "canvas.changed" && event.agentId === agentId) void finish(true);
            },
        });
        opts.req.signal.addEventListener("abort", aborted, { once: true });
        timeout = setTimeout(() => { void finish(false); }, 25_000);
        // Close the subscribe/read race: a change between the first revision read and subscription is answered now.
        void ctx.fns.canvas.revision({ agentId }).then(rev => {
            if (rev.panel !== since) void finish(true);
        });
    });
}
