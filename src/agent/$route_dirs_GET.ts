// GET /agent/dirs?workspaceDir=proj — HTMX fuzzy directory suggestions.
// Relative queries search only direct children of the user's home; absolute
// queries search only direct children of their resolved root. With no query, the five most recently used workspaces
// are returned instead.
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { readdir, stat } from "node:fs/promises";

/** Return clickable workspace-directory suggestions for the new-agent form.
 * @param opts.req Incoming request containing `workspaceDir` (or `q`).
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Incoming HTTP request. */
    req: Request;
}) {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: String(s ?? "") });
    const url = new URL(opts.req.url);
    const raw = String(url.searchParams.get("workspaceDir") ?? url.searchParams.get("q") ?? "").trim();

    let paths: string[];
    if (!raw) {
        const rows = await ctx.fns.procs.db.select({
            sql: `SELECT workspace_dir AS path, MAX(updated_at) AS last_used
                  FROM agents
                  WHERE workspace_dir IS NOT NULL AND workspace_dir <> ''
                  GROUP BY workspace_dir
                  ORDER BY last_used DESC
                  LIMIT 5`,
        }).catch(() => [] as any[]);
        paths = (rows as any[]).map(row => String(row.path));
    } else {
        const home = ctx.env.HOME || homedir();
        const expanded = raw.startsWith("~") ? home + raw.slice(1) : raw;
        let root = isAbsolute(expanded) ? expanded : home;
        if (isAbsolute(expanded)) {
            while (root !== dirname(root) && !(await stat(root).catch(() => null))?.isDirectory()) root = dirname(root);
        }

        const needle = (isAbsolute(expanded) ? expanded.slice(root.length) : expanded)
            .split(sep).filter(Boolean).join("");
        const output = await shallowDirectories(root);

        const normalizedNeedle = expanded.toLowerCase().replaceAll(sep, "");
        const score = (path: string) => {
            const candidate = path.toLowerCase().replaceAll(sep, "");
            let at = 0, gaps = 0, first = -1;
            for (const ch of normalizedNeedle) {
                const found = candidate.indexOf(ch, at);
                if (found < 0) return Number.MAX_SAFE_INTEGER;
                if (first < 0) first = found;
                gaps += found - at;
                at = found + 1;
            }
            return gaps * 10 + first + path.length / 1000;
        };
        paths = [...new Set(output)]
            .sort((a, b) => score(a) - score(b) || a.localeCompare(b))
            .slice(0, 10);
    }

    if (!paths.length) return new Response(`<div class="px-3 py-2 text-xs text-base-content/60">no folders found</div>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    const html = paths.map(path => {
        const encoded = encodeURIComponent(path);
        return `<button type="button" role="option" class="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs hover:bg-base-200" hx-get="/agent/dirs/status?q=${encoded}" hx-target="#workspace-dir-status" hx-swap="innerHTML" onclick="document.getElementById('workspace-dir-input').value=this.dataset.path;this.parentElement.replaceChildren()" data-path="${esc(path)}"><i class="ph ph-folder shrink-0 text-base-content/50"></i><span class="truncate">${esc(path)}</span></button>`;
    }).join("");
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}


async function shallowDirectories(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    return entries.filter(entry => entry.isDirectory()).slice(0, 250).map(entry => resolve(root, entry.name));
}
