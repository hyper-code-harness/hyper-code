/**
 * Shows the Agent Skills of this instance as a page: installed packs, skills of the shared folders, and how each is used
 *
 * Use to look at what skills exist, where each came from and who may start it — open it on the canvas with
 * `canvas.show({ args: { fn: "skills.page" } })` or at `/rpc/skills.page`. Lists the installed packs (repository,
 * release, trust, whether the model may start their skills), the shared folders that are read in place, and one row
 * per skill: who can start it, size, scripts, loads in the last 30 days and what the parser warned about. A skill
 * name opens its own page (skills.view). Reads the index and the lock only; nothing is installed or changed.
 * @view
 * @live skills
 * @param opts.pack Only skills of this pack; `local` is the shared folders.
 * @param opts.q Case-insensitive substring of the name or description.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Only skills of this pack; `local` is the shared folders. */
    pack?: string;
    /** Case-insensitive substring of the name or description. */
    q?: string;
} = {}): Promise<string> {
    const w = ctx.fns.w;
    const esc = (text: unknown) => w.escape({ text: String(text ?? "") });
    const page = (params: Record<string, unknown>) => ctx.fns.rpc.url({ fn: "skills.page", params });
    const small = (html: string) => w.box({ body: html, mix: { text: "small", ink: "faint" } });
    const home = String(ctx.env.HOME ?? "\0");
    const short = (p: string) => p.replace(home, "~");

    const { lock } = await ctx.fns.skills.lockFile({});
    const { roots } = await ctx.fns.skills.sources({});
    const all = await ctx.fns.skills.list({ limit: 2000 });
    const skills = await ctx.fns.skills.list({ limit: 2000, ...(opts.pack ? { pack: opts.pack } : {}), ...(opts.q ? { query: opts.q } : {}) });
    const since = Date.now() - 30 * 86_400_000;
    const usage = new Map((await ctx.fns.procs.db.select({
        sql: "SELECT skill_id, count(*) FILTER (WHERE via = 'model')::int AS by_model, count(*) FILTER (WHERE via = 'user')::int AS by_user, max(ts) AS last FROM skill_usage WHERE ts > ? GROUP BY skill_id",
        params: [since],
    }) as any[]).map(row => [String(row.skill_id), row]));

    const count = (pack: string) => all.filter(skill => skill.pack === pack).length;
    const filters = [`<a class="w-link" href="${esc(page({}))}">all ${all.length}</a>`, ...[...new Set(all.map(skill => skill.pack))].sort().map(pack => `<a class="w-link" href="${esc(page({ pack }))}">${esc(pack)} ${count(pack)}</a>`)].join(" · ");
    const head = w.heading({ title: opts.pack ? `Skills: ${opts.pack}` : "Agent Skills", meta: small(filters) })
        + (opts.pack && lock.packs[opts.pack] ? await ctx.fns.skills.actions({ pack: opts.pack }) : "");

    const item = ctx.fns.skills.item;
    const packs = Object.entries(lock.packs);
    const actions: Record<string, string> = {};
    for (const [name] of packs) actions[name] = await ctx.fns.skills.actions({ pack: name });
    const packList = packs.length ? packs.map(([name, e]) => item({
        title: `<a class="w-link" href="${esc(page({ pack: name }))}">${esc(name)}</a>`
            + w.badge({ text: e.trust, tone: e.trust === "community" ? "warning" : "success" })
            + (e.model ? w.badge({ text: "agents may pick it", tone: "info" }) : w.badge({ text: "/name only", tone: "neutral" })),
        meta: esc(`${e.repo} @ ${e.tag ?? e.branch ?? "commit"} (${e.commit.slice(0, 10)}) · ${Object.keys(e.skills).length} skills · installed ${new Date(Number(e.installedAt)).toISOString().slice(0, 10)}`)
            + ` · <a class="w-link" href="${esc(ctx.fns.rpc.url({ fn: "skills.previewPage", params: { repo: e.repo } }))}">what else is in the repository</a>`,
        text: actions[name],
    })).join("") : w.empty({ title: "No packs installed", hint: "Ask an agent to find a skill: it proposes, you confirm in the chat.", icon: "package" });

    const rootList = roots.map(root => item({ title: esc(short(root.dir)), meta: root.exists ? esc(`${root.skills} skills, read in place`) : "not on this machine" })).join("");

    // Per-skill buttons only on a pack's own page: on the full list they would be sixty forms nobody asked for.
    const skillActions: Record<string, string> = {};
    if (opts.pack && lock.packs[opts.pack]) for (const skill of skills) skillActions[skill.name] = await ctx.fns.skills.actions({ pack: opts.pack, skill: skill.name, installed: true });
    const skillList = skills.length ? skills.map(skill => {
        const u = usage.get(skill.id);
        const model = skill.modelInvocable && skill.modelAllowed;
        const scripts = skill.files.filter(file => /\.(sh|bash|py|js|mjs|cjs|ts|rb)$/i.test(file)).length;
        return item({
            title: `<a class="w-link" href="${esc(ctx.fns.rpc.url({ fn: "skills.view", params: { name: skill.id } }))}">${esc(skill.name)}</a>`
                + `<span style="font-weight:400;color:var(--w-ink-faint)">${esc(skill.pack)}</span>`
                + (model ? w.badge({ text: "agents may pick it", tone: "info" }) : skill.userInvocable ? w.badge({ text: "/" + skill.name + " only", tone: "neutral" }) : ""),
            text: esc(skill.description),
            meta: [
                esc(`${skill.bodyChars} chars${skill.files.length ? ` · ${skill.files.length} files` : ""}${scripts ? ` · ${scripts} scripts` : ""}`),
                u ? esc(`used in 30 days: ${u.by_model} by agents, ${u.by_user} by a person, last ${new Date(Number(u.last)).toISOString().slice(0, 10)}`) : "",
                !model && skill.modelInvocable ? "its pack is not allowed to agents" : "",
                skill.diagnostics.length ? "⚠ " + esc(skill.diagnostics.join("; ").slice(0, 300)) : "",
            ].filter(Boolean).join(" · ") + (opts.pack && skill.source === "pack" ? skillActions[skill.name] ?? "" : ""),
        });
    }).join("") : w.empty({ title: "No skills match", icon: "tray" });

    const hubs = await ctx.fns.skills.hubs({});
    const num = (n?: number) => n == null ? "" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n);
    const hubList = hubs.map(hub => item({
        title: `<a class="w-link" href="${esc(ctx.fns.rpc.url({ fn: "skills.previewPage", params: { repo: hub.repo } }))}">${esc(hub.repo.replace(/^github:/, ""))}</a>`
            + w.badge({ text: hub.trust, tone: hub.trust === "official" ? "success" : "warning" })
            + (hub.installed ? w.badge({ text: "installed", tone: "success" }) : ""),
        text: esc(hub.about),
        meta: esc([hub.publisher, hub.stars ? `${num(hub.stars)} GitHub stars` : "", hub.installs ? `${num(hub.installs)} installs on skills.sh` : ""].filter(Boolean).join(" · ")),
    })).join("");

    const section = (title: string, body: string) => w.box({ body: w.heading({ title }) + body, mix: { layout: "stack", gap: "s2" } });
    // A plain GET form: /rpc reads `?pack=…&q=…` as the view's params, and a canvas tab follows it like a link.
    const search = `<form method="GET" action="/rpc/skills.page" style="display:flex;flex-wrap:wrap;gap:var(--w-s2);max-width:32rem">`
        + (opts.pack ? `<input type="hidden" name="pack" value="${esc(opts.pack)}">` : "")
        + `<div style="flex:1 1 12rem;min-width:0">${w.input({ name: "q", type: "search", value: opts.q ?? "", placeholder: "filter by name or description", label: "Filter skills" })}</div>`
        + w.button({ label: "Filter", size: "sm", submit: true }) + `</form>`;
    const all_ = !(opts.pack || opts.q);
    const enabled = await ctx.fns.settings.get({ module: "skills", scopeType: "global", key: "enabled" }) === true;
    const status = w.box({
        body: (enabled ? w.badge({ text: "on for all agents", tone: "success" }) + " " + esc("Every agent can search for and load skills.") : w.badge({ text: "off by default", tone: "warning" }) + " " + esc("Only agents that name the skill tool in their tool list can use skills; the rest do not know they exist."))
            + await ctx.fns.skills.actions({ global: true }),
        mix: { text: "small", layout: "stack", gap: "s2" },
    });
    return w.box({
        body: head + (all_ ? status : "") + search
            + (all_ ? section("Installed packs", `<div>${packList}</div>`) + section("Shared folders", `<div>${rootList}</div>`) : "")
            + section(`Skills (${skills.length})`, `<div>${skillList}</div>`)
            + (all_ ? section("Collections to look into", small("A name opens a preview: nothing is installed until you confirm it in a chat form. Popularity is not a safety check.") + `<div>${hubList}</div>`) : ""),
        mix: { layout: "stack", gap: "s4" },
    });
}
