/**
 * Reads a byte range of a hyperd unit's output log by offset
 *
 * Use to read what a service, task or session printed. Pass the returned next as offset to continue where you stopped; a negative offset counts from the end.
 * @param opts.name Unit name.
 * @param opts.offset Byte offset; negative counts from the end. @default -20000
 * @param opts.limit Maximum bytes to return. @default 20000 @minimum 1 @maximum 1048576
 * @param opts.run Run number; defaults to the current run. @minimum 1
 * @param opts.day An earlier day (YYYY-MM-DD) of a daily-rolled log, gzipped or not; the answer lists `days`.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Unit name. */
        name: string;
        /** Byte offset; negative counts from the end. @default -20000 */
        offset?: number;
        /** Maximum bytes to return. @default 20000 @minimum 1 @maximum 1048576 */
        limit?: number;
        /** Run number; defaults to the current run. @minimum 1 */
        run?: number;
        /** An earlier day (YYYY-MM-DD) of a daily-rolled log, gzipped or not; the answer lists `days`. */
        day?: string;
    },
): Promise<{ run: number; day: string | null; days: string[]; bytes: number; offset: number; next: number; text: string }> {
    const q = new URLSearchParams({ offset: String(opts.offset ?? -20000), limit: String(opts.limit ?? 20000), ...(opts.run ? { run: String(opts.run) } : {}), ...(opts.day ? { day: opts.day } : {}) });
    const r = await ctx.fns.hyperd.call({ path: "/units/" + encodeURIComponent(opts.name) + "/logs?" + q });
    return { run: r.run, day: r.day ?? null, days: r.days ?? [], bytes: r.bytes, offset: r.offset, next: r.next ?? r.bytes, text: r.text };
}
