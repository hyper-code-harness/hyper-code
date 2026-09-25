// Answers "what is X's telegram?" in one call instead of two.
//
// knowledge.find returns an id, a title and a snippet; the contact details a
// question like this actually wants live in the entity record, so the caller
// has to know to fetch it separately. Worse, the request names the field in
// natural language — "рабочий email", "её гитхаб", "телефончик" — and mapping
// that onto a JSON key is not something a full-text index can do.
//
// The request therefore carries two different things and they are handled in
// two different passes. FIRST the entity: the words that name a person are
// separated from the words that name a property, and only the former go into
// the full-text query — otherwise "email" matches every colleague who has one
// and outranks the person actually being asked about. THEN the property: the
// field is picked by a typed decision over the CLOSED set of keys the matched
// entities really carry, so the answer is always a key that exists, never an
// invented one. An explicit "no particular field" option lets the model
// decline, in which case this behaves like a search that also returns contacts.

/** Finds an entity by name and returns the specific contact field the question asks for. */
/**
 * Look up one entity and the field a natural-language question is asking about.
 *
 * Use for requests like "telegram id mary ryzhikova", "рабочий email маши" or
 * "её гитхаб", where a plain search would return a card and leave the caller to
 * dig out the value. The entity is located by full-text search, and the wanted
 * field is chosen by a typed decision over the keys those entities really have,
 * so the answer is always a value that exists rather than a guessed key.
 *
 * When no single field is being asked for, `field` comes back null and the full
 * contact block is returned instead.
 *
 * @param opts.query The request in the user's own words, name included.
 * @param opts.field Skip field detection and return this key.
 * @param opts.type Restrict the search to one entity type.
 * @param opts.limit How many matching entities to return.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Natural-language request naming the entity and, optionally, the wanted field. */
    query: string;
    /** Explicit field key; skips detection. */
    field?: string;
    /** Entity type filter, such as Person. */
    type?: string;
    /** Maximum entities returned. @default 3 @minimum 1 @maximum 20 */
    limit?: number;
}): Promise<{
    query: string;
    field: string | null;
    confidence: number | null;
    results: Array<{ id: string; title: string; value: string | null; contacts: Record<string, string> }>;
}> {
    await ctx.fns.knowledge.ensure({});
    const limit = Math.min(20, Math.max(1, opts.limit ?? 3));
    // Pass one: find the entity. Property words are removed from the query
    // first, because BM25 cannot tell that "email" describes what is wanted
    // rather than who is wanted.
    const nameTerms = await entityTerms(ctx, opts.query);
    const hits = await searchAnyTerm(ctx, nameTerms, opts.type, limit);
    if (!hits.length) return { query: opts.query, field: opts.field ?? null, confidence: null, results: [] };

    const ids = hits.map((hit: any) => String(hit.id));
    const rows: any[] = await ctx.fns.procs.db.select({
        sql: `SELECT id, data FROM knowledge.entities WHERE id IN (${ids.map(() => "?").join(",")})`,
        params: ids,
    });
    const byId = new Map<string, any>(rows.map((row) => [String(row.id), row.data ?? {}]));

    // Options are the keys these entities actually hold, so a chosen field can
    // always be answered. Bulk and structural keys are not what anyone asks for.
    const SKIP = new Set(["base_type", "avatar", "bio_src", "merged_from", "distinct_from", "aka", "crme", "samurai", "type", "linked", "campaigns", "description", "body", "notes"]);
    const available = new Set<string>();
    for (const data of byId.values()) {
        for (const key of Object.keys(data)) {
            if (SKIP.has(key)) continue;
            const value = data[key];
            if (value == null || value === "" || typeof value === "object" && !Array.isArray(value)) continue;
            available.add(key);
        }
    }

    let field = opts.field ?? null;
    let confidence: number | null = null;
    if (!field && available.size) {
        const NONE = "__none__";
        const criteria: Record<string, any> = { [NONE]: "The request does not ask for one particular field; it is a general lookup about the entity" };
        for (const key of [...available].sort()) criteria[key] = null;
        try {
            const decision = await ctx.fns.jev.decide({
                state: { task: "Which single field of this record does the request ask for?", request: opts.query },
                questions: { field: { type: "choice", instructions: "Pick the field the request is asking for, or none when it asks about the entity in general.", criteria } },
            });
            const answer = decision.answers.field;
            if (answer && answer.type === "choice") {
                confidence = answer.confidence;
                if (answer.choice !== NONE) field = answer.choice;
            }
        } catch (error: any) {
            // Field detection is a convenience; without it this is still a
            // search that returns the contact block.
            ctx.fns.procs.log.warn({ event: "knowledge.lookup.field-failed", msg: String(error?.message ?? error) });
        }
    }

    const CONTACT = ["telegram", "email", "work_email", "personal_email", "phone", "github", "linkedin", "website"];
    const results = hits.map((hit: any) => {
        const data = byId.get(String(hit.id)) ?? {};
        const contacts: Record<string, string> = {};
        for (const key of CONTACT) {
            const value = data[key];
            if (value != null && value !== "") contacts[key] = render(value);
        }
        return {
            id: String(hit.id),
            title: String(hit.title ?? data.title ?? data.name ?? ""),
            value: field && data[field] != null && data[field] !== "" ? render(data[field]) : null,
            contacts,
        };
    });

    return { query: opts.query, field, confidence, results };
}

