// Self-updater status: hidden while current, a muted counter when an update is available or blocked.
export default {
    label: "Hyper update",
    zone: "top",
    order: 40,
    render: (ctx: Context) => ctx.fns.ui.updateBadge({}),
} satisfies types.dock.Item;
