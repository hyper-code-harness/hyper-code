/**
 * Ensures the configured FRP tunnel is running and reachable
 *
 * Checks local FRP state and its public URL, restarts a missing or unhealthy tunnel with bounded exponential backoff, and returns a watch-compatible boolean. Use from startup or durable runtime watches after Hyper restarts.
 * @param opts.name Public lowercase FRP subdomain. @default hyper
 * @param opts.port Local Hyper HTTP port to expose. @default 3010 @minimum 1 @maximum 65535
 * @param opts.attempts Maximum restart attempts in this call. @default 3 @minimum 1 @maximum 6
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Public lowercase FRP subdomain. @default hyper */
        name?: string;
        /** Local Hyper HTTP port to expose. @default 3010 @minimum 1 @maximum 65535 */
        port?: number;
        /** Maximum restart attempts in this call. @default 3 @minimum 1 @maximum 6 */
        attempts?: number;
    },
): Promise<{ ok: boolean; running: boolean; restarted: boolean; attempts: number; url: string }> {
    const name = String(opts.name ?? "hyper");
        const port = Math.max(1, Math.min(65535, Number(opts.port ?? 3010)));
        const maxAttempts = Math.max(1, Math.min(6, Number(opts.attempts ?? 3)));
        const url = `https://${name}.${ctx.fns.tunnel.config({}).domain}`;
        const healthy = async () => {
            const status = await ctx.fns.tunnel.status({});
            if (!status.running || status.port !== port || status.url !== url) return false;
            try { const res = await fetch(url, { signal: AbortSignal.timeout(8_000) }); return res.status > 0 && res.status < 500; }
            catch { return false; }
        };
        if (await healthy()) return { ok: true, running: true, restarted: false, attempts: 0, url };
        let used = 0;
        for (; used < maxAttempts; used++) {
            const status = await ctx.fns.tunnel.status({});
            if (status.running) await ctx.fns.tunnel.close({ confirm: true }).catch(() => undefined);
            if (used) await Bun.sleep(Math.min(30_000, 1_000 * 2 ** used));
            try { await ctx.fns.tunnel.open({ name, port, confirm: true }); } catch {}
            await Bun.sleep(1_000);
            if (await healthy()) return { ok: true, running: true, restarted: true, attempts: used + 1, url };
        }
        return { ok: false, running: false, restarted: used > 0, attempts: used, url };
}
