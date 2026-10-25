// Chat header button: opens and closes the canvas left of the chat; /canvas/canvas.js handles the click and
// paints the pressed state.
export default {
    order: 10,
    render: (ctx: Context) => ctx.fns.w.pressable({ html: '<i class="ph ph-square-half" aria-hidden="true"></i>', label: "Open canvas", marks: { action: "toggle-canvas" }, attrs: { "data-canvas-toggle": "toggle", "aria-pressed": "false" }, class: "canvas-toggle flex size-7 items-center justify-center rounded-full text-subtle hover:bg-base-200 hover:text-base-content aria-pressed:bg-primary/10 aria-pressed:text-primary" }),
} satisfies types.chat.Button;
