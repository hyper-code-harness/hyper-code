/**
 * Finds the people a message text mentions with @id.
 *
 * Matches `@<user id>` at a word start (an email address such as a@b.io is not a mention) against the
 * known users, case-insensitively, each person once in order of appearance. Unknown ids are ignored.
 * @param opts.text Message text to scan.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Message text to scan. */
        text: string;
    },
): Promise<string[]> {
    const text = String(opts.text ?? "");
    if (!text.includes("@")) return [];
    const ids = new Set((await ctx.fns.mentions.people({})).map((p) => p.id));
    const found: string[] = [];
    for (const m of text.matchAll(/(^|[^\w@.\/-])@([a-z0-9][a-z0-9-]{0,63})(?![\w-])/gi)) {
        const id = m[2]!.toLowerCase();
        if (ids.has(id) && !found.includes(id)) found.push(id);
    }
    return found;
}
