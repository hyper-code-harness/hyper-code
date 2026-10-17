/**
 * Returns the instance's Hyper home folder that holds all memory and memory functions.
 *
 * Use to find `~/.hyper` (or `HYPER_HOME` when set, which tests use to get a temporary home): memory files are
 * in `<home>/memory`, system/user/project/agent functions in `<home>/src`.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<string> {
    const { resolve, join } = await import("node:path");
    const { homedir } = await import("node:os");
    const explicit = String(ctx.env.HYPER_HOME ?? "").trim();
    return resolve(explicit || join(String(ctx.env.HOME || homedir()), ".hyper"));
}
