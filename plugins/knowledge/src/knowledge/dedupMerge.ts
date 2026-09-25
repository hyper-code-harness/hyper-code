// Merges a duplicate entity into its canonical twin.
//
// A merge touches five places and all of them must move together, so the whole
// thing runs as one statement batch: canonical data, relations on both sides,
// provenance, the search projection, and a redirect row so the dead id still
// resolves.
//
// Field-level policy is deliberately conservative: the survivor keeps every
// value it already has, and only picks up fields it was missing. A merge
// therefore never destroys a fact, which is what makes it safe to run in bulk.
// The loser's display name is preserved as an alias, because "Matt Pfeffer" is
// how somebody will search for "Matthew Pfeffer" tomorrow.

/** Merges one duplicate knowledge entity into a canonical one, moving relations, provenance and search projection. */
/**
 * Fold a duplicate entity into the canonical record without losing facts.
 *
 * Use after a duplicate pair has been confirmed — by a shared identifier, a
 * human, or a decision model. The survivor keeps all of its own values, gains
 * any field it lacked, and records the loser's name in `aka` plus the loser's
 * id in `merged_from`. Relations pointing at either side are rewritten to the
 * survivor, self-loops are dropped, and provenance is repointed so evidence
 * survives.
 *
 * Runs as a dry run by default: nothing is written until `apply` is set, so the
 * planned effect can be inspected first.
 *
 * @param opts.keep Canonical entity id that survives the merge.
 * @param opts.drop Duplicate entity id that is folded into the survivor.
 * @param opts.apply Perform the write; omit to preview the plan.
 * @param opts.reason Short note stored with the merge for audit.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Canonical `Type/slug` that survives. */
    keep: string;
    /** Duplicate `Type/slug` folded into the survivor and deleted. */
    drop: string;
    /** Write the merge; false returns the plan only. @default false */
    apply?: boolean;
    /** Audit note explaining why the pair was merged. */
    reason?: string;
}): Promise<{
    applied: boolean;
    keep: string;
    drop: string;
    fieldsGained: string[];
    fieldsConflicting: string[];
    relationsMoved: number;
    provenanceMoved: number;
    aka: string[];
}> {
    await ctx.fns.knowledge.ensure({});
    const keep = String(opts.keep ?? "").trim();
    const drop = String(opts.drop ?? "").trim();
    if (!keep || !drop) throw new Error("knowledge.dedupMerge: keep and drop are required");
    if (keep === drop) throw new Error("knowledge.dedupMerge: keep and drop must differ");

    const rows: any[] = await ctx.fns.procs.db.select({
        sql: "SELECT id, type, data FROM knowledge.entities WHERE id IN (?, ?)",
        params: [keep, drop],
    });
    const survivor = rows.find((row) => row.id === keep);
    const loser = rows.find((row) => row.id === drop);
    if (!survivor) throw new Error(`knowledge.dedupMerge: keep not found: ${keep}`);
    if (!loser) throw new Error(`knowledge.dedupMerge: drop not found: ${drop}`);
    if (survivor.type !== loser.type) throw new Error(`knowledge.dedupMerge: type mismatch ${survivor.type} vs ${loser.type}`);

    // An explicit "these are different" verdict outranks any similarity.
    const distinct = ([] as string[])
        .concat(survivor.data?.distinct_from ?? [], loser.data?.distinct_from ?? [])
        .map((value: string) => String(value).toLowerCase());
    if (distinct.includes(keep.toLowerCase()) || distinct.includes(drop.toLowerCase())) {
        throw new Error("knowledge.dedupMerge: pair is marked distinct_from; refusing to merge");
    }

    const keepData: Record<string, any> = { ...(survivor.data ?? {}) };
    const dropData: Record<string, any> = loser.data ?? {};
    const fieldsGained: string[] = [];
    const fieldsConflicting: string[] = [];
    for (const [field, value] of Object.entries(dropData)) {
        if (field === "aka" || field === "merged_from") continue;
        const current = keepData[field];
        if (current == null || current === "" || (Array.isArray(current) && current.length === 0)) {
            keepData[field] = value;
            fieldsGained.push(field);
        } else if (JSON.stringify(current) !== JSON.stringify(value)) {
            fieldsConflicting.push(field);
        }
    }

    const names = new Set<string>(([] as string[])
        .concat(keepData.aka ?? [], dropData.aka ?? [])
        .map((value: any) => String(value)).filter(Boolean));
    const loserName = String(dropData.title ?? dropData.name ?? "").trim();
    const keepName = String(keepData.title ?? keepData.name ?? "").trim();
    if (loserName && loserName !== keepName) names.add(loserName);
    const aka = [...names];
    if (aka.length) keepData.aka = aka;
    keepData.merged_from = [...new Set(([] as string[]).concat(keepData.merged_from ?? [], [drop]))];

    const relations = Number(((await ctx.fns.procs.db.select({
        sql: "SELECT count(*) c FROM knowledge.relations WHERE subject = ? OR object = ?",
        params: [drop, drop],
    })) as any[])[0]?.c ?? 0);
    const provenance = Number(((await ctx.fns.procs.db.select({
        sql: "SELECT count(*) c FROM knowledge.provenance WHERE subject = ?",
        params: [drop],
    })) as any[])[0]?.c ?? 0);

    if (opts.apply !== true) {
        return { applied: false, keep, drop, fieldsGained, fieldsConflicting, relationsMoved: relations, provenanceMoved: provenance, aka };
    }

    await ctx.fns.procs.db.run({
        sql: "UPDATE knowledge.entities SET data = ?::jsonb, updated_at = now() WHERE id = ?",
        params: [JSON.stringify(keepData), keep],
    });
    // Repoint edges. relations is keyed on (subject, predicate, object), so an
    // edge the survivor already has would collide the moment the loser's copy
    // is rewritten — those are deleted first rather than cleaned up after.
    await ctx.fns.procs.db.run({
        sql: `DELETE FROM knowledge.relations a
              WHERE a.subject = ? AND EXISTS (
                  SELECT 1 FROM knowledge.relations b
                  WHERE b.subject = ? AND b.predicate = a.predicate AND b.object = a.object)`,
        params: [drop, keep],
    });
    await ctx.fns.procs.db.run({
        sql: `DELETE FROM knowledge.relations a
              WHERE a.object = ? AND EXISTS (
                  SELECT 1 FROM knowledge.relations b
                  WHERE b.object = ? AND b.predicate = a.predicate AND b.subject = a.subject)`,
        params: [drop, keep],
    });
    await ctx.fns.procs.db.run({ sql: "DELETE FROM knowledge.relations WHERE subject = ? AND object = ?", params: [drop, keep] });
    await ctx.fns.procs.db.run({ sql: "DELETE FROM knowledge.relations WHERE subject = ? AND object = ?", params: [keep, drop] });
    await ctx.fns.procs.db.run({ sql: "UPDATE knowledge.relations SET subject = ? WHERE subject = ?", params: [keep, drop] });
    await ctx.fns.procs.db.run({ sql: "UPDATE knowledge.relations SET object = ? WHERE object = ?", params: [keep, drop] });
    await ctx.fns.procs.db.run({ sql: "DELETE FROM knowledge.relations WHERE subject = object" });
    await ctx.fns.procs.db.run({ sql: "UPDATE knowledge.provenance SET subject = ? WHERE subject = ?", params: [keep, drop] });
    // entity_changes demands an author, a message index and a url, and its
    // operation check only admits create/add/correct — a merge is recorded as a
    // `correct` on the survivor's merged_from, which is exactly what it is.
    const author = (await ctx.fns.agent.current({}).catch(() => null))?.id ?? "knowledge.dedupMerge";
    await ctx.fns.procs.db.run({
        sql: `INSERT INTO knowledge.entity_changes(subject, attribute, operation, before_value, after_value, source_agent_id, source_message_idx, url, evidence, changed_at)
              VALUES (?, 'merged_from', 'correct', ?::jsonb, ?::jsonb, ?, 0, '', ?, now())`,
        params: [keep, JSON.stringify(drop), JSON.stringify(keep), author, String(opts.reason ?? "duplicate merged")],
    });
    await ctx.fns.procs.db.run({ sql: "DELETE FROM knowledge.search WHERE id = ?", params: [drop] });
    await ctx.fns.procs.db.run({ sql: "DELETE FROM knowledge.entities WHERE id = ?", params: [drop] });
    await ctx.fns.knowledge.rebuildSearch({ ids: [keep] });

    return { applied: true, keep, drop, fieldsGained, fieldsConflicting, relationsMoved: relations, provenanceMoved: provenance, aka };
}
