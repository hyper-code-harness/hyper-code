// Run a shell snippet. Async (Bun.spawn, not spawnSync) so a long-running
// command doesn't block the event loop and freeze every other concurrent
// agent's LLM stream for the duration of the shell command.
//
// Output shape mirrors the agent's expectations:
// - exit 0:    return stdout (or stderr if stdout empty, or "(no output)")
// - exit !=0:  return "[exit N]\n<stderr>\nstdout:\n<stdout>", isError=true
// - timeout:   "[timed out after Ns]" plus whatever the command printed before
//              it was killed — a hung command is a result, not a stuck run.
//
// Output is pumped into buffers as it arrives rather than read with
// Response.text() at the end. That is what makes the timeout real: killing the
// shell does NOT close the pipes if it spawned a child of its own (`sleep 5`
// keeps stdout open), so waiting for the streams to end would wait out the
// full command anyway. With the text already in hand we return the moment the
// deadline passes. A stray grandchild is left to the OS.
/** Execute bash for the runtime.  * @param opts.code Shell source code to execute.
 * @param opts.cwd Shell working directory.
 * @param opts.env Environment variables added to the shell.
 * @param opts.timeout Maximum execution time in milliseconds.
*/
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Code used by the operation. */
    code: string;
        /** Cwd used by the operation. */
    cwd?: string;
        /** Env used by the operation. */
    env?: Record<string, string>;
        /** Timeout used by the operation. */
    timeout?: number },
): Promise<{ output: string; isError: boolean }> {
    const { code } = opts;

    // A relative cwd is relative to the agent's workspace, not to wherever the
    // server happens to be running.
    // A remote workspace (workspaceHost set) is not a local directory.
    const base = session?.agent?.workspaceHost ? process.cwd() : (session?.agent?.workspaceDir ?? process.cwd());
    const cwd = opts.cwd
        ? (opts.cwd.startsWith("/") ? opts.cwd : `${base}/${opts.cwd}`)
        : base;

    const proc = Bun.spawn({
        cmd: ["bash", "-c", code],
        cwd,
        env: opts.env ? { ...process.env, ...opts.env } : undefined,
        stdout: "pipe",
        stderr: "pipe",
    });

    const buf = { out: "", err: "" };

    // The live tail. tools.call puts the handle on the ctx when this runs as a
    // tool; called directly (tests, other code) there is none and the streaming
    // simply does not happen. Throttled because a chatty command would
    // otherwise push an SSE refresh per chunk.
    const run: types.tools.ToolRun | undefined = (ctx as any).toolRun;
    let lastPush = 0;
    const stream = (text: string) => {
        if (!run) return;
        ctx.fns.tools.appendRunOutput({ id: run.id, chunk: text });
        const now = Date.now();
        if (now - lastPush < 1500) return;
        lastPush = now;
        if (run.agentId) ctx.fns.procs.events.refresh({ topic: `agent:${run.agentId}`, reason: "tool-run-tail" });
    };

    const pump = async (stream_: ReadableStream<Uint8Array>, key: "out" | "err") => {
        const decoder = new TextDecoder();
        for await (const chunk of stream_) {
            const text = decoder.decode(chunk, { stream: true });
            buf[key] += text;
            stream(text);
        }
    };
    const finished = Promise.all([
        pump(proc.stdout as ReadableStream<Uint8Array>, "out"),
        pump(proc.stderr as ReadableStream<Uint8Array>, "err"),
        proc.exited,
    ]);

    // A user abort must kill the process, not merely stop awaiting it. The
    // incident case was `notarytool --wait`: abandoning the promise would have
    // left Apple's poller running and the pipes open for another half hour.
    const abort = new Promise<"aborted">(resolve => {
        if (!run) return;
        if (run.controller.signal.aborted) return resolve("aborted");
        run.controller.signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });

    const seconds = Number(opts.timeout);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Number.isFinite(seconds) && seconds > 0
        ? new Promise<"timeout">(resolve => { timer = setTimeout(() => resolve("timeout"), seconds * 1000); })
        : new Promise<"timeout">(() => { /* no timeout declared: never settles */ });

    const who = await Promise.race([finished.then(() => "done" as const), deadline, abort]);
    clearTimeout(timer);

    if (who !== "done") {
        proc.kill(9);
        const reason = who === "timeout"
            ? `[timed out after ${seconds}s — the command was killed]`
            : `[stopped by the user — the command was killed]`;
        const parts = [reason];
        if (buf.out.trimEnd()) parts.push(buf.out.trimEnd());
        if (buf.err.trimEnd()) parts.push("stderr:\n" + buf.err.trimEnd());
        return { output: parts.join("\n"), isError: true };
    }

    const stdout = buf.out.trimEnd();
    const stderr = buf.err.trimEnd();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
        const parts = [`[exit ${exitCode}]`];
        if (stderr) parts.push(stderr);
        if (stdout) parts.push("stdout:\n" + stdout);
        return { output: parts.join("\n"), isError: true };
    }
    return {
        output: stdout || (stderr ? "(stderr)\n" + stderr : "(no output)"),
        isError: false,
    };
}
