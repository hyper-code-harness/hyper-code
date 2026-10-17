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
    /** The kind is an alias of a `@view` function: canvas.show opens a `view` tab of this function, its params
     *  being what `prepare` returns as args (and its title). The tab then has an address, ◀ ▶ history and opens in
     *  a browser tab; `render` only draws tabs of this kind opened before it became an alias. */
    view?: string;
    /** Phosphor icon name for the tab. */
    icon?: string;
    /** The tab shows its source as it is now (a file, a site, data read on every display) rather than a fixed
     *  picture made once. The agent's Canvas block marks a tab "live" or "snapshot from <time>", so it knows
     *  whether what the person sees can have moved on. A function decides per tab (svg markup vs tsx). */
    live?: boolean | ((item: types.canvas.Item) => boolean);
    /** The tab body reads its state live (canvas.js posts it in) instead of being re-rendered: a state change
     *  keeps the running page — its scripts, scroll and focus — and only delivers the new state. */
    liveState?: boolean;
};
