/** GET /plugins/:name — plugin metadata, skill instructions, and live function docs. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: { /** Incoming HTTP request. */ req: Request; /** Route parameters. */ params: Record<string, string> },
) {
    const name = opts.params.name!;
    const module = ctx.fns.procs.modules.list({}).find((item: any) => item.name === name);
    if (!module) return new Response("Plugin not found", { status: 404 });
    const esc = (value: any) => ctx.fns.procs.ui.escape({ text: String(value ?? "") });
    const root = ctx.fns.procs.project.projectRoot({});
    const path = module.dir.startsWith(root + "/") ? "./" + module.dir.slice(root.length + 1) : module.dir;
    const chip = (value: string) => `<span class="rounded-md bg-base-200 px-2 py-1 font-mono text-xs text-muted">${esc(value)}</span>`;
    const docs = module.fns.map((fn: string) => {
        try { return ctx.fns.runtime.docs.get({ name: fn }); }
        catch { return { name: fn, doc: "", summary: "", paramsSchema: null, returnType: "" }; }
    });
    const functionCards = docs.map((meta: any, index: number) => functionCard(meta, index === 0, esc)).join("");
    const documented = docs.filter((meta: any) => meta.summary || meta.doc).length;
    const rows = [
        ["Location", `<span class="font-mono text-xs">${esc(path)}</span>`],
        ["Source", esc(module.source)],
        ["Functions", String(module.fns.length)],
        ["Documentation", `${documented}/${module.fns.length}`],
        ["Routes", String(module.routes.length)],
        ["Status", module.plugin ? `<span class="inline-flex items-center gap-1 text-success"><span class="size-1.5 rounded-full bg-success"></span>active</span>` : "always loaded"],
    ];
    let skillHtml = "";
    if (module.skill) {
        const text = await Bun.file(module.skill).text().catch(() => null);
        if (text !== null) {
            const rendered = await ctx.fns.markdown.render({ source: text });
            skillHtml = `<section class="mt-7"><div class="mb-3 flex items-center justify-between gap-3"><div><h2 class="font-medium">SKILL.md</h2><p class="mt-0.5 text-xs text-subtle">Instructions available to the agent</p></div><a href="/procs/modules/skill?name=${encodeURIComponent(module.name)}" class="text-xs text-faint hover:text-primary">Open separately <i class="ph ph-arrow-up-right"></i></a></div><article class="md-preview prose prose-sm max-w-none rounded-xl border border-base-300 bg-base-100 px-5 py-4 text-base-content">${rendered}</article></section>`;
        }
    }
    return { title: module.label, main: `<div class="p-6 sm:p-8"><section ${ctx.fns.procs.ui.attr({ page: "plugin", id: name })} class="max-w-5xl pb-10">
  <a href="/plugins" class="inline-flex items-center gap-1 text-xs text-faint hover:text-primary"><i class="ph ph-arrow-left"></i> Plugins</a>
  <div class="mt-5 flex items-start gap-4"><div class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-base-200 text-muted"><i class="ph ${esc(module.icon)} text-2xl"></i></div><div class="min-w-0 flex-1"><h1 class="text-2xl font-semibold tracking-tight">${esc(module.label)}</h1><p class="mt-1 max-w-2xl text-sm leading-6 text-subtle">${esc(module.description || "No description provided.")}</p></div>${module.plugin && module.optional ? ctx.fns.procs.ui.button({ action: "turn-off", label: "Turn off", entity: "module", id: module.name, post: "/procs/modules/remove", vals: { name: module.name }, tone: "danger" }) : ""}</div>
  <dl class="mt-7 overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-xs">${rows.map(([label, value]) => `<div class="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 border-t border-base-200 px-4 py-3 first:border-t-0"><dt class="text-xs text-faint">${label}</dt><dd class="min-w-0 break-words text-sm text-muted">${value}</dd></div>`).join("")}</dl>
  <section class="mt-7"><h2 class="text-xs font-semibold uppercase tracking-wider text-faint">Namespaces</h2><div class="mt-3 flex flex-wrap gap-2">${module.namespaces.map(chip).join("") || `<span class="text-sm text-faint">None</span>`}</div></section>
  ${skillHtml}
  <section class="mt-8"><div class="mb-3 flex items-end justify-between gap-3"><div><h2 class="font-medium">Runtime functions</h2><p class="mt-0.5 text-xs text-faint">Live JSDoc, parameter schema, and return types</p></div><span class="rounded-full bg-base-200 px-2.5 py-1 text-xs text-subtle">${documented}/${module.fns.length} documented</span></div><div class="space-y-3">${functionCards || `<div class="rounded-xl border border-base-300 p-4 text-sm text-faint">No functions</div>`}</div></section>
</section></div>` };
}

