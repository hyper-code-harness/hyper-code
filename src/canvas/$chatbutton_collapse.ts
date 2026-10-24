// Chat header button: folds the chat into a floating strip over the canvas and back (⌘\, command
// canvas.toggleChat). A plain htmx post — the server flips the row (canvas.update toggleChat) and every page of
// this chat follows canvas.changed; nothing is swapped here. Shown only while the canvas is open (ui.layout CSS).
export default {
    order: 11,
    render: (ctx: Context, _session: Session | null, view: types.chat.RenderContext) => ctx.fns.procs.ui.button({
        action: "canvas-toggle-chat",
        html: '<i class="ph ph-arrows-in-line-vertical canvas-chat-fold" aria-hidden="true"></i><i class="ph ph-arrows-out-line-vertical canvas-chat-unfold" aria-hidden="true"></i>',
        appearance: "plain",
        ariaLabel: "Collapse or expand chat — ⌘\\",
        title: "Collapse or expand chat — ⌘\\",
        post: `/canvas/${encodeURIComponent(view.agent.id)}`,
        vals: { op: "toggleChat" },
        target: "this",
        swap: "none",
        class: "canvas-chat-toggle hidden size-7 items-center justify-center rounded-full text-subtle hover:bg-base-200 hover:text-base-content",
        attrs: { "data-canvas-chat-toggle": "", "hx-disabled-elt": "this" },
    }),
} satisfies types.chat.Button;
