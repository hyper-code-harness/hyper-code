/**
 * Highlights mentions (@id) of known people inside rendered message HTML.
 *
 * Wraps each `@<user id>` in text (never inside tags, code or pre) in a chip carrying the person's name as
 * title and `data-mention`, so a reader sees who was addressed. Unknown @words are left as they are.
 * @param opts.html Rendered, already-escaped message HTML.
 * @param opts.tone Bubble tone the chip sits on: dark (the user's own bubble) or light.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Rendered, already-escaped message HTML. */
        html: string;
        /** Bubble tone the chip sits on: dark (the user's own bubble) or light. @default "light" */
        tone?: "dark" | "light";
    },
): Promise<string> {
    const html = String(opts.html ?? "");
    if (!html.includes("@")) return html;
    const people = new Map((await ctx.fns.mentions.people({})).map((p) => [p.id, p]));
    if (!people.size) return html;
    const esc = (v: string) => ctx.fns.procs.ui.escape({ text: v });
    const chip = opts.tone === "dark"
        ? "rounded bg-white/20 px-0.5 font-semibold text-white"
        : "rounded bg-primary/10 px-0.5 font-semibold text-primary";
    let skip = 0; // depth inside <code>/<pre>
    return html.split(/(<[^>]*>)/).map((part) => {
        if (part.startsWith("<")) {
            if (/^<(code|pre)[\s>]/i.test(part)) skip++;
            else if (/^<\/(code|pre)>/i.test(part)) skip = Math.max(0, skip - 1);
            return part;
        }
        if (skip || !part.includes("@")) return part;
        return part.replace(/(^|[^\w@.\/-])@([a-z0-9][a-z0-9-]{0,63})(?![\w-])/gi, (all, lead, raw) => {
            const person = people.get(String(raw).toLowerCase());
            if (!person) return all;
            return `${lead}<span class="${chip}" data-mention="${esc(person.id)}" title="${esc(person.name)}">@${esc(raw)}</span>`;
        });
    }).join("");
}
