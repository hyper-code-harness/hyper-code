/**
 * Draws the new-project form: title, slug and working folder, with an optional error above the fields.
 *
 * Use for the /project/new page. The slug field fills itself from the title (lowerCamelCase) until the
 * person edits it; the folder defaults to the server's working directory. Values are kept on a failed submit.
 * @param opts.values Field values to show again after a failed submit.
 * @param opts.error Error text shown above the fields.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Field values to show again after a failed submit. */
    values?: { title?: string; slug?: string; defaultDir?: string };
    /** Error text shown above the fields. */
    error?: string;
} = {}): Promise<string> {
    const esc = (s: unknown) => ctx.fns.w.escape({ text: String(s ?? "") });
    const v = opts.values ?? {};
    const input = "input input-bordered w-full bg-base-100";
    // Title → slug: words joined in lowerCamelCase, Latin letters and digits only, leading letter.
    const toSlug = "var s=this.form.slug;if(s.dataset.touched)return;var w=this.value.normalize('NFKD').replace(/[^A-Za-z0-9]+/g,' ').trim().split(' ').filter(Boolean);var t=w.map(function(x,i){x=x.toLowerCase();return i?x.charAt(0).toUpperCase()+x.slice(1):x}).join('').replace(/^[0-9]+/,'');s.value=t.slice(0,63)";
    return `${opts.error ? `<div role="alert" class="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">${esc(opts.error)}</div>` : ""}`
        + `<label class="block text-sm"><span class="mb-1 block text-faint">Title</span><input name="title" required maxlength="120" value="${esc(v.title)}" placeholder="community" autofocus class="${input}" oninput="${toSlug}"></label>`
        + `<label class="block text-sm"><span class="mb-1 block text-faint">Slug — names the project's functions (project_&lt;slug&gt;), can't be changed later</span><input name="slug" required pattern="[a-z][A-Za-z0-9]{0,62}" value="${esc(v.slug)}" placeholder="community" class="${input} font-mono" oninput="this.dataset.touched=1"></label>`
        + `<label class="block text-sm"><span class="mb-1 block text-faint">Folder — new agents in the project work here; created if missing</span><input name="defaultDir" required value="${esc(v.defaultDir || process.cwd())}" class="${input} font-mono"></label>`;
}
