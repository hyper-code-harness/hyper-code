import { resolve } from "node:path";

/**
 * Returns the absolute directory that chart data urls are confined to.
 *
 * Resolves the `vegalite.dataRoot` setting against the project root, so an
 * empty setting means the project itself and a relative one (`data`,
 * `../shared`) is still anchored somewhere predictable. Every path a spec or
 * the /vegalite/data route names is checked against this directory.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<string> {
    const configured = await ctx.fns.settings.getString({ module: "vegalite", scopeType: "global", key: "dataRoot", fallback: "" });
    const projectRoot = ctx.fns.procs.project.projectRoot({});
    return resolve(projectRoot, String(configured ?? "").trim() || ".");
}
