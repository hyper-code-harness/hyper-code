/**
 * Resolve the installed Codex CLI version for subscription requests
 *
 * Returns an explicit environment override or detects the installed codex CLI version once per process. Use for Codex backend model catalogue and inference headers so version-gated models remain available.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<string> {
    const explicit = String(ctx.env.CODEX_CLI_VERSION ?? "").trim();
        if (explicit) return explicit;
        const state = ((ctx.state as any).llm ??= {});
        if (state.codexCliVersion) return state.codexCliVersion;
        try {
            const home = ctx.env.HOME ?? process.env.HOME ?? "";
            const path = [`${home}/.bun/bin`, "/opt/homebrew/bin", "/usr/local/bin", ctx.env.PATH ?? process.env.PATH ?? ""].filter(Boolean).join(":");
            const proc = Bun.spawnSync(["codex", "--version"], { stdout: "pipe", stderr: "ignore", env: { ...process.env, ...ctx.env, PATH: path } });
            const version = proc.exitCode === 0 ? proc.stdout.toString().match(/\b(\d+\.\d+\.\d+)\b/)?.[1] : undefined;
            if (version) return state.codexCliVersion = version;
        } catch {}
        return state.codexCliVersion = "0.157.1";
}
