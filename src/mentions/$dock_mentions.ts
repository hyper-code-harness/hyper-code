// Unread @mentions of the viewer; kept live by /mentions/live.js on `mentions.changed`.
export default {
    label: "Mentions",
    zone: "top",
    order: 30,
    render: async (ctx: Context) => (await ctx.fns.mentions.badge({})) + `<script src="/mentions/live.js" defer></script>`,
} satisfies types.dock.Item;
