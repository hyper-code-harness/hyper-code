/**
 * Reports the background test run started by code.runTests: running or finished, exit code, and live counts of passed, failed and skipped tests and files against the previous run's size, with the failed test names.
 * Use to poll a run's progress before reading its full results with code.tests. Returns { running: false } when no run was started in this process.
 */
export default function (ctx: Context, _session: Session | null, _opts: {}): types.code.TestRun | { running: false } {
    const r = (ctx.state as any).code?.testRun as types.code.TestRun | undefined;
    return r ? { ...r, failed: [...(r.failed ?? [])] } : { running: false };
}
