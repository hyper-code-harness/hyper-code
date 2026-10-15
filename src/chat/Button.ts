// A right-side header element — what a `$chatbutton_<name>.ts` file default-exports. Buttons do something
// with the chat (open the canvas, share, start a review); they sit before the panel button.
//
// Same contract as a badge: render runs on every chat render with a 1.5 s timeout; a throw, a timeout or
// null only leaves this button out. Order and hiding come from the chat.layout setting.
export type Button = {
    /** Position among the buttons, lower first; ties are broken by id. @default 100 */
    order?: number;
    /** Draws the button: trusted HTML, an item description (types.chat.Item), or null/"" to show nothing. */
    render: (ctx: Context, session: Session | null, context: types.chat.RenderContext) => string | types.chat.Item | null | Promise<string | types.chat.Item | null>;
};
