import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const URL_RE = /(https?:\/\/[^\s\u001b]+)/;
// Do not use \b around the code: Codex prints an ANSI colour sequence ending
// in the letter "m" immediately before it (`\x1b[94mVO1P-0E4AQ`), so there is
// no regex word-boundary between `m` and `V` even though the terminal shows one.
const CODE_RE = /([A-Z0-9]{4,5}-[A-Z0-9]{4,5})/;

/** Starts a real CLI login flow in an isolated credential directory. */
/**
 * Start adding a named subscription account through the provider's official CLI.
 *
 * Codex uses `CODEX_HOME=<isolated dir> codex login --device-auth` and returns
 * the device code + URL. Claude Code uses `CLAUDE_CONFIG_DIR=<isolated dir>
 * claude auth login`; the CLI opens its browser and stores credentials under a
 * keychain service derived from the config directory. Completion is detected by
 * the child process exit and becomes visible via llm.accountLoginStatus.
 *
 * @param opts.provider Subscription provider to log into.
 * @param opts.account Name of the credential slot being added.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Provider whose official login flow to launch. */ provider: "codex" | "claude-code";
    /** New account name, e.g. "work" or "personal". */ account: string;
}): Promise<{ provider: string; account: string; status: "pending"; verificationUri: string | null; userCode: string | null }> {
    const provider = opts.provider;
    const account = String(opts.account ?? "").trim();
    if (!/^[\w.-]{1,40}$/.test(account) || account === "default") throw new Error("account must be a short name other than default");
    const path = ctx.fns.llm.accountCredentialPath({ provider, account });
    if (!path.dir) throw new Error("named account requires an isolated credential directory");
    mkdirSync(path.dir, { recursive: true, mode: 0o700 });

    const root: any = ((ctx.state as any).llm ??= {});
    const flows: Map<string, any> = (root.accountLogins ??= new Map());
    const key = `${provider}:${account}`;
    const previous = flows.get(key);
    flows.delete(key);
    if (previous?.proc && previous.status === "pending") try { previous.proc.kill(); } catch {}
    invalidateCredentials(root);

    const env = { ...process.env, ...ctx.env } as Record<string, string>;
    if (provider === "codex") env.CODEX_HOME = path.dir;
    else env.CLAUDE_CONFIG_DIR = path.dir;
    const cmd = provider === "codex" ? "codex" : "claude";
    const args = provider === "codex" ? ["login", "--device-auth"] : ["auth", "login", "--claudeai"];
    // Claude's browser callback may end on a page that displays a one-time code
    // and asks the CLI to paste it. stdin MUST remain writable; using "ignore"
    // here made the second auth step hang forever.
    const proc = spawn(cmd, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    const flow: any = { provider, account, dir: path.dir, proc, status: "pending", verificationUri: null, userCode: null, error: null, startedAt: Date.now() };
    flows.set(key, flow);
    await ctx.fns.llm.accountRegistry({ action: "begin", provider, account, dir: path.dir });

    const onData = (chunk: Buffer) => {
        const text = String(chunk);
        flow.output = String(flow.output ?? "") + text;
        // Claude wraps its fallback URL in OSC-8 terminal hyperlink escapes.
        // Extract the actual https URL, not the escape sequence around it.
        const clean = flow.output.replace(/\x1b\[[0-9;]*m/g, "");
        flow.verificationUri ??= /https:\/\/[^\s\u0007\u001b]+/.exec(clean)?.[0] ?? URL_RE.exec(clean)?.[1] ?? null;
        flow.userCode ??= CODE_RE.exec(clean)?.[1] ?? null;
        if (/Paste code here if prompted/i.test(flow.output)) flow.needsCode = true;
        ctx.fns.procs.events.refresh({ topic: "llm-accounts", reason: "login progress" });
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", async (code) => {
        if (flows.get(key) !== flow) return;
        invalidateCredentials(root);
        const exists = await ctx.fns.llm.accountCredentialExists({ provider, account, force: true });
        if (flows.get(key) !== flow) return;
        flow.status = code === 0 && exists ? "connected" : "failed";
        if (flow.status === "failed") flow.error = code === 0 ? "login finished without storing a credential" : `login exited with code ${code}`;
        await ctx.fns.llm.accountRegistry({ action: flow.status === "connected" ? "connect" : "fail", provider, account, dir: path.dir, error: flow.error }).catch(() => undefined);
        if (flow.status === "connected") await ctx.fns.llm.accountAuthHealth({ action: "clear", provider, account }).catch(() => undefined);
        // A successful login is now represented by the durable account row.
        // Keeping the progress row produced a stale "connected + device code"
        // banner that looked like login had done nothing.
        if (flow.status === "connected") setTimeout(() => { if (flows.get(key) === flow) flows.delete(key); }, 1_000);
        ctx.fns.procs.events.refresh({ topic: "llm-accounts", reason: "login finished" });
    });
    proc.on("error", async (error) => {
        if (flows.get(key) !== flow) return;
        invalidateCredentials(root);
        flow.status = "failed";
        flow.error = error.message;
        await ctx.fns.llm.accountRegistry({ action: "fail", provider, account, dir: path.dir, error: flow.error }).catch(() => undefined);
        ctx.fns.procs.events.refresh({ topic: "llm-accounts", reason: "login failed" });
    });

    // Both CLIs print safe authorization metadata quickly. Wait briefly so the
    // popup can render the URL immediately; the process continues afterwards.
    const until = Date.now() + (provider === "codex" ? 8_000 : 3_000);
    while (!flow.verificationUri && !flow.error && Date.now() < until) await Bun.sleep(100);
    return { provider, account, status: "pending", verificationUri: flow.verificationUri, userCode: flow.userCode };
}

function invalidateCredentials(root: { accountCredentialRevision?: number; accountCredentialCache?: object; accountInventoryCache?: object; claudeCodeTokens?: object }): void {
    root.accountCredentialRevision = (root.accountCredentialRevision ?? 0) + 1;
    delete root.accountCredentialCache;
    delete root.accountInventoryCache;
    delete root.claudeCodeTokens;
}
