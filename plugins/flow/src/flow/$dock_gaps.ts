// Cached count of open attention gaps; never runs discovery. Kept live by /ui/gap-count.js on `flow.count`.
export default {
    label: "Gaps",
    zone: "top",
    order: 20,
    render: async (ctx: Context) => (await ctx.fns.ui.gapBadge({})) + `<script src="/ui/gap-count.js" defer></script>`,
} satisfies types.dock.Item;
