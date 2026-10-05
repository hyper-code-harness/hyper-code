// ctx.state.markdown — fenced-block renderers declared by `$fence_<lang>.ts` files.
// `markdown.render` looks a block's language up here; a language nobody answers
// stays an ordinary highlighted code block.

/** Renders the body of one ```<lang> fence to an HTML fragment. Throwing falls back to the plain code block. */
export type FenceRenderer = (ctx: Context, session: Session | null, opts: { source: string; lang: string; info: string }) => Promise<string> | string;

/**
 * One line telling an agent what this fence is for, spliced into the system prompt.
 *
 * A function instead of a string when availability is conditional — returning
 * null keeps a fence that is turned off out of the prompt entirely, so it costs
 * no tokens and nobody is told to use something that will refuse.
 */
export type FenceHint = string | ((ctx: Context) => string | null | Promise<string | null>);

export type State = {
    /** Fence language (lower-case) → its renderer, its prompt hint and the file that declared it. */
    fences?: Record<string, { lang: string; module: string; rel: string; render: FenceRenderer; hint?: FenceHint }>;
};
