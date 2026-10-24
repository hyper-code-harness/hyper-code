/** Stream a Codex or Claude subscription request over verified SSH without importing remote credentials.
 * @param opts.host Explicitly enabled SSH config alias.
 * @param opts.provider CLI credential family on the remote host.
 * @param opts.init POST payload and cancellation signal. Authorization is injected remotely.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Enabled SSH config alias. */ host: string;
    /** Remote CLI credential family. */ provider: "codex" | "claude-code";
    /** Request payload; real authorization is added remotely. */ init: { headers?: Record<string, string>; body: string; signal?: AbortSignal };
}): Promise<Response> {
    if (!['codex', 'claude-code'].includes(opts.provider)) throw new Error('Unsupported SSH CLI provider');
    const c = await ctx.fns.sshCli.connection({ host: opts.host });
    opts.init.signal?.throwIfAborted();
    const script = ctx.fns.sshCli.inferenceScript({});
    const command = 'python3 -c ' + ctx.fns.remote.quote({ value: script });
    const proc = Bun.spawn([c.bin, ...c.args, c.host, command], { stdin: new Blob([JSON.stringify({ ssh: { provider: opts.provider, account: 'default' }, url: opts.provider === 'codex' ? 'https://chatgpt.com/backend-api/codex/responses' : 'https://api.anthropic.com/v1/messages', method: 'POST', headers: opts.init.headers, body: opts.init.body })]), stdout: 'pipe', stderr: 'ignore' });
    const reader = proc.stdout.getReader();
    const abort = () => proc.kill();
    opts.init.signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => { proc.kill(); opts.init.signal?.removeEventListener('abort', abort); };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        let buffer = new Uint8Array(0);
        const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { cleanup(); reject(new Error('SSH CLI response timed out')); }, 90000); });
        let header: { status: number; headers: Record<string, string> } | undefined;
        while (!header) {
            const item = await Promise.race([reader.read(), deadline]);
            opts.init.signal?.throwIfAborted();
            if (item.done) throw new Error('SSH CLI bridge failed; check host trust, Python 3 and isolated remote login');
            const joined = new Uint8Array(buffer.length + item.value.length); joined.set(buffer); joined.set(item.value, buffer.length); buffer = joined;
            const nl = buffer.indexOf(10);
            if (nl > 65536 || (nl < 0 && buffer.length > 65536)) throw new Error('Invalid SSH response framing');
            if (nl >= 0) { header = JSON.parse(new TextDecoder().decode(buffer.slice(0, nl))); buffer = buffer.slice(nl + 1); }
        }
        clearTimeout(timer);
        if (!Number.isInteger(header.status) || header.status < 200 || header.status > 599 || !header.headers || typeof header.headers !== 'object') throw new Error('Invalid SSH response header');
        if ([204, 205, 304].includes(header.status)) { cleanup(); await reader.cancel(); return new Response(null, header); }
        const stream = new ReadableStream<Uint8Array>({
            start(controller) { if (buffer.length) controller.enqueue(buffer); },
            async pull(controller) {
                try {
                    const item = await reader.read(); opts.init.signal?.throwIfAborted();
                    if (item.done) { if (await proc.exited !== 0) throw new Error('SSH CLI stream interrupted'); cleanup(); controller.close(); }
                    else controller.enqueue(item.value);
                } catch (e) { cleanup(); controller.error(e); }
            },
            cancel() { cleanup(); return reader.cancel(); },
        });
        return new Response(stream, header);
    } catch (e) { clearTimeout(timer); cleanup(); await reader.cancel().catch(() => undefined); throw e; }
}
