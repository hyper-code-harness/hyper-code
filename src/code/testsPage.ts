/**
 * Shows the last project test run of one kind — totals, slowest files and tests, failures with their code, and a
 * Run button — as a page.
 *
 * Use for an address of the report: `/rpc/code.testsPage?{"kind":"it"}` — a canvas view tab (what the
 * `code.tests` kind opens), a chat link or a browser tab. The report with its Run button and file picker runs in
 * its own frame (the /code/tests page); the data comes from code.tests.
 * @view
 * @param opts.kind Which run to show: fast unit tests, integration, live, or all. @default "fast"
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Which run to show: fast unit tests, integration, live, or all. @default "fast" */
    kind?: "fast" | "it" | "live" | "all";
}): Promise<string> {
    const kind = ["fast", "it", "live", "all"].includes(String(opts.kind)) ? String(opts.kind) : "fast";
    return ctx.fns.rpc.frame({ src: `/code/tests?kind=${kind}`, title: "Tests" });
}
