// Plugin manager. Keep the primary surface about things a person can turn on
// and off; framework/process internals live behind one disclosure at the end.
/**
 * Render panel for the modules subsystem.
 * @param opts.message The informational message to display.
 * @param opts.error The error to report.
 */
export default async function (ctx: Context, _session: Session | null, opts: { message?: string; error?: string }): Promise<string> {
    const esc = (s: any) => ctx.fns.w.escape({ text: s });
    const all = ctx.fns.procs.modules.list({});
    const mounted = all.filter((m: any) => m.plugin);
    const parts = all.filter((m: any) => !m.plugin);
    const declared = await ctx.fns.procs.modules.readDeclared({ workdir: ctx.fns.procs.project.workdir({}) });
    const missing = Object.entries(declared).filter(([name, config]) => config !== false && !mounted.some((m: any) => m.name === name)) as Array<[string, Record<string, any>]>;
    const catalog = await ctx.fns.procs.modules.catalog({});
    const failed = Object.entries((ctx.state.procs.lifecycle?.failed ?? {}) as Record<string, string>);
    const root = ctx.fns.procs.project.projectRoot({});

    const shortPath = (path: string) => path.startsWith(root + "/") ? "./" + path.slice(root.length + 1) : path;
    const namespaceChips = (names: string[]) => {
        const shown = names.slice(0, 5);
        return shown.map(name => `<span class="rounded-md bg-base-200 px-1.5 py-0.5 font-mono text-3xs text-subtle">${esc(name)}</span>`).join("")
            + (names.length > shown.length ? `<span class="text-3xs text-faint">+${names.length - shown.length}</span>` : "");
    };
    const skillLink = (p: any) => p.skill
        ? `<a href="/procs/modules/skill?name=${encodeURIComponent(p.name)}" hx-get="/procs/modules/skill?name=${encodeURIComponent(p.name)}" hx-target="#main" hx-swap="innerHTML" hx-push-url="true" class="text-xs text-primary hover:underline">docs</a>`
        : "";
    const reload = `<form method="POST" action="/plugins/reload" hx-post="/plugins/reload" hx-target="#main" hx-swap="innerHTML">${ctx.fns.w.button({ label: "Reload", icon: "arrow-clockwise", size: "sm", title: "Rescan configured plugin folders", marks: { action: "reload-plugins" } })}</form>`;

    const pluginCard = (p: any) => `<article ${ctx.fns.w.marks({ entity: "module", id: p.name, status: "on" })} class="rounded-xl border border-base-300 bg-base-100 p-4 shadow-xs">
  <div class="flex items-start gap-3">
    <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-base-200 text-muted"><i class="ph ${esc(p.icon)} text-lg" aria-hidden="true"></i></div>
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        ${p.tab ? `<a class="min-w-0 flex-1 truncate font-semibold text-primary hover:underline" href="/${esc(p.namespaces[0] ?? p.name)}">${esc(p.label)}</a>` : `<a class="min-w-0 flex-1 truncate font-semibold text-base-content hover:text-primary hover:underline" href="/plugins/${encodeURIComponent(p.name)}">${esc(p.label)}</a>`}
        <span class="inline-flex items-center gap-1 text-2xs text-success"><span class="size-1.5 rounded-full bg-success"></span>on</span>
      </div>
      <div class="mt-1 flex items-center gap-2"><a href="/plugins/${encodeURIComponent(p.name)}" class="text-xs text-faint hover:text-primary">Details</a><span class="ml-auto">${ctx.fns.w.button({ label: "Turn off", size: "sm", tone: "danger", action: { post: "/procs/modules/remove", target: "#main", swap: "innerHTML", vals: { name: p.name } }, marks: { action: "turn-off", entity: "module", id: p.name } })}</span></div>
      ${p.description ? `<p class="mt-1 line-clamp-2 text-sm leading-5 text-muted">${esc(p.description)}</p>` : ""}
      <div class="mt-3 flex flex-wrap items-center gap-1.5">${namespaceChips(p.namespaces)}${skillLink(p)}</div>
      <div class="mt-3 flex min-w-0 items-center gap-2 border-t border-base-200 pt-2.5 text-2xs text-faint">
        <span class="truncate font-mono" title="${esc(p.dir)}">${esc(shortPath(p.dir))}</span>
        <span class="ml-auto shrink-0">${p.fns.length} functions</span>
      </div>
    </div>
  </div>
</article>`;

    const availableCard = (p: any) => `<article ${ctx.fns.w.marks({ entity: "module", id: p.name, status: "off" })} class="rounded-xl border border-dashed border-base-300 bg-base-100/60 p-4">
  <div class="flex items-start gap-3">
    <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-base-200 text-subtle"><i class="ph ${esc(p.icon)} text-lg"></i></div>
    <div class="min-w-0 flex-1"><div class="font-semibold">${esc(p.label)}</div>${p.description ? `<p class="mt-1 text-sm leading-5 text-subtle">${esc(p.description)}</p>` : ""}<div class="mt-2 flex flex-wrap gap-1.5">${skillLink(p)}</div></div>
    ${ctx.fns.w.button({ label: "Turn on", size: "sm", tone: "primary", action: { post: "/procs/modules/add", vals: { name: p.name }, target: "#main", swap: "innerHTML" }, marks: { action: "turn-on", entity: "module", id: p.name } })}
  </div>
</article>`;

    const missingRow = ([name, config]: [string, Record<string, any>]) => `<div class="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm"><i class="ph ph-warning-circle text-warning"></i><div class="min-w-0 flex-1"><div class="font-medium">${esc(name)}</div><div class="truncate font-mono text-xs text-subtle">${esc(config.git ?? config.path ?? "source not found")}</div></div>${config.git ? ctx.fns.w.button({ label: "Fetch", size: "sm", action: { post: "/procs/modules/fetch", target: "#main", swap: "innerHTML", vals: { name } }, marks: { action: "fetch", entity: "module", id: name } }) : ""}</div>`;

    const processRow = (p: any) => `<div class="flex min-w-0 items-center gap-3 border-t border-base-200 px-3 py-2 first:border-t-0"><i class="ph ${esc(p.icon)} text-faint"></i><span class="font-medium">${esc(p.label)}</span><span class="min-w-0 truncate font-mono text-2xs text-faint">${esc(p.namespaces.slice(0, 8).join(" · "))}${p.namespaces.length > 8 ? ` · +${p.namespaces.length - 8}` : ""}</span><span class="ml-auto shrink-0 text-2xs text-faint">${p.fns.length} functions</span></div>`;

    const notices = [
        failed.length ? ctx.fns.w.toast({ level: "error", message: `did not start: ${failed.map(([name, why]) => `${name} — ${why}`).join(" · ")}` }) : "",
        opts.error ? ctx.fns.w.toast({ level: "error", message: opts.error }) : "",
        opts.message ? ctx.fns.w.toast({ level: "success", message: opts.message }) : "",
    ].filter(Boolean).map(html => `<div class="mb-4">${html}</div>`).join("");

    return ctx.fns.w.page({
        page: "modules",
        title: "Plugins",
        lead: `${mounted.length} active · project-local capabilities from <span class="wx-mono">./plugins</span>.`,
        actions: reload,
        body: `<div class="max-w-4xl pb-10">
${notices}
<section><div class="mb-3 flex items-baseline justify-between"><h2 class="text-xs font-semibold uppercase tracking-wider text-faint">Active</h2></div><div class="grid grid-cols-1 gap-3">${mounted.map(pluginCard).join("") || `<div class="rounded-xl border border-dashed border-base-300 p-6 text-center text-sm text-subtle">No active plugins</div>`}</div></section>
${missing.length ? `<section class="mt-7"><h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-faint">Needs attention</h2><div class="space-y-2">${missing.map(missingRow).join("")}</div></section>` : ""}
${catalog.length ? `<section class="mt-7"><h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-faint">Available</h2><div class="grid grid-cols-1 gap-3">${catalog.map(availableCard).join("")}</div></section>` : ""}
<details class="mt-7 rounded-xl border border-base-300 bg-base-100"><summary class="cursor-pointer select-none px-4 py-3 text-sm text-subtle"><span class="font-medium text-muted">Runtime modules</span><span class="ml-2 text-xs text-faint">${parts.length} always loaded</span></summary><div class="border-t border-base-200">${parts.map(processRow).join("")}</div></details>
<section class="mt-7 rounded-xl border border-base-300 bg-base-100 p-4"><div class="flex items-start gap-3"><div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-base-200"><i class="ph ph-folder-open text-lg text-subtle"></i></div><div class="min-w-0 flex-1"><h2 class="font-medium">Load from folder</h2><p class="mt-0.5 text-xs text-subtle">Mount a local plugin and hot-load its functions and routes.</p><form class="mt-3 flex flex-col gap-2" method="POST" action="/plugins/load" hx-post="/plugins/load" hx-target="#main" hx-swap="innerHTML"><input name="path" required placeholder="./plugins/my-plugin" class="input input-sm min-w-0 w-full font-mono"><div class="flex min-w-0 gap-2"><input name="name" placeholder="name (optional)" class="input input-sm min-w-0 flex-1">${ctx.fns.w.button({ label: "Load", icon: "lightning", size: "sm", tone: "primary", submit: true, marks: { action: "load-plugin" } })}</div></form></div></div></section>
<details class="mt-3 rounded-xl border border-base-300 bg-base-100"><summary class="cursor-pointer select-none px-4 py-3 text-xs text-subtle hover:text-muted">Load from Git instead</summary><div class="border-t border-base-200 p-4">${ctx.fns.w.form({ form: "module-add", post: "/procs/modules/add", body: ctx.fns.w.input({ name: "name", placeholder: "name", label: "Plugin name", width: "short" }) + ctx.fns.w.input({ name: "git", placeholder: "https://github.com/acme/plugin", label: "Git URL" }) + ctx.fns.w.button({ label: "Add", size: "sm", tone: "primary", marks: { action: "add" } }) })}</div></details>
</div>`,
    });
}
