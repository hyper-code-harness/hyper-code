// Pick rows from a table with a live filter box — for "which of these 300
// patients / repos / deals". Rows are either given inline (filtered on the
// server, no runtime call) or produced by a runtime function asked again for
// every filter, so a big database table is never shipped whole into the spec.
// Picked rows stay pinned on top while the filter changes.

export const hint = 'pick one or several rows from a table with a live text filter — spec `{ rows?: object[] (≤5000, inline) | source?: { fn: "module.function", args? } (called with { ...args, q, limit } → rows), columns?: { key, label? }[], valueKey?: "id", labelKey?, multiple?: boolean }`; result `{ value, row }` or `{ values, rows }`';

const PAGE = 50;
type Column = { key: string; label: string };

async function matches(ctx: Context, spec: Record<string, any>, q: string): Promise<any[]> {
    if (spec.source) {
        const fn = String(spec.source.fn).split(".").reduce((f: any, part: string) => f?.[part], ctx.fns as any);
        if (typeof fn !== "function") throw new Error(`grid: no runtime function ${spec.source.fn}`);
        const out = await fn({ ...(spec.source.args ?? {}), q, limit: PAGE });
        return (Array.isArray(out) ? out : out?.rows ?? []).slice(0, PAGE);
    }
    const needle = q.trim().toLowerCase();
    const rows: any[] = spec.rows ?? [];
    const keys: string[] = spec.columns.map((c: Column) => c.key);
    return (needle ? rows.filter(r => keys.some(k => cell(r[k]).toLowerCase().includes(needle))) : rows).slice(0, PAGE);
}

function cell(v: unknown): string {
    if (v == null) return "";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function rowsHtml(ctx: Context, input: types.input.Row, rows: any[], picked: Set<string>): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const s = input.spec;
    const type = s.multiple ? "checkbox" : "radio";
    if (!rows.length) return `<tr><td colspan="${s.columns.length + 1}" class="py-3 text-center text-2xs text-muted">no results found</td></tr>`;
    return rows.map(r => {
        const value = cell(r[s.valueKey]);
        return `<tr class="cursor-pointer hover:bg-base-200/60 has-[:checked]:bg-primary/10" onclick="if(event.target.tagName!=='INPUT'){const i=this.querySelector('input');i.checked=${s.multiple ? "!i.checked" : "true"}}">`
            + `<td class="w-8"><input type="${type}" name="pick" value="${esc(value)}"${picked.has(value) ? " checked" : ""} class="${type} ${type}-xs ${type}-primary"></td>`
            + s.columns.map((c: Column) => `<td class="max-w-64 truncate" title="${esc(cell(r[c.key]))}">${esc(cell(r[c.key]))}</td>`).join("")
            + `</tr>`;
    }).join("");
}

async function body(ctx: Context, input: types.input.Row, q: string, picked: Set<string>): Promise<string> {
    const found = await matches(ctx, input.spec, q);
    // Picked rows stay visible (and submitted) even when the filter hides them.
    const key = input.spec.valueKey;
    const seen = new Set(found.map(r => cell(r[key])));
    const pinned = [...picked].filter(v => !seen.has(v)).map(v => (input.spec.rows?.find((r: any) => cell(r[key]) === v) ?? { [key]: v }));
    return rowsHtml(ctx, input, [...pinned, ...found], picked);
}

