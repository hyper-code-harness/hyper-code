/**
 * Runs a bash command on a remote SSH server over a persistent multiplexed connection.
 *
 * Executes the command with `bash -lc` (PATH extended with ~/.bun/bin, ~/.local/bin, ~/.cargo/bin, Homebrew and /usr/local/bin) on the named host from ~/.ssh/config or HYPER_SSH_CONFIG (list them with remote.servers; connection options come from remote.sshOptions). The first call opens an OpenSSH ControlMaster socket kept alive for 30 minutes, so later calls reuse it and start in tens of milliseconds. Non-interactive (BatchMode): key-based auth only. The script is sent over stdin (not argv), so commands and exported secrets stay out of the remote process list; optional stdin is piped to the command after it, which makes it suitable for writing files. On timeout the remote process tree is terminated as well. Use it for remote shell work and as the transport under host-aware tools.
 * @param opts.host SSH host alias from ~/.ssh/config, as returned by remote.servers.
 * @param opts.command Bash source executed remotely via bash -lc.
 * @param opts.cwd Remote working directory; ~ and ~/ prefixes resolve to the remote home.
 * @param opts.stdin Text piped to the remote command's standard input.
 * @param opts.timeout Seconds before the local ssh process is killed. @default 120 @minimum 1
 * @param opts.maxOutput Maximum characters kept per stream (stdout and stderr each); the rest is dropped and noted. @default 10485760 @minimum 1024
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config, as returned by remote.servers. */
        host: string;
        /** Bash source executed remotely via bash -lc. */
        command: string;
        /** Remote working directory; ~ and ~/ prefixes resolve to the remote home. */
        cwd?: string;
        /** Text piped to the remote command's standard input. */
        stdin?: string;
        /** Seconds before the local ssh process is killed. @default 120 @minimum 1 */
        timeout?: number;
        /** Maximum characters kept per stream (stdout and stderr each); the rest is dropped and noted. @default 10485760 @minimum 1024 */
        maxOutput?: number;
    },
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; ms: number }> {
    if (!/^[A-Za-z0-9._@-]+$/.test(opts.host)) throw new Error("invalid host: " + opts.host);
    const ssh = await ctx.fns.remote.sshOptions({});
    // Non-interactive login shells skip ~/.zshrc, so user tools (bun, brew, docker)
    // are missing from PATH. Prepend the usual per-user and Homebrew locations.
    const pathPrefix = ctx.fns.remote.shellPrelude({});
    const remote = pathPrefix + (opts.cwd ? "cd " + ctx.fns.remote.quote({ value: opts.cwd, path: true }) + " && " + opts.command : opts.command);
    // The script travels over stdin, framed by its byte length, so neither the
    // command nor exported secrets appear in the remote process list; any caller
    // stdin follows the script on the same stream. The first stderr line carries
    // the remote shell PID so a timeout can kill the remote process tree too.
    // The wrapper shell is the session/process-group leader on the remote side
    // (sshd starts it with setsid), so a timeout can kill the whole group —
    // including children that were orphaned or backgrounded.
    const wrapper = 'IFS= read -r n; echo "__HYPER_PID=$$ __HYPER_PGID=$(ps -o pgid= -p $$ | tr -d " ")" >&2; s=$(dd bs=1 count="$n" 2>/dev/null); eval "$s"';
    const cmd = [ssh.bin, "-T", ...ssh.args, opts.host, "exec bash -lc " + shq(wrapper)];
    function shq(s: string) { return ctx.fns.remote.quote({ value: s }); }
    const started = Date.now();
    const script = Buffer.from(remote);
    const MAX = Math.max(1024, opts.maxOutput ?? 10 * 1024 * 1024);
    const p = Bun.spawn({ cmd, stdin: "pipe", stdout: "pipe", stderr: "pipe" });

    // Readers and the deadline start before stdin is written: a command that
    // never reads a large stdin would otherwise block us before any timeout.
    let out = "", err = "", remotePid = 0, remotePgid = 0, truncated = false, pidBuf = "";
    const dec1 = new TextDecoder(), dec2 = new TextDecoder();
    const keep = (acc: string, add: string) => {
        if (acc.length >= MAX) { truncated = true; return acc; }
        if (acc.length + add.length > MAX) { truncated = true; return acc + add.slice(0, MAX - acc.length); }
        return acc + add;
    };
    const pump = async (s: ReadableStream<Uint8Array>, which: 1 | 2) => {
        for await (const c of s) {
            if (which === 1) { out = keep(out, dec1.decode(c, { stream: true })); continue; }
            let text = dec2.decode(c, { stream: true });
            if (!remotePid) {
                // The marker is a whole line anywhere in stderr: ssh banners or
                // host-key warnings may come first.
                pidBuf += text;
                const m = /(^|\n)__HYPER_PID=(\d+) __HYPER_PGID=(\d*)\n/.exec(pidBuf);
                if (m) {
                    remotePid = Number(m[2]);
                    remotePgid = Number(m[3] || 0);
                    text = pidBuf.slice(0, m.index + m[1]!.length) + pidBuf.slice(m.index + m[0].length);
                    pidBuf = "";
                } else if (pidBuf.length < 4096) continue;
                else { text = pidBuf; pidBuf = ""; }
            }
            err = keep(err, text);
        }
    };
    const pumps = Promise.all([pump(p.stdout, 1), pump(p.stderr, 2)]);
    const timeoutMs = (opts.timeout ?? 120) * 1000;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<number>(resolve => { timer = setTimeout(() => { timedOut = true; p.kill(); resolve(-1); }, timeoutMs); });
    const feed = (async () => {
        try {
            p.stdin.write(`${script.length}\n`);
            p.stdin.write(script);
            if (opts.stdin != null) p.stdin.write(opts.stdin);
            await p.stdin.end();
        } catch { /* process gone: its exit code tells the story */ }
    })();
    let exitCode: number;
    try {
        exitCode = await Promise.race([p.exited, deadline]);
    } finally {
        clearTimeout(timer);
    }
    await Promise.race([Promise.all([pumps, feed]), Bun.sleep(200)]);
    if (!remotePid && pidBuf) err = keep(err, pidBuf);
    if (timedOut && remotePid) {
        // TERM the remote tree, then KILL what is left; bounded so a dead link cannot hang us.
        // Kill the process group when the shell leads its own; otherwise walk the
        // descendants. TERM first, KILL after a second.
        const kill = remotePgid && remotePgid === remotePid
            ? "kill -TERM -- -" + remotePgid + " 2>/dev/null; sleep 1; kill -KILL -- -" + remotePgid + " 2>/dev/null; true"
            : "kt(){ for c in $(pgrep -P $1); do kt $c $2; done; kill -$2 $1 2>/dev/null; }; kt " + remotePid + " TERM; sleep 1; kt " + remotePid + " KILL; true";
        const k = Bun.spawn({ cmd: [ssh.bin, "-T", ...(await ctx.fns.remote.sshOptions({ persist: false })).args, opts.host, kill], stdout: "ignore", stderr: "ignore" });
        await Promise.race([k.exited, Bun.sleep(5000).then(() => k.kill())]);
    }
    if (truncated) err = keep(err, `\n[output truncated at ${MAX} bytes]`);
    return { stdout: out, stderr: err, exitCode: timedOut ? null : exitCode, timedOut, ms: Date.now() - started };
}
