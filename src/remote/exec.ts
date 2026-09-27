/**
 * Runs a bash command on a remote SSH server over a persistent multiplexed connection.
 *
 * Executes the command with `bash -lc` (PATH extended with ~/.bun/bin, ~/.local/bin, ~/.cargo/bin, Homebrew and /usr/local/bin) on the named host from ~/.ssh/config or HYPER_SSH_CONFIG (list them with remote.servers; connection options come from remote.sshOptions). The first call opens an OpenSSH ControlMaster socket kept alive for 30 minutes, so later calls reuse it and start in tens of milliseconds. Non-interactive (BatchMode): key-based auth only. The script is sent over stdin (not argv), so commands and exported secrets stay out of the remote process list; optional stdin is piped to the command after it, which makes it suitable for writing files. On timeout the remote process tree is terminated as well. Use it for remote shell work and as the transport under host-aware tools.
 * @param opts.host SSH host alias from ~/.ssh/config, as returned by remote.servers.
 * @param opts.command Bash source executed remotely via bash -lc.
 * @param opts.cwd Remote working directory; ~ and ~/ prefixes resolve to the remote home.
 * @param opts.stdin Text piped to the remote command's standard input.
 * @param opts.timeout Seconds before the local ssh process is killed. @default 120 @minimum 1
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
    const wrapper = 'IFS= read -r n; echo "__HYPER_PID=$$" >&2; s=$(dd bs=1 count="$n" 2>/dev/null); eval "$s"';
    const cmd = ["ssh", "-T", ...ssh.args, opts.host, "exec bash -lc " + shq(wrapper)];
    function shq(s: string) { return ctx.fns.remote.quote({ value: s }); }
    const started = Date.now();
    const script = Buffer.from(remote);
    const p = Bun.spawn({ cmd, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    p.stdin.write(`${script.length}\n`);
    p.stdin.write(script);
    if (opts.stdin != null) p.stdin.write(opts.stdin);
    await p.stdin.end();
    let out = "", err = "", remotePid = 0;
    const dec1 = new TextDecoder(), dec2 = new TextDecoder();
    const pump = async (s: ReadableStream<Uint8Array>, which: 1 | 2) => {
        for await (const c of s) {
            if (which === 1) { out += dec1.decode(c, { stream: true }); continue; }
            err += dec2.decode(c, { stream: true });
            if (!remotePid) {
                const m = /^__HYPER_PID=(\d+)\n/.exec(err);
                if (m) { remotePid = Number(m[1]); err = err.slice(m[0].length); }
            }
        }
    };
    const pumps = Promise.all([pump(p.stdout, 1), pump(p.stderr, 2)]);
    const timeoutMs = (opts.timeout ?? 120) * 1000;
    let timedOut = false;
    const exitCode = await Promise.race([
        p.exited,
        Bun.sleep(timeoutMs).then(() => { timedOut = true; p.kill(); return -1; }),
    ]);
    await Promise.race([pumps, Bun.sleep(200)]);
    if (timedOut && remotePid) {
        const kill = "kt(){ for c in $(pgrep -P $1); do kt $c; done; kill -TERM $1 2>/dev/null; }; kt " + remotePid;
        Bun.spawn({ cmd: ["ssh", "-T", ...(await ctx.fns.remote.sshOptions({ persist: false })).args, opts.host, kill], stdout: "ignore", stderr: "ignore" });
    }
    return { stdout: out, stderr: err, exitCode: timedOut ? null : exitCode, timedOut, ms: Date.now() - started };
}
