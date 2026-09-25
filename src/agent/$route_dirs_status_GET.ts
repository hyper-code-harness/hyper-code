import { basename, dirname, resolve } from "node:path";
import { readdir, stat } from "node:fs/promises";

/** Handles the dirs status get HTTP route.  * @param opts.req Incoming HTTP request.
*/
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Incoming HTTP request. */
req: Request }) {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const url = new URL(opts.req.url);
    let raw = String(url.searchParams.get("q") ?? url.searchParams.get("workspaceDir") ?? "").trim();
    if (raw.startsWith("~")) raw = (ctx.env.HOME ?? "") + raw.slice(1);
    const dir = resolve(raw || process.cwd());
    const info = await stat(dir).catch(() => null);
    const listDir = raw.endsWith("/") ? raw.slice(0, -1) || "/" : dirname(raw || dir);
    const prefix = raw.endsWith("/") ? "" : basename(raw);
    const entries = await readdir(listDir, { withFileTypes: true }).catch(() => []);
    const options = entries.filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => (prefix.startsWith(".") || !name.startsWith(".")) && name.toLowerCase().startsWith(prefix.toLowerCase()))
        .sort().slice(0, 20)
        .map(name => `<option value="${esc(`${listDir === "/" ? "" : listDir}/${name}`)}"></option>`).join("");
    const html = info?.isDirectory()
        ? `<span class="inline-flex items-center gap-1 text-success"><i class="ph ph-check-circle"></i> directory exists</span>`
        : info
            ? `<span class="inline-flex items-center gap-1 text-error"><i class="ph ph-warning-circle"></i> path exists but is not a directory</span>`
            : `<label class="inline-flex cursor-pointer items-center gap-2 text-warning"><input type="checkbox" name="createWorkspaceDir" value="1" required class="rounded border-warning/30 text-warning focus:ring-warning/30"><span>Create <code class="rounded bg-warning/10 px-1">${esc(dir)}</code></span></label>`;
    return new Response(html + `<datalist id="workspace-dirs" hx-swap-oob="innerHTML">${options}</datalist>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}
