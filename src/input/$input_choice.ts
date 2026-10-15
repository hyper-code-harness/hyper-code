// One (or several) of a handful of options, as tappable cards. `allowOther`
// adds a free-text answer for when none of the options fits.

export const hint = 'one or several of a few options — spec `{ options: (string | { value, label?, description? })[] (2–30), multiple?: boolean, allowOther?: boolean }`; result `{ value }` or `{ values: [] }`, plus `other` when the person typed their own answer';

type Option = { value: string; label: string; description?: string };

export default {
    icon: "list-checks",
    prepare(_ctx: Context, opts: { spec: Record<string, any> }) {
        const raw = Array.isArray(opts.spec.options) ? opts.spec.options : [];
        const options: Option[] = raw.map((o: any) => typeof o === "string" || typeof o === "number"
            ? { value: String(o), label: String(o) }
            : { value: String(o?.value ?? o?.label ?? ""), label: String(o?.label ?? o?.value ?? ""), ...(o?.description ? { description: String(o.description) } : {}) });
        if (options.length < 1 || options.length > 30) throw new Error("choice: options must have 1–30 entries");
        if (options.some(o => !o.value)) throw new Error("choice: every option needs a value");
        if (new Set(options.map(o => o.value)).size !== options.length) throw new Error("choice: option values must be unique");
        return { options, multiple: opts.spec.multiple === true, allowOther: opts.spec.allowOther === true };
    },
    open(ctx: Context, opts: { input: types.input.Row }) {
        const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: v });
        const s = opts.input.spec;
        const type = s.multiple ? "checkbox" : "radio";
        const cards = (s.options as Option[]).map(o => `<label class="flex cursor-pointer items-start gap-2 rounded-md border border-ui-border bg-base-100 px-3 py-2 text-sm hover:border-primary has-[:checked]:border-primary has-[:checked]:bg-primary/5">`
            + `<input type="${type}" name="pick" value="${esc(o.value)}" class="${type} ${type}-sm ${type}-primary mt-0.5">`
            + `<span class="min-w-0"><span class="block font-medium">${esc(o.label)}</span>${o.description ? `<span class="block text-2xs text-muted">${esc(o.description)}</span>` : ""}</span></label>`).join("");
        const other = s.allowOther ? `<input name="other" maxlength="2000" placeholder="other option" class="input input-bordered input-sm w-full bg-base-100">` : "";
        return `<div class="grid gap-2 sm:grid-cols-2">${cards}</div>${other}`;
    },
    submit(_ctx: Context, opts: { input: types.input.Row; values: types.input.FormValues }) {
        const s = opts.input.spec;
        const known = new Set((s.options as Option[]).map(o => o.value));
        const picked = ([] as string[]).concat(opts.values.pick ?? []).filter(v => known.has(v));
        const other = String(opts.values.other ?? "").trim();
        if (!picked.length && !other) throw new Error(s.allowOther ? "Select an option or enter your own" : "Select an option");
        const result: Record<string, any> = s.multiple ? { values: picked } : picked.length ? { value: picked[0] } : {};
        if (other) result.other = other;
        const label = (v: string) => (s.options as Option[]).find(o => o.value === v)?.label ?? v;
        const summary = [picked.length ? `chose ${picked.map(v => `"${label(v)}"`).join(", ")}` : "", other ? `other: ${other}` : ""].filter(Boolean).join("; ");
        return { result, summary };
    },
    done(ctx: Context, opts: { input: types.input.Row }) {
        const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: v });
        const s = opts.input.spec;
        const r = opts.input.result ?? {};
        const picked: string[] = r.values ?? (r.value != null ? [r.value] : []);
        const label = (v: string) => (s.options as Option[]).find(o => o.value === v)?.label ?? v;
        const chips = picked.map(v => `<span class="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs"><i class="ph ph-check" aria-hidden="true"></i>${esc(label(v))}</span>`).join(" ");
        return `<div class="flex flex-wrap gap-1">${chips}</div>` + (r.other ? `<p class="mt-1 text-2xs text-muted">other option: «${esc(r.other)}»</p>` : "");
    },
} satisfies types.input.Kind;
