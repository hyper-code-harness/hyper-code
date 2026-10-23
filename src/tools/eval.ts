// Run TypeScript inside this process with the live ctx in scope — the agent's
// own extension mechanism. Declared as a tool by $tool_eval.md; callable by
// hand as ctx.fns.tools.eval({ code }).
//
// background: the code runs as its own bun process, started like a background bash command (a job): cancel kills it,
// it survives a server restart, and a heavy loop does not slow the server. Its ctx.fns calls go over HTTP
// (POST /jobs/eval) with the agent's session; `agent` is a JSON snapshot, ctx.state is not available.
/**
 * Evaluates TypeScript in the live runtime context, or as a background job in its own bun process that reaches ctx.fns over HTTP.
 * @param opts.code TypeScript or JavaScript code to evaluate.
 * @param opts.background Run as a background job in its own process (cancel kills it) and return its id at once; the agent is messaged when it ends. An object { afterMs, wake } waits afterMs first: code done by then returns its normal result. @default false
 * @param opts.timeout With background — seconds after which a still-running eval is reported as timeout. @default 86400 @minimum 1
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** TypeScript or JavaScript code to evaluate. */
        code: string;
        /** Run as a background job in its own process (cancel kills it) and return its id at once; the agent is messaged when it ends. An object { afterMs, wake } waits afterMs first: code done by then returns its normal result. @default false */
        background?: boolean | { afterMs?: number; wake?: string };
        /** With background — seconds after which a still-running eval is reported as timeout. @default 86400 @minimum 1 */
        timeout?: number;
    },
): Promise<string | { output: string; content: types.tools.Content[] }> {
    const agent = (session as any)?.agent;
    if (!opts.background) return await ctx.fns.repl.eval({ code: opts.code, agent });

    const agentId = String(agent?.id ?? (session as any)?.agentId ?? "");
    if (!agentId) throw new Error("eval: background needs an agent to notify");
    // Same checks as a foreground eval, here and now: a type or parse error fails the call, not the job.
    const typecheck = await ctx.fns.settings.get({ module: "repl", scopeType: "global", key: "typecheckEval" });
    if (typecheck !== false) {
        const checked = await ctx.fns.procs.repl.typecheck({ code: opts.code, bindings: { agent: agent ?? {} } });
        if (!checked.ok) throw new TypeError(`eval: typecheck failed:\n${checked.errors.map((e: string) => `  ${e}`).join("\n")}`);
    }
    const js = ctx.fns.procs.repl.compile({ code: opts.code });
    const port = (ctx.state as any).procs?.http?.server?.port;
    if (!port) throw new Error("eval: background needs the HTTP server (its calls to ctx.fns go through POST /jobs/eval)");
    const timeout = Math.max(1, Math.min(2_592_000, opts.timeout ?? 86_400));
    const token = await ctx.fns.procs.auth.sign({ sub: agentId, name: "eval", kind: "eval", seconds: timeout + 600 });
    const snapshot = agent ? { id: agent.id, title: agent.title, model: agent.model, workspaceDir: agent.workspaceDir, workspaceHost: agent.workspaceHost, parentId: agent.parentId } : { id: agentId };

    // The script carries the token, so it is 0600 in a 0700 folder and deletes itself as its first act.
    const { mkdirSync, writeFileSync, chmodSync, rmSync } = await import("node:fs");
    const dir = `${ctx.fns.procs.project.runtimeDir({})}/eval-jobs`;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const file = `${dir}/${Bun.randomUUIDv7()}.mjs`;
    writeFileSync(file, script({ url: `http://127.0.0.1:${port}/jobs/eval`, token, agent: snapshot, js }), { mode: 0o600 });

    const line = (opts.code.split("\n").find((l) => l.trim()) ?? opts.code).trim();
    const at = ctx.fns.workspace.target({ host: "local" });
    try {
        const r = await ctx.fns.tools.bash({
            host: "local", cwd: at.dir, command: `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(file)}`,
            timeout, background: opts.background, title: `eval: ${line}`.slice(0, 120),
        });
        // Done within afterMs: answer like a foreground eval — the printed output, or the error it threw.
        if (r.isError) throw new Error(r.output.replace(/^\[exit 1\]\n/, ""));
        return r.output;
    } catch (error) {
        rmSync(file, { force: true });
        throw error;
    }
}

// A background eval is its own bun process: `ctx.fns.x.y(opts)` is a fetch to POST /jobs/eval with the agent's token,
// console output goes to the job log, exit 0 when the code ends, 1 (with the stack) when it throws.
function script(o: { url: string; token: string; agent: Record<string, unknown>; js: string }): string {
    return `import { unlinkSync } from "node:fs";
try { unlinkSync(import.meta.path); } catch {}
const URL_ = ${JSON.stringify(o.url)}, TOKEN = ${JSON.stringify(o.token)};
async function call(method, params) {
  const r = await fetch(URL_, { method: "POST", headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" }, body: JSON.stringify({ method, params: params ?? {} }) });
  const j = await r.json().catch(() => ({ error: "HTTP " + r.status + " from the Hyper server" }));
  if (j.error) throw new Error(method + ": " + j.error);
  return j.value;
}
const fns = (path) => new Proxy(function () {}, {
  get: (_, k) => typeof k !== "string" || k === "then" ? undefined : fns([...path, k]),
  apply: (_, __, args) => call(path.join("."), args[0]),
});
const agent = ${JSON.stringify(o.agent)};
const session = { kind: "agent", agentId: agent.id };
const ctx = { fns: fns([]), env: process.env, session };
const print = (...a) => console.log(...a);
${o.js}
__repl().then(() => process.exit(0), (e) => { console.error(e?.stack ?? String(e)); process.exit(1); });
`;
}
