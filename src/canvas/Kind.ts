// One kind of canvas tab — what a `$canvas_<name>.ts` file default-exports.
//
// The framework owns the tab (canvas_items row, tab strip, persistence, the block that tells the agent what
// is open). A kind owns only what is specific to it: checking the arguments it is opened with, drawing
// the tab body, and one line saying what is on screen.

export type Kind = {
    /** Validate and normalise the arguments when a tab is opened; throw to refuse. May suggest a tab title. */
    prepare?: (ctx: Context, opts: { agentId: string; args: Record<string, any> }) => { args: Record<string, any>; title?: string } | Promise<{ args: Record<string, any>; title?: string }>;
    /** HTML of the tab body. Called on every display, so it shows fresh data. */
    render: (ctx: Context, opts: { agentId: string; item: types.canvas.Item }) => string | Promise<string>;
    /** One short line for the agent describing what the tab shows; defaults to the title and arguments. */
    describe?: (ctx: Context, opts: { item: types.canvas.Item }) => string | Promise<string>;
    /** Phosphor icon name for the tab. */
    icon?: string;
    /** The tab body reads its state live (canvas.js posts it in) instead of being re-rendered: a state change
     *  keeps the running page — its scripts, scroll and focus — and only delivers the new state. */
    liveState?: boolean;
};
