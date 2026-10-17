/**
 * Shows one memory entry as a page: a note rendered from markdown, a saved html page (pages/*.html) with its own
 * styles,
 * a record's data, or a function's source.
 *
 * Use to open a note on the canvas or by link: `canvas.show({ kind: "view", args: { fn: "memory.view", params:
 * { key: "notes/canvas-model.md" } } })`, or `/rpc/memory.view?{"key":"notes/canvas-model.md"}`. Works for an agent
 * (its four levels, nearest first) and for a signed-in person in the browser (memory.visible). `[[name]]` links
 * and relative `.md` links in a note open the other note in the same tab.
 * @view
 * @live memory
 * @param opts.key Memory key, e.g. notes/canvas-model.md or todo/x; nearest level first.
 * @param opts.id Index row id instead of a key.
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Memory key, e.g. notes/canvas-model.md or todo/x; nearest level first. */
    key?: string;
    /** Index row id instead of a key. */
    id?: number;
}): Promise<string> {
    const v = await ctx.fns.memory.visible({});
    const where = opts.id != null ? "id = ?" : "key = ?";
    const arg = opts.id != null ? Number(opts.id) : String(opts.key ?? "");
    if (opts.id == null && !arg) throw new Error("memory.view: key or id is required");
    const rows: any[] = await ctx.fns.procs.db.select({ sql: `select * from memory where ${where} and ${v.sql} order by ${v.order} limit 1`, params: [arg, ...v.params] });
    const r = rows[0];
    if (!r) throw new Error(`memory.view: no memory entry ${opts.key ?? opts.id} visible to you`);
    const esc = (text: string) => ctx.fns.procs.ui.escape({ text });
    const link = (key: string) => ctx.fns.rpc.url({ fn: "memory.view", params: { key } });
    const top = String(r.key).split("/")[0] ?? "";
    const listLink = ctx.fns.rpc.url({ fn: "memory.table", params: { prefix: top + "/" } });
    const head = `<p class="rpc-muted"><a href="${esc(listLink)}">${esc(top)}/</a> · ${esc(r.visibility)} · ${esc(r.type)}${r.kind ? " · " + esc(r.kind) : ""} · v${Number(r.version)} · ${new Date(Number(r.updated_at)).toISOString().slice(0, 16).replace("T", " ")}</p>`;

    if (r.type === "jsonb") {
        return `${head}<h1>${esc(r.title ?? r.key)}</h1>${r.description ? `<p>${esc(r.description)}</p>` : ""}<pre>${esc(JSON.stringify(r.data, null, 2))}</pre>`;
    }
    const path = String(r.url ?? "").startsWith("file://") ? String(r.url).slice(7) : "";
    const f = path ? Bun.file(path) : null;
    if (!f || !(await f.exists())) return `${head}<h1>${esc(r.title ?? r.key)}</h1><p class="rpc-error">the file is missing: ${esc(path)}</p>`;
    const text = await f.text();
    // A saved page (pages/*.html, e.g. a former canvas html tab) keeps its own look: its <style> is scoped to
    // this block, scripts and handlers are removed. A page that needs its scripts is an html canvas tab.
    if (r.type === "file" && /\.html?$/i.test(path)) {
        const scope = `[data-memory-page="${Number(r.id)}"]`;
        return `<div data-memory-page="${Number(r.id)}">${ctx.fns.rpc.cleanHtml({ html: text, scope })}</div>`;
    }
    if (r.type === "code" || !/\.(md|markdown)$/i.test(path)) return `${head}<h1>${esc(r.title ?? r.key)}</h1><pre>${esc(text)}</pre>`;

    // Markdown: drop front matter, turn [[name]] and relative .md links into links to the other note.
    const dir = String(r.key).includes("/") ? String(r.key).slice(0, String(r.key).lastIndexOf("/") + 1) : "";
    let md = text.replace(/^---\n[\s\S]*?\n---\n/, "");
    md = md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, name: string, label?: string) => `[${label ?? name}](${link(dir + name.trim().replace(/\.md$/, "") + ".md")})`);
    md = md.replace(/\]\((?!https?:|\/|#|mailto:)([^)\s]+\.md)\)/g, (_m, rel: string) => `](${link((dir + rel).replace(/(^|\/)\.\//g, "$1"))})`);
    // Notes are written by agents: raw html inside the markdown is cleaned before it joins the app page.
    const html = ctx.fns.rpc.cleanHtml({ html: await ctx.fns.markdown.render({ source: md }) });
    return `${head}${html}`;
}
