import { existsSync } from "node:fs";

/** Checks whether a named subscription account has an actual stored credential. */
/**
 * Verify that a credential slot is usable without reading or returning its secret.
 *
 * File-backed Codex/Kimi accounts require their official auth file. Claude Code
 * accounts require the corresponding macOS Keychain service. This prevents a
 * directory created for a failed login from appearing as a connected account.
 *
 * @param opts.provider Subscription provider.
 * @param opts.account Credential slot.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Subscription provider name. */ provider: "codex" | "claude-code" | "kimi-coding";
    /** Credential slot. @default "default" */ account?: string;
}): boolean {
    const location = ctx.fns.llm.accountCredentialPath({ provider: opts.provider, account: opts.account });
    if (location.file) return existsSync(location.file);
    if (!location.keychainService) return false;
    const user = ctx.env.USER ?? process.env.USER ?? "";
    if (process.platform !== "darwin") {
        const home = ctx.env.HOME ?? process.env.HOME ?? "";
        return existsSync(`${location.dir ?? `${home}/.claude`}/.credentials.json`);
    }
    if (!user) return false;
    // No -w: only ask whether the item exists, never read the token into this
    // function or its logs.
    const proc = Bun.spawnSync({
        cmd: ["security", "find-generic-password", "-s", location.keychainService, "-a", user],
        stdout: "ignore",
        stderr: "ignore",
    });
    return proc.exitCode === 0;
}
