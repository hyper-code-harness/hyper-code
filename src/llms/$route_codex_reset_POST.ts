/** Consumes one finite Codex reset credit after an explicit browser confirmation. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const form = await opts.req.formData();
    const account = String(form.get("account") ?? "default");
    const creditId = String(form.get("creditId") ?? "") || undefined;
    try {
        const result = await ctx.fns.llm.consumeResetCredit({ account, creditId, idempotencyKey: crypto.randomUUID() });
        const labels = { reset: "Limit reset successfully", nothingToReset: "Nothing eligible to reset", noCredit: "No reset credits available", alreadyRedeemed: "This reset was already applied" };
        // Live regions refresh by topic; a bubbling HX-Trigger no longer reaches them.
        for (const topic of ["llm-usage", "llm-accounts"]) { try { ctx.fns.procs.events.refresh({ topic, reason: "codex reset" }); } catch {} }
        return new Response(`<span class="text-xs ${result.outcome === "reset" ? "text-success" : "text-warning"}">${labels[result.outcome]}</span>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    } catch (error: any) {
        return new Response(String(error?.message ?? error), { status: 400 });
    }
}
