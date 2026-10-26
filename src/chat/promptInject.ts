/**
 * Draws the prompt-inject control of a chat's input: the opener and its popover with the mode, custom text and
 * cadence form. The opener is a quiet pencil among the meters while the chat follows the global inject, and a
 * labelled chip above the text when it has its own text or is off. The panel is drawn outside the composer form
 * (forms cannot nest) and anchors to the opener; POST /agent/:id/status-line answers with a fresh opener.
 * @param opts.agentId Chat whose prompt inject is edited.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Chat whose prompt inject is edited. */
    agentId: string;
}): Promise<{ mode: "global" | "custom" | "off"; trigger: string; panel: string }> {
    const w = ctx.fns.w;
    const id = String(opts.agentId ?? "");
    const agent = (ctx.state as any).agent?.[id] ?? await ctx.fns.session.load({ id });
    const mode = (agent?.statusLineMode ?? "global") as "global" | "custom" | "off";
    const text = String(agent?.statusLine ?? "");
    const every = Math.max(1, Number(agent?.statusLineEvery ?? 1));
    const pid = `status-line-popover-${id}`;
    const hooks = { id: `status-line-trigger-${id}`, "data-chat-part": "prompt-inject" };
    const label = mode === "off" ? "prompt inject off" : (text || "custom prompt inject…") + (mode === "custom" && text && every > 1 ? ` · every ${every} turns` : "");
    const trigger = mode === "global"
        ? w.iconButton({ icon: "note-pencil", label: "Prompt inject · global", action: { popover: pid }, attrs: hooks })
        : w.disclosure({ label, popover: pid, lead: w.icon({ name: "note-pencil", size: 14 }), title: "Edit prompt inject", attrs: hooks });
    const body = w.form({
        form: "status-line",
        post: `/agent/${encodeURIComponent(id)}/status-line`,
        target: `#status-line-trigger-${id}`,
        swap: "outerHTML",
        layout: "stack",
        body: w.field({ name: "mode", label: "Mode", control: w.select({ name: "mode", value: mode, width: "fill", options: [{ value: "global", label: "Global" }, { value: "custom", label: "Custom" }, { value: "off", label: "Off" }] }) })
            + w.field({ name: "text", label: "Custom text", control: w.textarea({ name: "text", value: text, rows: 4, maxlength: 500, placeholder: "Overrides the global Status Line…" }) })
            + w.field({ name: "every", label: "Custom cadence: every N turns", control: w.input({ name: "every", type: "number", min: 1, max: 100, value: every }) })
            + w.button({ label: "Save", tone: "primary", size: "md", submit: true, marks: { action: "save-status-line" }, wide: true }),
    });
    return { mode, trigger, panel: w.popover({ id: pid, label: "Edit prompt inject", placement: "below-end", width: 320, body }) };
}