function functionCard(meta: any, open: boolean, esc: (value: any) => string): string {
    const schema = meta.paramsSchema;
    const properties = Object.entries(schema?.properties ?? {}) as Array<[string, any]>;
    const required = new Set<string>(schema?.required ?? []);
    const summary = meta.summary || String(meta.doc ?? "").split("\n")[0] || "No documentation yet.";
    const rest = String(meta.doc ?? "").split("\n").slice(1).join("\n").trim();
    const params = properties.length ? `<div class="overflow-hidden rounded-lg border border-base-200"><table class="w-full text-left"><thead class="bg-base-200/60 text-2xs uppercase tracking-wider text-faint"><tr><th class="px-3 py-2 font-medium">Parameter</th><th class="px-3 py-2 font-medium">Type</th><th class="px-3 py-2 font-medium">Description</th></tr></thead><tbody>${properties.map(([name, spec]) => `<tr class="border-t border-base-200 align-top"><td class="px-3 py-2.5"><code class="text-xs font-semibold text-primary">${esc(name)}</code>${required.has(name) ? `<span class="ml-1.5 text-3xs text-error/70">required</span>` : `<span class="ml-1.5 text-3xs text-faint">optional</span>`}</td><td class="px-3 py-2.5"><code class="text-xs text-subtle">${esc(schemaType(spec))}</code>${constraintText(spec, esc)}</td><td class="px-3 py-2.5 text-xs leading-5 text-subtle">${esc(spec.description || "—")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="text-xs text-faint">No parameter schema available.</p>`;
    return `<details ${open ? "open" : ""} class="group overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-xs"><summary class="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5 hover:bg-base-200/40"><span class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><i class="ph ph-function"></i></span><span class="min-w-0 flex-1"><code class="text-sm font-semibold text-base-content">${esc(meta.name)}</code><span class="mt-1 block text-xs leading-5 text-subtle">${esc(summary)}</span></span><i class="ph ph-caret-down mt-1 text-faint transition-transform group-open:rotate-180"></i></summary><div class="border-t border-base-200 px-4 py-4"><div class="space-y-4">${rest ? `<p class="whitespace-pre-line text-sm leading-6 text-subtle">${esc(rest)}</p>` : ""}${params}<div class="grid gap-3 sm:grid-cols-2"><div><div class="text-3xs font-semibold uppercase tracking-wider text-faint">Returns</div><code class="mt-1 block break-words rounded-md bg-base-200 px-2.5 py-2 text-xs text-muted">${esc(meta.returnType || "unknown")}</code></div><div><div class="text-3xs font-semibold uppercase tracking-wider text-faint">Source</div><code class="mt-1 block break-words rounded-md bg-base-200 px-2.5 py-2 text-xs text-muted">${esc(meta.rel || "unknown")}${meta.line ? `:${esc(meta.line)}` : ""}</code></div></div></div></div></details>`;
}

function schemaType(spec: any): string {
    if (spec?.["x-typescript-type"]) return spec["x-typescript-type"];
    if (Array.isArray(spec?.enum)) return spec.enum.map((x: any) => JSON.stringify(x)).join(" | ");
    if (spec?.const !== undefined) return JSON.stringify(spec.const);
    if (spec?.type === "array") return `${schemaType(spec.items)}[]`;
    if (spec?.anyOf) return spec.anyOf.map(schemaType).join(" | ");
    return spec?.type || "unknown";
}

function constraintText(spec: any, esc: (value: any) => string): string {
    const values = [spec.default !== undefined ? `default ${spec.default}` : "", spec.minimum !== undefined ? `min ${spec.minimum}` : "", spec.maximum !== undefined ? `max ${spec.maximum}` : ""].filter(Boolean);
    return values.length ? `<span class="mt-1 block text-3xs text-faint">${esc(values.join(" · "))}</span>` : "";
}
