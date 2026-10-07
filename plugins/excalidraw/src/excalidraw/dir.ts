import { resolve } from "node:path";
import { homedir } from "node:os";

/**
 * Returns the absolute directory that holds Excalidraw drawings.
 *
 * Resolves the `excalidraw.root` setting: relative paths against the project
 * root, `~/` against the home directory. Every drawing path is confined to it.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {} = {}): Promise<string> {
    const configured = String(await ctx.fns.settings.getString({ module: "excalidraw", scopeType: "global", key: "root", fallback: "drawings" }) ?? "").trim() || "drawings";
    if (configured.startsWith("~/")) return resolve(homedir(), configured.slice(2));
    return resolve(ctx.fns.procs.project.projectRoot({}), configured);
}
