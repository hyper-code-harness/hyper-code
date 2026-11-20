const LANG: Record<string, string> = { sh: "bash", bash: "bash", zsh: "bash", py: "python", js: "js", mjs: "js", cjs: "js", ts: "ts", tsx: "tsx", json: "json", yaml: "yaml", yml: "yaml", toml: "toml", md: "md", html: "html", css: "css", xml: "xml", rb: "ruby", sql: "sql" };

/**
 * Shows one Agent Skill as a page with all of its files: instructions, references and scripts — installed or only previewed
 *
 * Use to read a skill before allowing, starting or installing it. Open with `canvas.show({ args: { fn: "skills.view",
 * params: { name: "tdd" } } })`, from the list (skills.page), or — for a skill that is not installed yet — with the
 * `preview` id skills.preview returned. The left column lists every file of the skill's folder with scripts marked;
 * a file name opens that file: Markdown is rendered, code is shown with highlighting and line numbers, binary and
 * very large files are named but not shown. Without `file` the page shows the rendered instructions, the frontmatter
 * fields, parser warnings, where the skill came from and how often it was loaded. Reads only: nothing is installed,
 * loaded into a conversation or executed, and symbolic links are never followed.
 * @view
 * @live skills
 * @param opts.name Skill name: short (`tdd`) when unique, or full (`pack:tdd`); in a preview, the short name.
 * @param opts.preview Preview id from skills.preview, to look at a skill that is not installed.
 * @param opts.file Relative path of a file in the skill's folder to show instead of the overview.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Skill name: short (`tdd`) when unique, or full (`pack:tdd`); in a preview, the short name. */
    name: string;
    /** Preview id from skills.preview, to look at a skill that is not installed. */
    preview?: string;
    /** Relative path of a file in the skill's folder to show instead of the overview. */
    file?: string;
}): Promise<string> {
    const w = ctx.fns.w;
    const esc = (text: unknown) => w.escape({ text: String(text ?? "") });
    const small = (html: string) => w.box({ body: html, mix: { text: "small", ink: "faint" } });
    const url = (fn: string, params: Record<string, unknown>) => esc(ctx.fns.rpc.url({ fn, params }));
    const at = await ctx.fns.skills.locate({ name: String(opts.name ?? ""), ...(opts.preview ? { preview: opts.preview } : {}) });
    if (!at.found) {
        const links = at.candidates.map(id => `<a class="w-link" href="${url("skills.view", { name: id, ...(opts.preview ? { preview: opts.preview } : {}) })}">${esc(id)}</a>`).join(" · ");
        return w.empty({ title: at.candidates.length ? `Several skills match ${opts.name}` : opts.preview ? "This preview is gone or has no such skill" : `No skill is called ${opts.name}`, icon: "tray" })
            + small(links || `<a class="w-link" href="${url("skills.page", {})}">all skills</a>`);
    }
    const { join, extname } = await import("node:path");
    const self = (file?: string) => url("skills.view", { name: at.installed ? at.id : at.name, ...(opts.preview ? { preview: opts.preview } : {}), ...(file ? { file } : {}) });
    const parsed = await ctx.fns.skills.parse({ path: join(at.dir, "SKILL.md"), dirName: at.name });
    const scripts = new Set(at.executables);

    // ── file list ────────────────────────────────────────────────────────────
    const current = opts.file ? String(opts.file) : "";
    const row = (label: string, href: string, active: boolean, mark = "") =>
        `<div style="padding:2px 0;${active ? "font-weight:600" : ""}"><a class="w-link" href="${href}">${esc(label)}</a>${mark}</div>`;
    const listing = [
        row("Overview", self(), !current),
        ...at.files.map(file => row(file, self(file), file === current, scripts.has(file) ? " " + w.badge({ text: "script", tone: "warning" }) : "")),
    ].join("");
    const nav = `<nav style="flex:1 1 220px;max-width:300px;min-width:0;overflow-wrap:anywhere">${w.heading({ title: `Files (${at.files.length})` })}${w.box({ body: listing, mix: { text: "small" } })}</nav>`;

    // ── header ───────────────────────────────────────────────────────────────
    const where = at.repo ? `${esc(at.repo)} @ ${esc(at.ref ?? "commit")} (${esc(String(at.commit).slice(0, 10))})` : "read in place from a shared folder";
    const facts: string[] = [`<a class="w-link" href="${url("skills.page", {})}">skills</a>`];
    if (at.preview) facts.push(`<a class="w-link" href="${url("skills.previewPage", { repo: at.preview.repo, ...(at.preview.ref ? { ref: at.preview.ref } : {}), ...(at.preview.select ? { select: at.preview.select } : {}) })}">${esc(at.pack)} (preview)</a>`);
    else facts.push(`<a class="w-link" href="${url("skills.page", { pack: at.pack })}">${esc(at.pack)}</a>`);
    facts.push(where, `trust: ${esc(at.trust)}`);
    if (at.skill) {
        const model = at.skill.modelInvocable && at.skill.modelAllowed;
        facts.push(model ? "the model may start it" : at.skill.modelInvocable ? "the model may not start it: the pack is not allowed to the model" : "only a person starts it");
        if (at.skill.userInvocable) facts.push(`/${esc(at.name)}${at.skill.argumentHint ? " " + esc(at.skill.argumentHint) : ""}`);
        const usage = await ctx.fns.procs.db.select({ sql: "SELECT via, count(*)::int AS n FROM skill_usage WHERE skill_id = ? GROUP BY via ORDER BY via", params: [at.id] }) as any[];
        facts.push(usage.length ? "loaded: " + usage.map(u => `${u.n} by ${u.via === "user" ? "a person" : "the model"}`).join(", ") : "never loaded");
    } else if (parsed.ok) {
        facts.push(parsed.modelInvocable ? "the model may start it once installed and allowed" : "only a person starts it");
    }
    const banner = at.preview
        ? w.box({ body: w.badge({ text: at.preview.installedAs && at.preview.skills.find(s => s.name === at.name)?.change !== "added" ? "installed — this is the repository copy" : "not installed", tone: "warning" }) + " " + esc(`Fetched ${new Date(at.preview.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC for reading. No agent can load this copy.`), mix: { text: "small" } })
        : "";
    const buttons = at.preview
        ? await ctx.fns.skills.actions({ repo: at.preview.repo, skill: at.name, installed: Boolean(at.preview.installedAs) && at.preview.skills.find(s => s.name === at.name)?.change !== "added", ...(at.preview.ref ? { ref: at.preview.ref } : {}) })
        : at.skill?.source === "pack" ? await ctx.fns.skills.actions({ pack: at.pack, skill: at.name, installed: true }) : "";
    const head = w.heading({ title: at.name, meta: small(facts.join(" · ")) }) + banner + buttons;

    // ── main column ──────────────────────────────────────────────────────────
    let main: string;
    if (current) {
        if (!at.files.includes(current)) main = w.empty({ title: `"${current}" is not a file of this skill`, icon: "warning-circle", tone: "danger" });
        else {
            const fs = await import("node:fs/promises");
            const stat = await fs.lstat(join(at.dir, current));
            const kb = `${(stat.size / 1024).toFixed(1)} KB`;
            if (!stat.isFile()) main = w.empty({ title: "Not a regular file", icon: "warning-circle" });
            else if (stat.size > 400_000) main = w.empty({ title: `${current} is ${kb} — too large to show here`, icon: "file" });
            else {
                const bytes = await fs.readFile(join(at.dir, current));
                if (bytes.includes(0)) main = w.empty({ title: `${current} is a binary file (${kb})`, icon: "file" });
                else {
                    const text = bytes.toString("utf8");
                    const ext = extname(current).slice(1).toLowerCase();
                    const note = small(esc(`${current} · ${kb} · ${text.split("\n").length} lines`) + (scripts.has(current) ? " " + w.badge({ text: "script — an agent may run it when the skill says so", tone: "warning" }) : ""));
                    const source = await w.code({ code: text, lang: LANG[ext] ?? "text", title: current, lineNumbers: true });
                    const rendered = ext === "md" && current !== "SKILL.md"
                        ? `<div class="w-markdown">${ctx.fns.rpc.cleanHtml({ html: await ctx.fns.markdown.render({ source: text }) })}</div>` + w.heading({ title: "Source" })
                        : "";
                    main = note + rendered + source;
                }
            }
        }
    } else {
        const warnings = parsed.diagnostics.length ? w.box({ body: parsed.diagnostics.map(d => "⚠ " + esc(d)).join("<br>"), mix: { text: "small" } }) : "";
        const fields = Object.entries(parsed.frontmatter).filter(([key]) => key !== "description");
        const meta = fields.length ? `<div>${fields.map(([field, value]) => ctx.fns.skills.item({ title: esc(field), meta: esc(typeof value === "string" ? value : JSON.stringify(value)) })).join("")}</div>` : "";
        const body = parsed.ok
            ? `<div class="w-markdown">${ctx.fns.rpc.cleanHtml({ html: await ctx.fns.markdown.render({ source: parsed.body }) })}</div>`
            : w.empty({ title: "SKILL.md cannot be read", hint: parsed.diagnostics.at(-1), icon: "warning-circle", tone: "danger" });
        main = w.box({ body: esc(parsed.description), mix: { weight: "strong" } }) + warnings + small(esc(at.dir.replace(String(ctx.env.HOME ?? "\0"), "~")))
            + (scripts.size ? small(`${scripts.size} script${scripts.size > 1 ? "s" : ""}: ` + [...scripts].map(file => `<a class="w-link" href="${self(file)}">${esc(file)}</a>`).join(", ")) : "")
            + w.heading({ title: "Instructions", meta: small(`${parsed.body.length} characters · <a class="w-link" href="${self("SKILL.md")}">source</a>`) }) + body
            + (meta ? w.heading({ title: "Frontmatter" }) + meta : "");
    }
    return w.box({
        body: head + `<div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;min-width:0">${nav}<div style="flex:999 1 420px;min-width:0;overflow-wrap:anywhere">${w.box({ body: main, mix: { layout: "stack", gap: "s3" } })}</div></div>`,
        mix: { layout: "stack", gap: "s3" },
    });
}
