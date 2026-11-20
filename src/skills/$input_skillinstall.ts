// The chat form skills.propose opens: what would be installed, links to read it, and the person's Install / Decline.
// No `hint` export on purpose: agents reach it through skills.propose, so it stays out of the system prompt.
// The install runs in the person's request (the form POST), which is what lets it pass skills.personOnly.

export default {
    icon: "book-open-text",
    cancel: false,
    async prepare(ctx: Context, opts: { spec: Record<string, any> }) {
        const { join } = await import("node:path");
        const id = String(opts.spec.preview ?? "");
        if (!/^[0-9a-f]{20}$/.test(id)) throw new Error("skillinstall: spec.preview must be an id from skills.preview");
        const p = await Bun.file(join((await ctx.fns.skills.paths({})).staging, "preview", id, "preview.json")).json().catch(() => null) as types.skills.PackPreview | null;
        if (!p) throw new Error("skillinstall: that preview is gone — call skills.preview again");
        // Everything the form and the install need is copied into the row: the preview folder is removed after a day.
        return {
            preview: p.id, repo: p.repo, ref: p.tag ?? p.commit, label: p.tag ?? p.branch ?? p.commit.slice(0, 10), commit: p.commit, pack: p.pack, installedAs: p.installedAs ?? null,
            trust: p.trust, select: p.select ?? null, content: p.content,
            skills: p.skills.map(s => ({ name: s.name, description: s.description.slice(0, 200), byModel: s.byModel, executables: s.executables, change: s.change, chars: s.bodyChars, files: s.files })),
        };
    },
    open(ctx: Context, opts: { input: types.input.Row }) {
        const s = opts.input.spec;
        const w = ctx.fns.w;
        const esc = (v: unknown) => w.escape({ text: String(v ?? "") });
        const view = (name: string, file?: string) => esc(ctx.fns.rpc.url({ fn: "skills.view", params: { name, preview: s.preview, ...(file ? { file } : {}) } }));
        const scripts = (s.skills as any[]).reduce((n, k) => n + k.executables.length, 0);
        const rows = (s.skills as any[]).map(k => `<li class="py-1"><a class="link" href="${view(k.name)}" target="_blank" rel="noopener">${esc(k.name)}</a>`
            + `${k.byModel ? "" : ' <span class="text-2xs text-muted">(/name only)</span>'}${s.installedAs && k.change !== "same" ? ` <span class="text-2xs text-muted">${esc(k.change)}</span>` : ""}`
            + ` <span class="text-2xs text-muted">— ${esc(k.description)}</span>`
            + (k.executables.length ? `<div class="text-2xs">scripts: ${(k.executables as string[]).map(f => `<a class="link" href="${view(k.name, f)}" target="_blank" rel="noopener">${esc(f)}</a>`).join(", ")}</div>` : "")
            + "</li>").join("");
        const all = esc(ctx.fns.rpc.url({ fn: "skills.previewPage", params: { repo: s.repo, ...(s.select ? { select: s.select } : {}) } }));
        return `<div class="text-sm">`
            + `<p><b>${esc(String(s.repo).replace(/^github:/, ""))}</b> @ ${esc(s.label)} · pack <b>${esc(s.pack)}</b> · trust: <b>${esc(s.trust)}</b> · ${scripts} script${scripts === 1 ? "" : "s"}</p>`
            + `<ul class="my-2 max-h-72 overflow-auto rounded-md border border-ui-border bg-base-200/40 px-3 py-1">${rows}</ul>`
            + `<p class="text-2xs text-muted">A skill is instructions an agent follows, and its scripts are run by the agent when the instructions say so. Read before installing: <a class="link" href="${all}" target="_blank" rel="noopener">open the whole pack</a>.</p>`
            + `<label class="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" name="allowModel" value="1" class="checkbox checkbox-xs"${s.trust === "official" ? " checked" : ""}> let agents pick these skills by themselves (otherwise they start only with /name)</label>`
            + `</div>`;
    },
    buttons(ctx: Context, _opts: { input: types.input.Row }) {
        return ctx.fns.w.button({ label: "Decline", size: "sm", tone: "ghost", submit: { name: "decision", value: "no" }, marks: { action: "input-decline" } })
            + ctx.fns.w.button({ label: "Install", size: "sm", tone: "primary", submit: { name: "decision", value: "yes" }, marks: { action: "input-confirm" } });
    },
    async submit(ctx: Context, opts: { input: types.input.Row; values: types.input.FormValues }) {
        const s = opts.input.spec;
        const decision = String(opts.values.decision ?? "");
        if (decision !== "yes" && decision !== "no") throw new Error("Click one of the buttons");
        if (decision === "no") return { result: { installed: false }, summary: `declined: skills from ${s.repo} were not installed` };
        const allowModel = String(opts.values.allowModel ?? "") === "1";
        const applied = await ctx.fns.skills.install({
            repo: s.repo, ref: s.ref, ...(s.select ? { select: s.select } : {}), as: s.pack, allowModel, confirmed: true, expectedContent: s.content,
        });
        const names = applied.skills.map(k => k.name);
        return {
            result: { installed: true, pack: applied.pack, commit: applied.commit, skills: names, model: applied.model },
            summary: `installed pack ${applied.pack} (${names.length} skills: ${names.slice(0, 8).join(", ")}${names.length > 8 ? ", …" : ""}); ${applied.model ? "agents may pick them themselves" : "they start with /name only"}`,
        };
    },
    done(ctx: Context, opts: { input: types.input.Row }) {
        const r = opts.input.result ?? {};
        const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
        if (!r.installed) return `<p class="text-sm"><i class="ph ph-x-circle text-error" aria-hidden="true"></i> Not installed</p>`;
        const page = esc(ctx.fns.rpc.url({ fn: "skills.page", params: { pack: r.pack } }));
        return `<p class="text-sm"><i class="ph ph-check-circle text-success" aria-hidden="true"></i> Installed <a class="link" href="${page}" target="_blank" rel="noopener">${esc(r.pack)}</a>: ${esc((r.skills ?? []).length)} skills${r.model ? "" : " (/name only)"}</p>`;
    },
} satisfies types.input.Kind;
