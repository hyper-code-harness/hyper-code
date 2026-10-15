// Subscription quota rings, loaded by themselves so the page shell never waits on provider I/O.
export default {
    label: "Subscription quota",
    zone: "bottom",
    order: 20,
    render: () => `<div id="quota-rings" class="w-full" hx-get="/llms/usage" hx-trigger="load" hx-swap="innerHTML" hx-target="this"></div>`,
} satisfies types.dock.Item;
