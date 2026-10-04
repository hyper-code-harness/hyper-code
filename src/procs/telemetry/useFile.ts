// Point the span sink at another file. Rotation is a policy decision and lives
// outside the tracer; the tracer only guarantees that no buffered line is lost
// when the destination changes.
/**
 * Redirect buffered span writing to another NDJSON file.
 *
 * Flushes everything buffered into the current file first, so a closed page is
 * complete the moment this returns and can be compacted or deleted safely.
 *
 * @param opts.file Absolute path of the NDJSON file to append spans to from now on.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Absolute path of the NDJSON file to append spans to from now on. */
    file: string;
}): Promise<{ previous: string; file: string }> {
    const st = ctx.state.procs?.telemetry as types.procs.telemetry.State | undefined;
    if (!st) throw new Error("telemetry is not started");
    const previous = st.file;
    if (previous === opts.file) return { previous, file: opts.file };
    await ctx.fns.procs.telemetry.flush({});
    st.file = opts.file;
    return { previous, file: opts.file };
}
