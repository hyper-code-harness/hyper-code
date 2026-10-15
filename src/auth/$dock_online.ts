// Who else is in this Hyper right now, as a column of avatars just above the person.
export default {
    label: "Who is online",
    zone: "bottom",
    order: 10,
    render: (ctx: Context) => ctx.fns.auth.onlineRegion({ layout: "column" }),
} satisfies types.dock.Item;
