/**
 * Guarantee a reachable Chrome, launching one only if none answers.
 *
 * Every browser function needs this precondition, so it lives in one place
 * instead of being re-checked (or forgotten) at each call site.
 *
 * @param opts.noStart Only check; never launch. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts?: { /** Only check; never launch. @default false */ noStart?: boolean },
): Promise<{ running: boolean; browserUrl: string; started: boolean }> {
    const browserUrl = ctx.fns.procs.env.cdpUrl({});
    const alive = async () => { try { return (await fetch(`${browserUrl}/json/version`)).ok; } catch { return false; } };

    if (await alive()) return { running: true, browserUrl, started: false };
    if (opts?.noStart) throw new Error(`Chrome is not reachable at ${browserUrl}`);

    await ctx.fns.chrome.start({});
    if (await alive()) return { running: true, browserUrl, started: true };
    throw new Error(`Chrome is still not reachable at ${browserUrl} after chrome.start`);
}
