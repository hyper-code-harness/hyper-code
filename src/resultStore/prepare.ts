/**
 * Prepare a bounded text preview and save oversized result text without dangling references
 *
 * Shared preparation for tool text and already serialized trigger JSON. Leaves small text inline; storage failure returns a bounded preview and error without a reference. The caller retains its own text or JSON presentation.
 * @param opts.ownerAgentId Agent owning the immutable output.
 * @param opts.kind Source label stored with the result.
 * @param opts.text Complete text, serialized by the caller exactly once.
 * @param opts.inlineLimit Maximum UTF-16 character length kept inline. @minimum 0
 * @param opts.tail Retain the last 2500 characters instead of the first. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent owning the immutable output. */
        ownerAgentId: string;
        /** Source label stored with the result. */
        kind: string;
        /** Complete text, serialized by the caller exactly once. */
        text: string;
        /** Maximum UTF-16 character length kept inline. @minimum 0 */
        inlineLimit: number;
        /** Retain the last 2500 characters instead of the first. @default false */
        tail?: boolean;
    },
): Promise<{ preview: string; originalChars: number; truncated: boolean; ref?: types.agent.ResultRef; storageError?: string }> {
    const truncated = opts.text.length > opts.inlineLimit;
    const preview = truncated ? (opts.tail ? opts.text.slice(-2500) : opts.text.slice(0,2500)) : opts.text;
    const base = {preview, originalChars:opts.text.length, truncated};
    if (!truncated) return base;
    try {return {...base,ref:await ctx.fns.resultStore.write({ownerAgentId:opts.ownerAgentId,kind:opts.kind,text:opts.text})};}
    catch (error) {return {...base,storageError:String(error instanceof Error ? error.message : error).slice(0,300)};}
}
