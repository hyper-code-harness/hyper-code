// The single write path into the knowledge graph — and therefore the only
// place where duplicates can be prevented rather than cleaned up later.
//
// The graph once held three Nikolai Ryzhikovs and two Marys because this
// function trusted the slug it was handed: a new spelling produced a new slug,
// and a new slug produced a new entity, even when both records carried the same
// LinkedIn profile. A shared account handle is identity, not similarity, so a
// write whose contact details already belong to someone is redirected onto that
// existing entity instead of founding a twin.
//
// The guard only ever redirects a CREATE. Writing to an id that already exists
// is an explicit instruction and is never rerouted.

/**
 * Creates or merges one canonical typed knowledge entity.
 * Use for normalized people, organizations, products, concepts, schema definitions, and other `Type/slug` entities.
 *
 * A new entity whose linkedin, telegram, github or email already belongs to an
 * existing record is written into that record instead, keeping the requested
 * name as an alias. Pass `force` to create it anyway.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Stable `Type/slug` identifier. */ id: string;
    /** Canonical JSON facts merged over existing data. */ data: Record<string, any>;
    /** Replace all canonical data rather than merging unspecified fields. @default false */ replace?: boolean;
    /** Refresh this entity's searchable projection. @default true */ rebuild?: boolean;
    /** Create the entity even when its contact identifiers match another one. @default false */ force?: boolean;
}): Promise<{ id: string; type: string; data: Record<string, any>; redirectedFrom?: string; matchedKey?: string }> {
    await ctx.fns.knowledge.ensure({});
    let id = String(opts.id ?? "").trim();
    const match = /^([A-Za-z][\w-]*)\/([\w.@-]+)$/.exec(id);
    if (!match) throw new Error("knowledge.upsert: id must be Type/slug");
    const type = match[1]!;

    let existing = (await ctx.fns.procs.db.select({ sql: "SELECT data FROM knowledge.entities WHERE id = ?", params: [id] }))[0]?.data;
    let redirectedFrom: string | undefined;
    let matchedKey: string | undefined;

    if (existing == null && opts.force !== true) {
        const resolved = await ctx.fns.knowledge.resolveIdentity({ type, data: opts.data ?? {}, ignore: id });
        if (resolved.id) {
            redirectedFrom = id;
            matchedKey = resolved.matchedKey ?? undefined;
            id = resolved.id;
            existing = (await ctx.fns.procs.db.select({ sql: "SELECT data FROM knowledge.entities WHERE id = ?", params: [id] }))[0]?.data ?? {};
            ctx.fns.procs.log.info({
                event: "knowledge.upsert.redirected",
                msg: `${redirectedFrom} → ${id} on ${matchedKey}`,
            });
        }
    }

    const old = existing ?? {};
    // A redirect must not rename the entity it landed on, and the name that was
    // asked for is worth keeping: it is how somebody will search tomorrow.
    let incoming = opts.data ?? {};
    if (redirectedFrom) {
        const { title, name, ...rest } = incoming as Record<string, any>;
        const alias = String(title ?? name ?? "").trim();
        const known = String(old.title ?? old.name ?? "").trim();
        incoming = rest;
        if (alias && alias !== known) {
            incoming.aka = [...new Set([...(([] as string[]).concat(old.aka ?? [])), alias])];
        }
    }

    const data = opts.replace && !redirectedFrom ? incoming : { ...old, ...incoming };
    await ctx.fns.procs.db.run({
        sql: `INSERT INTO knowledge.entities(id,type,data,updated_at) VALUES(?,?,?::jsonb,now())
              ON CONFLICT(id) DO UPDATE SET type=excluded.type,data=excluded.data,updated_at=now()`,
        params: [id, type, JSON.stringify(data)],
    });
    if (opts.rebuild !== false) await ctx.fns.knowledge.rebuildSearch({ ids: [id] });
    return redirectedFrom ? { id, type, data, redirectedFrom, matchedKey } : { id, type, data };
}