export default {
    icon: "table",
    async prepare(ctx: Context, opts: { spec: Record<string, any> }) {
        const s = opts.spec;
        if (!Array.isArray(s.rows) && !s.source?.fn) throw new Error("grid: give rows (inline) or source: { fn }");
        if (Array.isArray(s.rows) && s.rows.length > 5000) throw new Error("grid: at most 5000 inline rows — use source: { fn } for bigger tables");
        const sample = Array.isArray(s.rows) ? s.rows : await matches(ctx, { source: s.source, columns: [] }, "");
        const valueKey = String(s.valueKey ?? "id");
        const columns: Column[] = Array.isArray(s.columns) && s.columns.length
            ? s.columns.map((c: any) => typeof c === "string" ? { key: c, label: c } : { key: String(c.key), label: String(c.label ?? c.key) })
            : Object.keys(sample[0] ?? { [valueKey]: "" }).slice(0, 8).map(k => ({ key: k, label: k }));
        return {
            ...(Array.isArray(s.rows) ? { rows: s.rows } : { source: { fn: String(s.source.fn), args: s.source.args ?? {} } }),
            columns, valueKey, labelKey: s.labelKey ? String(s.labelKey) : columns.find(c => c.key !== valueKey)?.key ?? valueKey,
            multiple: s.multiple === true,
        };
    },
    async open(ctx: Context, opts: { input: types.input.Row }) {
        const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
        const input = opts.input;
        const rowsId = `grid-rows-${input.id}`;
        const head = input.spec.columns.map((c: Column) => `<th>${esc(c.label)}</th>`).join("");
        return `<input type="search" name="q" placeholder="filter…" autocomplete="off" class="input input-bordered input-sm w-full bg-base-100" `
            + `hx-get="/input/${esc(input.id)}/part" hx-trigger="input changed delay:250ms, search" hx-include="closest form" hx-target="#${rowsId}" hx-swap="innerHTML" `
            + `onkeydown="if(event.key==='Enter')event.preventDefault()">`
            + `<div class="max-h-96 overflow-auto rounded-md border border-ui-border"><table class="table table-xs w-full"><thead class="sticky top-0 bg-base-200"><tr><th></th>${head}</tr></thead>`
            + `<tbody id="${rowsId}">${await body(ctx, input, "", new Set())}</tbody></table></div>`
            + `<p class="text-3xs text-faint">showing the first ${PAGE} matches</p>`;
    },
    async part(ctx: Context, opts: { input: types.input.Row; query: URLSearchParams }) {
        return body(ctx, opts.input, opts.query.get("q") ?? "", new Set(opts.query.getAll("pick")));
    },
    async submit(ctx: Context, opts: { input: types.input.Row; values: types.input.FormValues }) {
        const s = opts.input.spec;
        const picked = [...new Set(([] as string[]).concat(opts.values.pick ?? []))];
        if (!picked.length) throw new Error("Select a row");
        if (!s.multiple && picked.length > 1) throw new Error("Select only one row");
        // Resolve the picked values back to rows — from the inline list, or by
        // asking the source again with each value as the filter.
        const rows: any[] = [];
        for (const v of picked) {
            const row = s.rows ? s.rows.find((r: any) => cell(r[s.valueKey]) === v)
                : (await matches(ctx, s, v)).find((r: any) => cell(r[s.valueKey]) === v);
            if (!row) throw new Error(`Row ${v} is no longer available`);
            rows.push(row);
        }
        const labels = rows.map(r => cell(r[s.labelKey]) || cell(r[s.valueKey]));
        return s.multiple
            ? { result: { values: picked, rows }, summary: `picked ${picked.length}: ${labels.join(", ")}` }
            : { result: { value: picked[0], row: rows[0] }, summary: `picked "${labels[0]}" (${s.valueKey}=${picked[0]})` };
    },
    done(ctx: Context, opts: { input: types.input.Row }) {
        const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
        const s = opts.input.spec;
        const rows: any[] = opts.input.result?.rows ?? (opts.input.result?.row ? [opts.input.result.row] : []);
        const head = s.columns.map((c: Column) => `<th>${esc(c.label)}</th>`).join("");
        return `<div class="max-h-60 overflow-auto rounded-md border border-ui-border"><table class="table table-xs w-full"><thead><tr>${head}</tr></thead><tbody>`
            + rows.map(r => `<tr>${s.columns.map((c: Column) => `<td class="max-w-64 truncate">${esc(cell(r[c.key]))}</td>`).join("")}</tr>`).join("")
            + `</tbody></table></div>`;
    },
} satisfies types.input.Kind;
