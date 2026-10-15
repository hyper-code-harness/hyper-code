// Panel card: the chat's wake-ups, schedules and watches that are still active; hidden when there are none.
export default {
    title: "Wake-ups",
    icon: "ph-alarm",
    order: 50,
    async render(ctx: Context, _session: Session | null, view: types.chat.RenderContext): Promise<types.chat.CardRow[] | null> {
        const triggers = await Promise.resolve(ctx.fns.agent.triggers({ id: view.agent.id })).catch(() => [] as any[]);
        if (!triggers.length) return null;
        const icon = (k: string) => k === "cron" ? "ph-calendar-clock" : k === "watch" ? "ph-eye" : "ph-alarm";
        const when = (t: any) => {
            const at = Number(t.nextAt ?? 0);
            return at ? new Date(at).toISOString().slice(5, 16).replace("T", " ") : undefined;
        };
        return triggers.slice(0, 4).map((t: any) => ({ icon: icon(String(t.kind)), label: String(t.prompt ?? t.kind).slice(0, 80), hint: when(t) }));
    },
} satisfies types.chat.Card;
