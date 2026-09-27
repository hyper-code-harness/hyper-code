// ctx.state.markdown — fenced-block renderers declared by `$fence_<lang>.ts` files.
// `markdown.render` looks a block's language up here; a language nobody answers
// stays an ordinary highlighted code block.

/** Renders the body of one ```<lang> fence to an HTML fragment. Throwing falls back to the plain code block. */
export type FenceRenderer = (ctx: Context, session: Session | null, opts: { source: string; lang: string; info: string }) => Promise<string> | string;

export type State = {
    /** Fence language (lower-case) → its renderer and the file that declared it. */
    fences?: Record<string, { lang: string; module: string; rel: string; render: FenceRenderer }>;
};
