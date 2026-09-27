/**
 * Makes sure the Cua Driver daemon on a host runs with the configured post-action window watch timeout, restarting it when needed.
 *
 * Called automatically on the first desktop connection to each host, so the fast mode survives reboots, logouts and Cua Driver updates. Reads the daemon's environment with `ps`, and when CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS differs from the desktop.windowChangeTimeoutMs setting (default 250 ms) it restarts CuaDriver.app via `open --env`, keeping its permission identity. Call directly with force to restart anyway.
 * @param opts.host SSH host alias of a remote Mac; omit for this machine. @default local
 * @param opts.force Restart the daemon even when it already runs with the configured value. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias of a remote Mac; omit for this machine. @default local */
        host?: string;
        /** Restart the daemon even when it already runs with the configured value. @default false */
        force?: boolean;
    },
): Promise<{ host: string; timeoutMs: number; before: number | null; restarted: boolean }> {
    const host = opts.host || "local";
    const timeoutMs = (await ctx.fns.settings.getNumber({ module: "desktop", key: "windowChangeTimeoutMs", scopeType: "global", fallback: 250 })) ?? 250;
    if (timeoutMs <= 0 && !opts.force) return { host, timeoutMs, before: null, restarted: false };
    const sh = async (cmd: string, timeout = 30) => {
        if (host !== "local") return await ctx.fns.remote.exec({ host, command: cmd, timeout });
        const r = await Bun.$`bash -c ${cmd}`.quiet().nothrow();
        return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), exitCode: r.exitCode };
    };
    const probe = await sh(`P=$(pgrep -f 'CuaDriver.app/Contents/MacOS/cua-driver serve' | head -1); [ -n "$P" ] && ps eww -o command= -p $P | tr ' ' '\\n' | grep '^CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS=' || true; echo "pid=$P"`);
    const m = /CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS=(\d+)/.exec(probe.stdout);
    const before = m ? Number(m[1]) : null;
    const running = /pid=\d+/.test(probe.stdout);
    if (!opts.force && running && before === timeoutMs) return { host, timeoutMs, before, restarted: false };
    const env = timeoutMs > 0 ? `--env CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS=${Math.round(timeoutMs)}` : "";
    const r = await sh(`C=~/.local/bin/cua-driver; $C stop >/dev/null 2>&1; for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -f 'CuaDriver.app/Contents/MacOS/cua-driver serve' >/dev/null || break; sleep 0.3; done; open -n -g ${env} -a CuaDriver --args serve; for i in $(seq 1 30); do [ -S ~/Library/Caches/cua-driver/cua-driver.sock ] && $C status >/dev/null 2>&1 && break; sleep 0.3; done; $C status >/dev/null 2>&1 && echo up`, 45);
    if (!r.stdout.includes("up")) throw new Error(`desktop.ensureDaemon: Cua Driver did not come back on ${host}: ${(r.stderr || r.stdout).slice(-300)}`);
    return { host, timeoutMs, before, restarted: true };
}
