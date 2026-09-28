/**
 * Derives a short, stable, lowercase user id from a name or email.
 *
 * Uses the email local part when present, otherwise the name; appends a number when taken.
 * The id is written as author everywhere and never changes, so it is chosen once at creation.
 * @param opts.name Display name.
 * @param opts.email Optional email; its local part is preferred.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Display name. */
        name: string;
        /** Optional email; its local part is preferred. */
        email?: string | null;
    },
): Promise<string> {
    const source = (opts.email ? String(opts.email).split("@")[0] : "") || String(opts.name ?? "");
    const base = source.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "user";
    for (let n = 0; n < 1000; n++) {
        const id = n === 0 ? base : `${base}-${n + 1}`;
        const taken = await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM users WHERE id = ?", params: [id] }) as any[];
        if (!taken.length) return id;
    }
    return `${base}-${Bun.randomUUIDv7().slice(-6)}`;
}
