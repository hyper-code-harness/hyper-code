/** Compares Marker and MinerU on the same PDF through the unified PDF namespace.
 * Existing Markdown paths may be supplied to avoid recomputation; otherwise both engines run locally.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Absolute source PDF path. */ input: string;
    /** Existing MinerU Markdown result. */ mineruMarkdownPath?: string;
    /** Existing Marker Markdown result. */ markerMarkdownPath?: string;
    /** Output root for new parser runs. */ outputDir?: string;
    /** Timeout for each parser. @default 1800 @minimum 30 @maximum 14400 */ timeoutSeconds?: number;
}): ReturnType<typeof ctx.fns.mineru.compare> {
    return await ctx.fns.mineru.compare({ input: opts.input, mineruMarkdownPath: opts.mineruMarkdownPath, markerMarkdownPath: opts.markerMarkdownPath, outputDir: opts.outputDir, timeoutSeconds: opts.timeoutSeconds });
}