function render(value: any): string {
    return Array.isArray(value) ? value.map((item) => String(item)).join(", ") : String(value);
}

// Splits a request into the words that name the entity and the words that name
// a property. Asking the decision model per word costs one round trip and
// beats a keyword blacklist, which would have to enumerate every property name
// in every language the user might type. If the split fails or removes
// everything, the original terms are used — a noisy query beats no query.
async function entityTerms(ctx: Context, query: string): Promise<string[]> {
    const terms = tokenize(query);
    if (terms.length < 2) return terms;
    try {
        const questions: Record<string, types.jev.Question> = {};
        terms.forEach((term, index) => {
            questions[`t${index}`] = {
                type: "noul",
                instructions: { question: "Is this word part of the NAME of the entity being looked up?", word: term, request: query },
                criteria: {
                    true: "Part of a person, organization or product name",
                    false: "The name of a property such as email or phone, a verb, or a filler word",
                },
            };
        });
        const out = await ctx.fns.jev.decide({ state: "Separating the entity name from the requested property in a knowledge-base lookup.", questions });
        const kept = terms.filter((_, index) => {
            const answer = out.answers[`t${index}`];
            return answer && answer.type === "noul" ? answer.noul >= 0.5 : true;
        });
        return kept.length ? kept : terms;
    } catch (error: any) {
        ctx.fns.procs.log.warn({ event: "knowledge.lookup.split-failed", msg: String(error?.message ?? error) });
        return terms;
    }
}

function tokenize(query: string): string[] {
    return String(query ?? "").toLowerCase()
        .split(/[^\p{L}\p{N}@._-]+/u)
        .filter((term) => term.length > 2)
        .map((term) => term.replace(/['&|!():*]/g, ""))
        .filter(Boolean);
}

// Full-text ranking over an OR of the entity terms, re-scored by how well each
// record's names match: a name hit identifies the subject, everything else is
// context. The alias counts as much as the title — somebody searching for
// "Mary Ryzhikova" means the record titled "Mary Anfilofieva".
async function searchAnyTerm(
    ctx: Context,
    terms: string[],
    type: string | undefined,
    limit: number,
): Promise<Array<{ id: string; title: string | null }>> {
    if (!terms.length) return [];
    const tsquery = terms.join(" | ");
    const rows: any[] = await ctx.fns.procs.db.select({
        sql: `SELECT s.id, s.title, e.data, ts_rank_cd(s.search_vector, to_tsquery('simple', ?))::float8 score
                FROM knowledge.search s JOIN knowledge.entities e ON e.id = s.id
               WHERE s.search_vector @@ to_tsquery('simple', ?) ${type ? "AND s.type = ?" : ""}
               ORDER BY score DESC, s.title NULLS LAST LIMIT ?`,
        params: type ? [tsquery, tsquery, type, limit * 8] : [tsquery, tsquery, limit * 8],
    });
    return rows
        .map((row) => {
            const names = [String(row.title ?? ""), ...aliases(row.data)].join(" ").toLowerCase();
            const inName = terms.filter((term) => names.includes(term)).length;
            return { id: String(row.id), title: row.title ?? null, rank: inName * 100 + Number(row.score) };
        })
        .sort((a, b) => b.rank - a.rank)
        .slice(0, limit)
        .map(({ id, title }) => ({ id, title }));
}

function aliases(data: any): string[] {
    const value = data?.aka;
    if (value == null) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => String(item));
}
