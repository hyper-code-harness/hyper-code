// Cheap candidate generation for entity deduplication.
//
// Comparing every pair is 1.9M comparisons for Person alone, so pairs are
// produced by BLOCKING: several narrow SQL passes that each catch one shape of
// duplicate, unioned and deduplicated afterwards. Each pass records why it
// fired, because the evidence — not the pair — is what a later decision step
// reasons about.
//
// This function deliberately decides nothing. A shared LinkedIn URL is strong
// evidence and a shared surname is weak evidence, but "Mohammed Ali the boxer"
// and "Mohammed Ali the cardiologist" block together and are not the same
// person. Judgement belongs to whoever consumes this queue.

/** Finds likely duplicate entity pairs in the knowledge graph through identifier, name and context blocking. */
/**
 * Produce scored duplicate-candidate pairs for one entity type without merging
 * or modifying anything.
 *
 * Use before any deduplication pass, to see how large the problem is, or to
 * feed a review queue. Five independent blocking strategies run in SQL:
 * a shared contact identifier, an identical normalized name, a small edit
 * distance, the same surname with the same first initial, and the same surname
 * within the same organization. The last two are person-name heuristics and are
 * off by default for other entity types.
 *
 * Every pair carries the strategies that produced it and a coarse strength, so
 * a caller can auto-merge only on identifier evidence and route the rest to a
 * human or a decision model. Similarity is retrieval, never equivalence.
 *
 * @param opts.type Entity type to scan, such as Person or Organization.
 * @param opts.strategies Blocking passes to run; omit for a type-appropriate default.
 * @param opts.maxDistance Largest accepted Levenshtein distance between names.
 * @param opts.limit Maximum pairs returned.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Entity type to scan. @default Person */
    type?: string;
    /** Blocking passes to run; omit for a type-appropriate default set. */
    strategies?: Array<"identifier" | "exactName" | "editDistance" | "surnameInitial" | "surnameOrg">;
    /** Largest Levenshtein distance between names counted as a candidate. @default 2 @minimum 1 @maximum 5 */
    maxDistance?: number;
    /** Maximum candidate pairs returned. @default 200 @minimum 1 @maximum 2000 */
    limit?: number;
}): Promise<{
    type: string;
    scanned: number;
    pairs: Array<{
        left: string;
        right: string;
        leftName: string;
        rightName: string;
        strategies: string[];
        evidence: Record<string, string>;
        strength: "identifier" | "strong" | "weak";
    }>;
    byStrategy: Record<string, number>;
}> {
    await ctx.fns.knowledge.ensure({});
    const type = opts.type ?? "Person";
    const maxDistance = Math.min(5, Math.max(1, opts.maxDistance ?? 2));
    const limit = Math.min(2000, Math.max(1, opts.limit ?? 200));
    const run = new Set(opts.strategies ?? defaultStrategies(type));

    const scanned = Number(((await ctx.fns.procs.db.select({
        sql: "SELECT count(*) c FROM knowledge.entities WHERE type = ?",
        params: [type],
    })) as any[])[0]?.c ?? 0);

    // One normalized projection shared by every pass: accent-stripped,
    // lowercased display name plus the identifiers worth blocking on.
    // `unaccent` is not installed, so the fold is done with translate(), which
    // is enough to make "Jürgen" and "Jurgen" block together.
    const base = `
        WITH p AS (
            SELECT id,
                   coalesce(data->>'title', data->>'name') AS raw,
                   lower(translate(coalesce(data->>'title', data->>'name'),
                         'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÑñÇç',
                         'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc')) AS nm,
                   nullif(lower(trim(data->>'email')), '') AS email,
                   nullif(lower(trim(data->>'work_email')), '') AS work_email,
                   nullif(lower(trim(data->>'telegram')), '') AS telegram,
                   nullif(lower(trim(data->>'github')), '') AS github,
                   nullif(lower(trim(data->>'linkedin')), '') AS linkedin,
                   nullif(lower(trim(data->>'org')), '') AS org
            FROM knowledge.entities
            WHERE type = ? AND coalesce(data->>'title', data->>'name') IS NOT NULL
              AND length(coalesce(data->>'title', data->>'name')) > 2
        )`;

    const passes: Array<{ name: string; sql: string; params: any[] }> = [];

    if (run.has("identifier")) {
        // A shared contact handle is the only evidence strong enough to act on
        // unattended. Free-text values such as "back office" are excluded by
        // requiring something that looks like a handle or URL.
        passes.push({
            name: "identifier",
            sql: `${base}
                SELECT a.id l, b.id r, a.raw ln, b.raw rn,
                       CASE WHEN a.linkedin = b.linkedin THEN 'linkedin'
                            WHEN a.telegram = b.telegram THEN 'telegram'
                            WHEN a.github = b.github THEN 'github'
                            ELSE 'email' END AS field,
                       coalesce(a.linkedin, a.telegram, a.github, a.email, a.work_email) AS value
                FROM p a JOIN p b ON a.id < b.id
                WHERE (a.linkedin = b.linkedin AND a.linkedin LIKE 'http%')
                   OR (a.telegram = b.telegram AND a.telegram LIKE '@%')
                   OR (a.github = b.github)
                   OR (a.email = b.email)
                   OR (a.work_email = b.work_email)`,
            params: [type],
        });
    }

    if (run.has("exactName")) {
        passes.push({
            name: "exactName",
            sql: `${base}
                SELECT a.id l, b.id r, a.raw ln, b.raw rn, 'name' AS field, a.nm AS value
                FROM p a JOIN p b ON a.id < b.id
                WHERE a.nm = b.nm`,
            params: [type],
        });
    }

    if (run.has("editDistance")) {
        // The length guard keeps levenshtein from running on the full product.
        passes.push({
            name: "editDistance",
            sql: `${base}
                SELECT a.id l, b.id r, a.raw ln, b.raw rn, 'distance' AS field,
                       levenshtein(a.nm, b.nm)::text AS value
                FROM p a JOIN p b ON a.id < b.id
                WHERE abs(length(a.nm) - length(b.nm)) <= ?
                  AND levenshtein(a.nm, b.nm) BETWEEN 1 AND ?`,
            params: [type, maxDistance, maxDistance],
        });
    }

    if (run.has("surnameInitial")) {
        // Catches "Eugene Vestel" against "Gene Vestel", which no edit distance
        // on the full name reaches.
        passes.push({
            name: "surnameInitial",
            sql: `${base}
                SELECT a.id l, b.id r, a.raw ln, b.raw rn, 'surname' AS field,
                       split_part(a.nm, ' ', 2) AS value
                FROM p a JOIN p b ON a.id < b.id
                WHERE split_part(a.nm, ' ', 2) = split_part(b.nm, ' ', 2)
                  AND length(split_part(a.nm, ' ', 2)) > 2
                  AND left(a.nm, 1) = left(b.nm, 1)
                  AND a.nm <> b.nm`,
            params: [type],
        });
    }

    if (run.has("surnameOrg")) {
        passes.push({
            name: "surnameOrg",
            sql: `${base}
                SELECT a.id l, b.id r, a.raw ln, b.raw rn, 'org' AS field, a.org AS value
                FROM p a JOIN p b ON a.id < b.id
                WHERE a.org = b.org
                  AND split_part(a.nm, ' ', 2) = split_part(b.nm, ' ', 2)
                  AND length(split_part(a.nm, ' ', 2)) > 2
                  AND a.nm <> b.nm`,
            params: [type],
        });
    }

    const merged = new Map<string, {
        left: string; right: string; leftName: string; rightName: string;
        strategies: string[]; evidence: Record<string, string>;
    }>();
    const byStrategy: Record<string, number> = {};

    for (const pass of passes) {
        let rows: any[];
        try {
            rows = await ctx.fns.procs.db.select({ sql: pass.sql, params: pass.params });
        } catch (error: any) {
            // A missing fuzzystrmatch extension must not take the whole scan
            // down; the other passes still carry useful evidence.
            ctx.fns.procs.log.warn({ event: "knowledge.dedup-candidates.pass-failed", msg: `${pass.name}: ${String(error?.message ?? error)}` });
            continue;
        }
        byStrategy[pass.name] = rows.length;
        for (const row of rows) {
            const key = `${row.l}\u0000${row.r}`;
            const existing = merged.get(key);
            if (existing) {
                if (!existing.strategies.includes(pass.name)) existing.strategies.push(pass.name);
                existing.evidence[String(row.field)] = String(row.value ?? "");
                continue;
            }
            merged.set(key, {
                left: String(row.l), right: String(row.r),
                leftName: String(row.ln), rightName: String(row.rn),
                strategies: [pass.name],
                evidence: { [String(row.field)]: String(row.value ?? "") },
            });
        }
    }

    const pairs = [...merged.values()]
        .map((pair) => ({
            ...pair,
            strength: (pair.strategies.includes("identifier") ? "identifier"
                : pair.strategies.includes("exactName") || pair.strategies.length > 1 ? "strong"
                    : "weak") as "identifier" | "strong" | "weak",
        }))
        .sort((a, b) => rank(b.strength) - rank(a.strength) || b.strategies.length - a.strategies.length)
        .slice(0, limit);

    return { type, scanned, pairs, byStrategy };
}

function rank(strength: string): number {
    return strength === "identifier" ? 3 : strength === "strong" ? 2 : 1;
}

// `surnameInitial` and `surnameOrg` read the second word as a family name.
// That is a person-name heuristic: on organizations it pairs everything ending
// in "Health", and on concepts everything ending in "Manager". Running them by
// default outside Person would bury the real evidence in noise, so they must
// be asked for explicitly there.
function defaultStrategies(type: string): Array<"identifier" | "exactName" | "editDistance" | "surnameInitial" | "surnameOrg"> {
    return type === "Person"
        ? ["identifier", "exactName", "editDistance", "surnameInitial", "surnameOrg"]
        : ["identifier", "exactName", "editDistance"];
}
