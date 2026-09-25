// Answers "does this record already exist under another id?" before a write.
//
// The graph accumulated sixty duplicates because knowledge.upsert trusts the
// slug it is handed: a new spelling of a name is a new slug, and a new slug is
// a new entity. Matt Pfeffer and Matthew Pfeffer therefore lived side by side
// while sharing one LinkedIn profile.
//
// A shared account handle is not similarity, it is identity: two records with
// the same linkedin or github are the same subject, whatever their names look
// like. That is the only evidence this function accepts.

/** Finds an existing entity that already owns one of the incoming record's contact identifiers. */
/**
 * Resolve an incoming entity record to the id that already holds the same
 * account, so a write lands on the existing entity instead of creating a twin.
 *
 * Use before `knowledge.upsert` when importing contacts, or whenever a record
 * arrives from a source that invents its own slugs. Matching is by canonical
 * identity key — linkedin, telegram, github, email — never by name, because
 * names are exactly what varies between duplicates.
 *
 * Returns null when nothing matches, and reports every match when an incoming
 * record collides with more than one existing entity, which itself means the
 * graph still holds duplicates.
 *
 * @param opts.type Entity type to search within.
 * @param opts.data Incoming record whose contact fields are matched.
 * @param opts.ignore Entity id to exclude, normally the record's own id.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Entity type the incoming record belongs to. */
    type: string;
    /** Incoming entity data with contact fields. */
    data: Record<string, any>;
    /** Id to exclude from matching, typically the record's own. */
    ignore?: string;
}): Promise<{
    id: string | null;
    keys: string[];
    matchedKey: string | null;
    matches: Array<{ id: string; key: string }>;
}> {
    await ctx.fns.knowledge.ensure({});
    const keys = ctx.fns.knowledge.identityKeys({ data: opts.data });
    if (!keys.length) return { id: null, keys, matchedKey: null, matches: [] };

    // Identity keys are derived, not stored, so candidates are narrowed in SQL
    // by raw containment and confirmed in code after normalization. Matching
    // on the raw string alone would miss fi.linkedin.com against www.
    const needles = keys.map((key) => key.slice(key.indexOf(":") + 1));
    const clauses = needles.map(() => "data::text ILIKE ?").join(" OR ");
    const rows: any[] = await ctx.fns.procs.db.select({
        sql: `SELECT id, data FROM knowledge.entities WHERE type = ? AND (${clauses})`,
        params: [opts.type, ...needles.map((needle) => `%${needle}%`)],
    });

    const wanted = new Set(keys);
    const matches: Array<{ id: string; key: string }> = [];
    for (const row of rows) {
        if (opts.ignore && String(row.id) === opts.ignore) continue;
        const hit = ctx.fns.knowledge.identityKeys({ data: row.data ?? {} }).find((key) => wanted.has(key));
        if (hit) matches.push({ id: String(row.id), key: hit });
    }

    return { id: matches[0]?.id ?? null, keys, matchedKey: matches[0]?.key ?? null, matches };
}
