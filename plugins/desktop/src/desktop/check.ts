/**
 * Checks that Cua Driver is installed, running and permitted on this Mac or a remote one, and reports screen size and version.
 *
 * Call first when desktop functions fail. Reports Accessibility and Screen Recording as granted to CuaDriver.app. If permissions look missing right after granting them, or on permissions_pending errors, pass fix true: it restarts the daemon via `cua-driver permissions grant`, which re-reads the grants (someone at that Mac must approve any dialog on first setup). Install with `curl -fsSL https://cua.ai/driver/install.sh | bash` and `cua-driver telemetry disable`.
 * @param opts.host SSH host alias of a remote Mac; omit for this machine. @default local
 * @param opts.fast Restart the daemon now with the desktop.windowChangeTimeoutMs post-action window watch (default 250 ms; also applied automatically on first connect and by fix). @default false
 * @param opts.fix Restart the Cua Driver daemon through `cua-driver permissions grant` and reconnect. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias of a remote Mac; omit for this machine. @default local */
        host?: string;
        /** Restart the daemon now with the desktop.windowChangeTimeoutMs post-action window watch (default 250 ms; also applied automatically on first connect and by fix). @default false */
        fast?: boolean;
        /** Restart the Cua Driver daemon through `cua-driver permissions grant` and reconnect. @default false */
        fix?: boolean;
    },
): Promise<{ host: string; installed: boolean; version?: string; accessibility?: boolean; screenRecording?: boolean; screen?: { width: number; height: number; scale: number }; hint?: string }> {
    const host = opts.host || "local";
    const sh = async (cmd: string, timeout = 30) => host === "local"
        ? await Bun.$`bash -lc ${cmd}`.quiet().nothrow().then(r => ({ stdout: r.stdout.toString(), exitCode: r.exitCode }))
        : await ctx.fns.remote.exec({ host, command: cmd, timeout });
    const v = await sh("~/.local/bin/cua-driver --version 2>/dev/null");
    if (v.exitCode !== 0) return { host, installed: false, hint: `Install on ${host}: curl -fsSL https://cua.ai/driver/install.sh | bash -s -- --no-modify-path && ~/.local/bin/cua-driver telemetry disable, then grant CuaDriver Accessibility and Screen Recording.` };
    const version = v.stdout.trim().split(/\s+/).pop();
    if (opts.fix) {
        await ctx.fns.desktop.disconnect({ host });
        await sh("C=~/.local/bin/cua-driver; pkill -f 'cua-driver permissions grant'; $C stop >/dev/null 2>&1; sleep 2; ($C permissions grant > /tmp/cua-grant.log 2>&1 &); sleep 25; tail -3 /tmp/cua-grant.log", 60);
    }
    if (opts.fix || opts.fast) {
        await ctx.fns.desktop.disconnect({ host });
        await ctx.fns.desktop.ensureDaemon({ host, force: true });
    }
    const p = await ctx.fns.desktop.call({ host, tool: "check_permissions", allowError: true });
    const acc = p.structured?.accessibility, scr = p.structured?.screen_recording;
    const size = await ctx.fns.desktop.call({ host, tool: "get_screen_size", allowError: true });
    const screen = size.structured?.width ? { width: size.structured.width, height: size.structured.height, scale: size.structured.scale_factor ?? size.structured.scale } : undefined;
    const ok = acc === true && scr === true;
    return {
        host, installed: true, version, accessibility: acc, screenRecording: scr, ...(screen ? { screen } : {}),
        ...(ok ? {} : { hint: p.isError ? `${p.text.slice(0, 200)} — run desktop.check({ host: "${host}", fix: true })` : `Allow CuaDriver in System Settings → Privacy & Security → Accessibility and Screen Recording on ${host}, then desktop.check({ fix: true }).` }),
    };
}
