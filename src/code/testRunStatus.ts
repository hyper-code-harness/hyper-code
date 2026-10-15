/**
 * Reports whether a background test run started by code.runTests is in progress, when it started and how it exited.
 * Use to poll a run before reading its results with code.tests.
 */
export default function (ctx: Context, _session: Session | null, _opts: {}): { running: boolean; startedAt?: number; exitCode?: number | null } {
    const r = (ctx.state as any).code?.testRun;
    return r ? { running: r.running, startedAt: r.startedAt, exitCode: r.exitCode } : { running: false };
}
