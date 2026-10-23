/**
 * Launch Chrome with the CDP endpoint open, on the profile that holds the logins.
 *
 * Chrome is started inside a detached tmux session rather than as a child of the
 * runtime. A child shares the server's process group, so every Hyper restart —
 * and there are many — would take the browser with it, dropping every session
 * the profile exists to keep. On macOS a launchd agent in the user's GUI session
 * (`~/Library/LaunchAgents/xyz.hyper.chrome-cdp.plist`, or CHROME_LAUNCH_AGENT) wins: it is
 * kickstarted, since Chrome outside a GUI session hangs on system views. When a hyperd unit owns Chrome (`chrome-cdp`, or the name in
 * CHROME_UNIT) that unit is restarted instead, so there is never a second Chrome on the profile.
 *
 * @param opts.wait Seconds to wait for the debugging endpoint. @default 8
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts?: { /** Seconds to wait for the debugging endpoint. @default 8 */ wait?: number },
): Promise<{ browserUrl: string; userDataDir: string; profile: string; tmuxSession: string; unit?: string }> {
    const browserUrl = ctx.fns.procs.env.cdpUrl({});
    const port = new URL(browserUrl).port;
    if (!port) throw new Error(`CDP_BROWSER_URL needs an explicit port: ${browserUrl}`);
    const { userDataDir, profile, legacy } = await ctx.fns.chrome.profileDir({});
    const waitSec = Math.max(1, opts?.wait ?? 8);
    const answers = async () => { try { return (await fetch(`${browserUrl}/json/version`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };

    // A hyperd unit owns Chrome on this machine (~/.hyper/units/<CHROME_UNIT|chrome-cdp>.yaml): restart it
    // there and never launch a second Chrome on the same profile beside it. The supervisor's own
    // backoff may be the reason Chrome is down; restart makes it try now.
    // A launchd agent in the user's GUI session owns Chrome (~/Library/LaunchAgents/<CHROME_LAUNCH_AGENT|
    // xyz.hyper.chrome-cdp>.plist): Chrome needs that Aqua session — started from a daemon outside it, every
    // macOS system view (ViewBridge) stalls its main thread for ~10 s and CDP hangs. Restart it there.
    const agentLabel = ctx.env.CHROME_LAUNCH_AGENT || "xyz.hyper.chrome-cdp";
    if (process.platform === "darwin" && await Bun.file(`${process.env.HOME}/Library/LaunchAgents/${agentLabel}.plist`).exists()) {
        const uid = process.getuid?.() ?? 0;
        ctx.fns.procs.log.info({ event: "chrome.start", msg: `launchd agent ${agentLabel} owns Chrome; restarting it in gui/${uid}` });
        const kick = await Bun.$`launchctl kickstart -k gui/${uid}/${agentLabel}`.quiet().nothrow();
        if (kick.exitCode !== 0) throw new Error(`launchctl kickstart gui/${uid}/${agentLabel} failed: ${kick.stderr.toString().trim()} — is the user logged in to the Mac (a GUI session)?`);
        const until = Date.now() + Math.max(waitSec, 30) * 1000;
        while (Date.now() < until) {
            await Bun.sleep(500);
            if (await answers()) return { browserUrl, userDataDir, profile, tmuxSession: "", unit: `launchd:${agentLabel}` };
        }
        throw new Error(`launchd agent ${agentLabel} was restarted but Chrome did not answer at ${browserUrl} in ${Math.max(waitSec, 30)}s`);
    }

    const unitName = ctx.env.CHROME_UNIT || "chrome-cdp";
    const unit = await ctx.fns.hyperd.status({}).then((s) => s.units.find((u) => u.name === unitName)).catch(() => undefined);
    if (unit) {
        ctx.fns.procs.log.info({ event: "chrome.start", msg: `hyperd unit ${unitName} owns Chrome (${unit.state}); restarting it` });
        await ctx.fns.hyperd.restart({ name: unitName });
        const until = Date.now() + Math.max(waitSec, 30) * 1000;
        while (Date.now() < until) {
            if (await answers()) return { browserUrl, userDataDir, profile, tmuxSession: "", unit: unitName };
            await Bun.sleep(500);
        }
        throw new Error(`hyperd unit ${unitName} was restarted but Chrome did not answer at ${browserUrl} in ${Math.max(waitSec, 30)}s — see hyperd.logs({ name: "${unitName}" })`);
    }
    const bin = ctx.fns.chrome.path({});
    const tmuxSession = ctx.env.CDP_TMUX_SESSION || "chrome-cdp";

    const args = [
        bin,
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        `--profile-directory=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        // A Chrome started for another macOS user than the one at the console is a
        // background app: App Nap and Chrome's own throttling then stall DevTools
        // for ~10 s per request. Keep timers and renderers running.
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
    ];
    // An unpacked extension is optional: enterprise-managed profiles refuse it
    // by policy, and Chrome then starts fine without the side panel.
    const home = ctx.env.HOME ?? process.env.HOME ?? "";
    const ext = ctx.env.CDP_LOAD_EXTENSION ?? `${home}/uniskill/skills/browser/extensions/arc-sidebar`;
    if (ext && await Bun.file(`${ext}/manifest.json`).exists()) {
        args.push(`--load-extension=${ext}`, "--silent-debugger-extension-api");
    }

    ctx.fns.procs.log.info({
        event: "chrome.start",
        msg: `port ${port}, profile "${profile}" in ${userDataDir}${legacy ? " (legacy uniskill location)" : ""}`,
    });

    // App Nap ignores the flags above; opt Chrome out of it (macOS only, harmless if already set).
    if (process.platform === "darwin") {
        await Bun.$`defaults write com.google.Chrome NSAppSleepDisabled -bool YES`.quiet().nothrow();
    }

    const quoted = args.map(a => `'${String(a).replace(/'/g, "'\\''")}'`).join(" ");
    await Bun.$`tmux kill-session -t ${tmuxSession}`.quiet().nothrow();
    Bun.spawn(["tmux", "new-session", "-d", "-s", tmuxSession, quoted], { stdout: "ignore", stderr: "ignore" });

    const deadline = Date.now() + waitSec * 1000;
    while (Date.now() < deadline) {
        await Bun.sleep(250);
        try { if ((await fetch(`${browserUrl}/json/version`)).ok) return { browserUrl, userDataDir, profile, tmuxSession }; } catch { /* not up yet */ }
    }
    throw new Error(`Chrome did not open ${browserUrl} within ${opts?.wait ?? 8}s`);
}
