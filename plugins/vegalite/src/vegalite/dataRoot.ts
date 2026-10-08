import { resolve } from "node:path";

/**
 * Returns the absolute directory that chart data urls are confined to.
 *
 * An explicit `vegalite.dataRoot` setting always wins and is resolved against
 * the project root, so a relative one (`data`, `../shared`) stays anchored
 * somewhere predictable. With the setting empty the root follows the calling
 * agent's own workspace directory, so a chart written in chat reads the same
 * relative paths the agent's files, bash and git tools just used; without a
 * session (tests, scripts, HTTP) it falls back to the project root. Every path
 * a spec or the /vegalite/data route names is checked against this directory.
 */
export default async function (ctx: Context, session: Session | null, _opts?: {}): Promise<string> {
    const configured = String((await ctx.fns.settings.getString({ module: "vegalite", scopeType: "global", key: "dataRoot", fallback: "" })) ?? "").trim();
    const projectRoot = ctx.fns.procs.project.projectRoot({});
    if (configured) return resolve(projectRoot, configured);

    // A remote workspace is not readable as a local path, so only a local one
    // may widen the root; anything else stays on the project.
    const agent: { workspaceDir?: string; workspaceHost?: string } | undefined = session?.agent;
    const dir = String(agent?.workspaceDir ?? "").trim();
    const host = String(agent?.workspaceHost ?? "").trim();
    if (dir && !host) return resolve(dir);
    return projectRoot;
}
