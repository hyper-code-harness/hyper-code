// Cached quota only on the shell path. The existing authenticated usage route
// refreshes provider snapshots in the background; no credentials enter the DOM.
export default {
    label: "Subscription quota",
    zone: "bottom",
    order: 4,
    render: async (ctx: Context) => ctx.fns.ui.live({
        id: "llm-usage",
        url: "/llms/usage",
        topic: "llm-usage",
        every: 60,
        trigger: "load",
        // Match the live response: usage updates must not close details being read.
        attrs: `hx-on::before:request="if (this.querySelector(':popover-open')) event.preventDefault()" hx-on::before:swap="if (this.querySelector(':popover-open')) event.preventDefault()"`,
        html: ctx.fns.ui.usageDial({ entries: await ctx.fns.llm.usageOverview({}) }),
    }),
} satisfies types.dock.Item;
