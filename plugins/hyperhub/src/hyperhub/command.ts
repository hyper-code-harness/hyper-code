/**
 * Runs a bounded noninteractive local Git command for plugin registry operations
 *
 * Runs a bounded noninteractive local Git command for plugin registry operations.

Internal registry helper: caps stdout at 8 MB and stderr at 1 MB, force-kills the process group after sixty seconds, and omits remote diagnostics from errors to protect credentials.
 * @param opts.args Trusted Git argv, with untrusted paths separated using --.
 * @param opts.dir Absolute local working directory.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Trusted Git argv, with untrusted paths separated using --. */
        args: string[];
        /** Absolute local working directory. */
        dir: string;
    },
): Promise<string> {
    const proc = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=never", ...opts.args], {
        cwd: opts.dir, detached: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_LFS_SKIP_SMUDGE: "1" },
        stdout: "pipe", stderr: "pipe",
    });
    const outReader = proc.stdout.getReader();
    const errReader = proc.stderr.getReader();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const kill = () => {
        if (proc.exitCode !== null) return;
        try { process.kill(-proc.pid, "SIGKILL"); }
        catch (cause) {
            if ((cause as NodeJS.ErrnoException).code === 'ESRCH') return;
            try { if (proc.exitCode === null) proc.kill("SIGKILL"); }
            catch (fallbackError) { /* Cleanup must not replace the command error. */ void fallbackError; }
        }
    };
    const read = async (reader: typeof outReader, limit: number, retain: boolean) => {
        let size = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) throw new Error("Git output exceeds registry limit");
            if (retain) chunks.push(value);
        }
        if (!retain) return "";
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return new TextDecoder().decode(bytes);
    };
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { kill(); reject(new Error("Git command timed out")); }, 60_000);
    });
    try {
        const [out, , code] = await Promise.race([
            Promise.all([read(outReader, 8_000_000, true), read(errReader, 1_000_000, false), proc.exited]), deadline,
        ]);
        if (code !== 0) throw new Error(`Git failed (${code}); remote diagnostics withheld to protect credentials`);
        return out.trimEnd();
    } finally {
        clearTimeout(timer);
        kill();
        void outReader.cancel().catch(() => { /* Process teardown may close the stream first. */ });
        void errReader.cancel().catch(() => { /* Process teardown may close the stream first. */ });
    }
}
