/**
 * Shows the Hyper design tokens and the w.box mixins on one page — the reference everything else is built from.
 *
 * The tokens are read from the tokens layer of src/w/$style_w.css itself, grouped by its comments, so the page never
 * drifts from the code: colours as swatches with their meaning, sizes as samples drawn with the token (type, spacing,
 * heights, icons, radii, lines, depth), the rest as values. Below them every mixin of w.box({ mix }) with its call and
 * a live sample, and at the bottom four molecules taken apart into the atoms and tokens they are made of. Open it on the canvas (/rpc/w.tokens) to keep the tokens in view while designing; the tabs at the top
 * switch the theme (light, dark, high contrast), each theme its own address. For the widgets themselves see w.gallery.
 * @view
 * @param opts.theme Theme the tokens and samples are drawn in — light, dark or high contrast. @default "light"
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Theme the tokens and samples are drawn in — light, dark or high contrast. @default "light" */
        theme?: "light" | "dark" | "contrast";
    },
): Promise<string> {
    const w: any = (ctx.fns as any).w;
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const theme = opts.theme === "dark" || opts.theme === "contrast" ? opts.theme : "light";
    const themeTabs = w.tabs({ variant: "underline", active: theme, items: [
        { id: "light", label: "Light", icon: "sun", action: { href: ctx.fns.rpc.url({ fn: "w.tokens", params: {} }) } },
        { id: "dark", label: "Dark", icon: "moon", action: { href: ctx.fns.rpc.url({ fn: "w.tokens", params: { theme: "dark" } }) } },
        { id: "contrast", label: "High contrast", icon: "circle-half", action: { href: ctx.fns.rpc.url({ fn: "w.tokens", params: { theme: "contrast" } }) } },
    ] });

    // The tokens layer: the first `:where(:root, [data-w-theme]) { … }` block. A comment line opens a group;
    // a declaration may carry a trailing comment, its meaning.
    const root = String((ctx.state as any).root ?? process.cwd());
    const css = await Bun.file(root + "/src/w/$style_w.css").text().catch(() => "");
    const start = css.indexOf(":where(:root, [data-w-theme]) {");
    const block = start < 0 ? "" : css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
    type Tok = { name: string; value: string; note: string };
    type Group = { title: string; tokens: Tok[] };
    const groups: Group[] = [];
    let heading = "";
    for (const raw of block.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        const only = line.match(/^\/\*\s*(.*?)\s*\*\/$/);
        if (only) {
            if (/^sizes and type$/i.test(only[1]!)) continue;
            heading = only[1]!;
            groups.push({ title: heading, tokens: [] });
            continue;
        }
        const note = line.match(/\/\*\s*(.*?)\s*\*\//)?.[1] ?? "";
        const decls = [...line.replace(/\/\*.*?\*\//g, "").matchAll(/(--w-[a-z0-9-]+)\s*:\s*([^;]+);/g)];
        if (!decls.length) continue;
        if (!groups.length) groups.push({ title: "", tokens: [] });
        decls.forEach((d, i) => groups[groups.length - 1]!.tokens.push({ name: d[1]!, value: d[2]!.trim(), note: decls.length === 1 || i === 0 ? note : "" }));
    }

    const isColour = (v: string) => /^(#|rgb|hsl)/.test(v) && !/\d+px\s+\d+px/.test(v);
    const sample = (t: Tok): string => {
        const n = t.name, v = `var(${n})`;
        if (isColour(t.value)) return `<span class="wt-swatch" style="background:${v}"></span>`;
        if (/^--w-text-/.test(n)) return `<span class="wt-type" style="font-size:${v}">Aa</span>`;
        if (/^--w-s\d$|^--w-gap-|^--w-icon-col$/.test(n)) return `<span class="wt-bar" style="width:${v}"></span>`;
        if (/^--w-(control|row$|header|rail)/.test(n)) return `<span class="wt-bar" style="height:${v};width:var(--w-s6)"></span>`;
        if (/^--w-(icon|dot|mark)/.test(n)) return `<span class="wt-sq" style="width:${v};height:${v}"></span>`;
        if (/^--w-radius-/.test(n)) return `<span class="wt-radius" style="border-radius:${v}"></span>`;
        if (/^--w-rule|^--w-focus-width/.test(n)) return `<span class="wt-rule" style="${n === "--w-focus-width" ? `border-top:${v} solid var(--w-focus)` : `border-top:${v}`}"></span>`;
        if (/^--w-shadow/.test(n)) return `<span class="wt-radius" style="box-shadow:${v};background:var(--w-surface-raised)"></span>`;
        if (n === "--w-mono") return `<span style="font-family:${v}">0Oo1lI</span>`;
        if (n === "--w-disabled-opacity") return `<span style="opacity:${v}">${w.button({ label: "Save", size: "sm" })}</span>`;
        return "";
    };
    const tokenRow = (t: Tok) => `<div class="wt-tok"><span class="wt-sample">${sample(t)}</span><code>${esc(t.name)}</code><span class="wt-val">${isColour(t.value) || /^--w-shadow/.test(t.name) ? "" : esc(t.value)}</span><span class="wt-note">${esc(t.note)}</span></div>`;
    const colours = groups.filter(g => g.tokens.some(t => isColour(t.value)));
    const sizes = groups.filter(g => !colours.includes(g) && g.tokens.length);
    const groupHtml = (g: Group) => `<div class="wt-group"><h3>${esc(g.title)}</h3>${g.tokens.map(tokenRow).join("")}</div>`;
    const count = colours.flatMap(g => g.tokens).filter(t => isColour(t.value) && !/backdrop|shadow/.test(t.name)).length;

    // A colour's hex is the light theme's; the swatch shows the current theme, so the hex is left out.
    // Mixins: each one is a call and the same call drawn live by w.box.
    const box = (mix: unknown, body: string) => w.box({ mix, body });
    const cell = (call: string, html: string) => `<div class="wt-mix"><code>${esc(call)}</code><div class="wt-live">${html}</div></div>`;
    const chips = (xs: string[]) => xs.map(x => `<span class="wt-chip">${esc(x)}</span>`).join("");
    const mixins: Array<[string, string, string[]]> = [
        ["Layout", "layout · gap · align · justify · wrap · grow · scroll", [
            cell(`{ layout: "stack", gap: "inside" }`, box({ layout: "stack", gap: "inside" }, chips(["one", "two", "three"]))),
            cell(`{ layout: "row", gap: "inside", justify: "between" }`, box({ layout: "row", gap: "inside", justify: "between" }, `<span>left</span>${box({ layout: "row", gap: "inside" }, w.button({ label: "Cancel" }) + w.button({ label: "Save", tone: "primary" }))}`)),
            cell(`{ layout: "row" } + child { grow: true, truncate: true }`, box({ layout: "row", gap: "inside" }, box({ grow: true, truncate: true }, "a long file name that ends in an ellipsis instead of wrapping to a new line") + w.badge({ text: "3" }))),
        ]],
        ["Spacing", "gap · pad · padX · padY — s1 s2 s3 s4 s6 · inside · edge", [
            cell(`{ layout: "row", gap: "s1" … "s6" }`, box({ layout: "stack", gap: "s2" }, (["s1", "s2", "s3", "s4", "s6"] as const).map(g => box({ layout: "row", gap: g }, chips([g, g, g]))).join(""))),
            cell(`{ pad: "inside" } · { pad: "edge" }`, box({ layout: "row", gap: "inside" }, box({ pad: "inside", line: "around", radius: "item" }, "inside 8 — in a row") + box({ pad: "edge", line: "around", radius: "item" }, "edge 12 — at a pane edge"))),
        ]],
        ["Text", "text · weight · ink · mono · truncate · caption", [
            cell(`{ text: "ui" | "read" | "small" }`, box({ layout: "stack", gap: "s1" }, box({ text: "ui" }, "ui 13 — interface") + box({ text: "read" }, "read 14 — messages and documents") + box({ text: "small" }, "small 11 — time, ids, hints"))),
            cell(`{ weight: "strong" } · { ink: "base" | "muted" | "faint" } · { mono: true }`, box({ layout: "row", gap: "edge" }, box({ weight: "strong" }, "strong") + box({ ink: "base" }, "base") + box({ ink: "muted" }, "muted") + box({ ink: "faint" }, "faint") + box({ mono: true }, "src/w/mix.ts"))),
            cell(`{ caption: true } — the only caps there is`, box({ layout: "stack", gap: "s1" }, box({ caption: true }, "Open editors") + box({ text: "ui" }, "layout.ts") + box({ text: "ui" }, "gallery.ts"))),
        ]],
        ["Lines", "line: around · top · bottom · start · end · between", [
            cell(`{ line: "around", radius: "item", pad: "edge" }`, box({ line: "around", radius: "item", pad: "edge" }, "a card inside a pane")),
            cell(`{ line: "bottom" } · { line: "top" }`, box({ layout: "stack", line: "around", radius: "item" }, box({ line: "bottom", pad: "inside" }, "header") + box({ pad: "inside" }, "body") + box({ line: "top", pad: "inside" }, "footer"))),
            cell(`{ layout: "stack", line: "between" }`, box({ layout: "stack", line: "between" }, ["row 1", "row 2", "row 3"].map(r => box({ padY: "s2" }, r)).join(""))),
            cell(`{ layout: "row", line: "between" }`, box({ layout: "row", line: "between" }, ["Canvas", "Chat", "Files"].map(r => box({ padX: "s3" }, r)).join(""))),
        ]],
        ["Shape and depth", "radius · raised", [
            cell(`{ radius: "frame" | "item" | "window" | "round" }`, box({ layout: "row", gap: "edge" }, (["frame", "item", "window", "round"] as const).map(r => box({ radius: r, line: "around", pad: "inside" }, r)).join(""))),
            cell(`{ raised: true, radius: "item", line: "around" }`, box({ raised: true, radius: "item", line: "around", pad: "edge" }, "what pops up")),
        ]],
    ];
    const mixHtml = mixins.map(([t, sub, cells]) => `<div class="wt-group"><h3>${esc(t)} <small>${esc(sub)}</small></h3><div class="wt-mixes">${cells.join("")}</div></div>`).join("");

    // A few molecules taken apart: the molecule, then the atoms it is made of, each drawn alone, then the tokens
    // it reads (w.anatomy finds them in the source and the stylesheet, so this cannot drift either).
    const part = (html: string, name: string, note = "") => `<div class="wt-part"><div class="wt-part-sample">${html}</div><code>${esc(name)}</code>${note ? `<small>${esc(note)}</small>` : ""}</div>`;
    const plus = `<span class="wt-plus">+</span>`;
    const molecule = async (name: string, sample: () => unknown, parts: () => string[]) => {
        let html: string, made: string;
        try { html = String(await sample()); made = parts().join(plus); } catch (e: any) { html = `<span class="wx-text-small">${esc(name)}: ${esc(e?.message ?? e)}</span>`; made = ""; }
        const a: any = await w.anatomy({ name }).catch(() => ({ tokens: {} }));
        const toks = Object.entries(a.tokens ?? {}).map(([k, v]) => `<div class="wt-f-row"><span>${esc(k)}</span><code>${(v as string[]).map(esc).join(" · ")}</code></div>`).join("");
        return `<div class="wt-group wt-mol"><h3><code>w.${esc(name)}</code></h3><div class="wt-live">${html}</div><div class="wt-eq">=</div><div class="wt-parts">${made}</div><div class="wt-toks"><div class="wt-toks-head">tokens it reads</div>${toks}</div></div>`;
    };
    const molecules = (await Promise.all([
        molecule("listRow",
            () => w.list({ body: w.listRow({ label: "UI layouts: canvas, chat, voice", icon: "squares-four", hint: "hyper-design", dot: "running", current: true }) }),
            () => [part(w.icon({ name: "squares-four", size: 16 }), "w.icon", "16, in the icon column"), part(box({ text: "ui" }, "UI layouts…"), "label", "text ui, truncates"), part(box({ text: "small", ink: "faint" }, "hyper-design"), "hint", "text small, faint"), part(w.dot({ state: "running" }), "w.dot", "state"), part(`<span class="wt-chip">current</span>`, "selected", "backing + link ink")]),
        molecule("iconButton",
            () => [w.iconButton({ icon: "sidebar-simple", label: "Panel", pressed: true }), w.iconButton({ icon: "bell", label: "Mentions", badge: 3 })].join(" "),
            () => [part(w.icon({ name: "bell", size: 16 }), "w.icon", "16 in 28, 14 in 24"), part(`<span class="wt-box28"></span>`, "square", "control 28 · radius item · hover grey"), part(`<span class="w-badge-mark" style="position:static">3</span>`, "mark", "count on the corner")]),
        molecule("toast",
            () => w.toast({ message: "Pushed to main", level: "success", body: "a8d89626 — chat header" }),
            () => [part(w.icon({ name: "check-circle", size: 16, tone: "success" }), "w.icon", "tone = level"), part(box({ text: "ui" }, "Pushed to main"), "message", "text ui"), part(box({ text: "small", ink: "muted" }, "a8d89626 — …"), "body", "text small, muted"), part(box({ raised: true, radius: "item", line: "around", pad: "inside" }, "&nbsp;"), "surface", "raised · width popup")]),
        molecule("keyValue",
            () => w.keyValue({ items: [{ key: "Model", value: "opus-5.5" }, { key: "Started", html: w.time({ ts: Date.now() - 7200e3, format: "ago" }) }] }),
            () => [part(box({ text: "ui", ink: "faint" }, "Model"), "key", "faint, width label"), part(box({ text: "ui" }, "opus-5.5"), "value", "text ui"), part(w.time({ ts: Date.now() - 7200e3, format: "ago" }), "w.time", "or any atom as html")]),
    ])).join("");

    const style = `<style>
    .wt{min-height:100%;padding:var(--w-s6) max(var(--w-s6),calc((100% - 76rem)/2)) 3rem;font-size:var(--w-text-ui);color:var(--w-ink);background:var(--w-surface-document)}
    .wt-top{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--w-s4)}.wt-top .w-tabs{border-bottom:0}
    .wt h1{font-size:20px;font-weight:500;margin:0}.wt>p{color:var(--w-ink-muted);margin:var(--w-s1) 0 var(--w-s4);max-width:var(--w-measure)}
    .wt code{font-family:var(--w-mono);font-size:var(--w-text-small);color:var(--w-ink-muted);background:var(--w-hover);padding:0 var(--w-s1);border-radius:var(--w-radius-item)}.wt-tok>code{background:none;padding:0}
    .wt h2{font-size:var(--w-text-small);font-weight:500;letter-spacing:var(--w-caps-spacing);text-transform:uppercase;color:var(--w-ink-faint);margin:var(--w-s6) 0 var(--w-s2)}
    .wt h2 small,.wt h3 small{font-weight:400;letter-spacing:0;text-transform:none;color:var(--w-ink-faint);font-size:var(--w-text-small);margin-left:var(--w-s2)}
    .wt h3{font-size:var(--w-text-ui);font-weight:500;margin:0 0 var(--w-s2);overflow-wrap:anywhere}
    .wt-cols{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,22rem),1fr));gap:var(--w-s4)}
    .wt-group{border:var(--w-rule);border-radius:var(--w-radius-item);padding:var(--w-s3);min-width:0}
    .wt-tok{display:grid;grid-template-columns:3.5rem minmax(0,1fr) auto;align-items:center;column-gap:var(--w-s2);padding:var(--w-s1) 0;min-height:var(--w-control);border-top:var(--w-rule)}.wt-tok>code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--w-ink)}.wt-tok .wt-note{grid-column:2/-1}.wt-tok .wt-note:empty{display:none}.wt-tok:first-of-type{border-top:0}
    .wt-tok .wt-val{font-family:var(--w-mono);font-size:var(--w-text-small);color:var(--w-ink-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wt-note{color:var(--w-ink-muted);font-size:var(--w-text-small)}
    .wt-sample{display:flex;white-space:nowrap;align-items:center;min-height:var(--w-control-sm)}
    .wt-swatch{width:var(--w-control);height:var(--w-control-sm);border-radius:var(--w-radius-item);border:var(--w-rule)}
    .wt-type{line-height:1}.wt-bar{display:block;height:var(--w-s2);background:var(--w-live);border-radius:2px}.wt-sq{display:block;background:var(--w-ink-muted);border-radius:2px}
    .wt-radius{display:block;width:var(--w-control);height:var(--w-control-sm);border:var(--w-rule-control)}.wt-rule{display:block;width:var(--w-control)}
    .wt-mixes{display:grid;gap:var(--w-s3);min-width:0}.wt-mix{display:grid;gap:var(--w-s2);min-width:0}.wt-mix>code{overflow-wrap:anywhere}.wt-live{min-width:0;overflow:hidden;padding:var(--w-s3);background:var(--w-surface-chat);border-radius:var(--w-radius-item)}
    .wt-chip{display:inline-block;padding:0 var(--w-s2);background:var(--w-selected);color:var(--w-link);border-radius:var(--w-radius-item)}
    .wt-mol{display:grid;gap:var(--w-s2);align-content:start}.wt-eq{color:var(--w-ink-faint);font-size:var(--w-text-small)}
    .wt-parts{display:flex;flex-wrap:wrap;align-items:flex-start;gap:var(--w-s2)}.wt-plus{color:var(--w-ink-faint);align-self:center;padding-bottom:var(--w-s6)}
    .wt-part{display:grid;justify-items:start;gap:var(--w-s1);min-width:0}.wt-part-sample{display:flex;align-items:center;min-height:var(--w-control);padding:0 var(--w-s2);border:1px dashed var(--w-border-control);border-radius:var(--w-radius-item)}.wt-part small{color:var(--w-ink-faint);font-size:var(--w-text-small)}
    .wt-box28{display:block;width:var(--w-control-sm);height:var(--w-control-sm);background:var(--w-hover);border-radius:var(--w-radius-item)}
    .wt-toks{display:grid;gap:var(--w-s1);padding-top:var(--w-s2);border-top:var(--w-rule);font-size:var(--w-text-small)}.wt-toks-head{color:var(--w-ink-muted)}.wt-f-row{display:grid;grid-template-columns:4rem 1fr;gap:var(--w-s2)}.wt-f-row>span{color:var(--w-ink-faint)}
    </style>`;
    return `${style}<div class="wt" data-w-theme="${theme}"><div class="wt-top"><h1>Hyper tokens</h1>${themeTabs}</div><p>Everything the w.* widgets are made of: ${count} colours by meaning, sizes by name and the mixins of <code>w.box</code> for page layout. The tokens are read from the tokens layer of <code>src/w/$style_w.css</code>, and every sample is drawn with the token itself — change a token and this page and every widget follow. Principles: <code>docs/ui-design-system.md</code>. The widgets: <code>w.gallery</code>.</p><h2>Colours <small>${count} meanings, no numbered scale — a theme sets them, every widget reads them</small></h2><div class="wt-cols">${colours.map(groupHtml).join("")}</div><h2>Sizes <small>a number lives only in the token; a widget uses the name</small></h2><div class="wt-cols">${sizes.map(groupHtml).join("")}</div><h2>Mixins <small>w.box({ mix }) → wx-* classes; the last one wins</small></h2><div class="wt-cols">${mixHtml}</div><h2>Molecules taken apart <small>a molecule = atoms + tokens; all of them in w.gallery</small></h2><div class="wt-cols">${molecules}</div></div>`;
}
