/** Synchronizes live runtime function metadata into the Postgres search index. */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Maximum functions localized in this invocation. @default 25 */
        localizationBatch?: number;
        /** Rebuild localization and embeddings even when cache identities match. */
        force?: boolean;
        /** Generate missing localized retrieval text. Disable for cheap reload-time reindexing. @default true */
        localize?: boolean;
    } = {},
): Promise<{ indexed: number; localized: number; pendingLocalization: number; embedded: number; deleted: number; provider: string; failed?: string }> {
    const state = ((ctx.state as any).runtimeDocsIndex ??= {});
    // A cheap `localize:false` pass must not satisfy a caller that wants the
    // expensive localization, so the in-flight guard is keyed by that flag.
    const key = opts.localize === false ? "runningPlain" : "running";
    if (state[key]) return state[key];
    const running = runIndex(ctx, session, opts).finally(() => { if (state[key] === running) delete state[key]; });
    state[key] = running;
    return running;
}

async function runIndex(
    ctx: Context,
    _session: Session | null,
    opts: {
        localizationBatch?: number;
        force?: boolean;
        localize?: boolean;
    } = {},
): Promise<{ indexed: number; localized: number; pendingLocalization: number; embedded: number; deleted: number; provider: string; failed?: string }> {
    const docs = ctx.fns.runtime.docs.list({}).map((item: any) => ctx.fns.runtime.docs.get({ name: item.name }));
    const names = docs.map((doc: any) => doc.name);
    let deleted = 0;
    if (names.length) {
        const placeholders = names.map(() => "?").join(",");
        deleted = (await ctx.fns.procs.db.run({ sql: `DELETE FROM functions WHERE name NOT IN (${placeholders})`, params: names })).changes;
    }
    const existing = await ctx.fns.procs.db.select({
        sql: `SELECT name, content_hash, localized_text, localization_hash, localization_provider, localization_model,
                     localization_locales, embedding IS NOT NULL AS embedded, embedding_provider, embedding_model,
                     namespace, opts_type, return_type, rel, line, tags FROM functions`, params: [],
    });
    const previous = new Map(existing.map((row: any) => [row.name, row]));
    const provider = await ctx.fns.embeddings.provider({});
    const model = provider === "off" ? null : await ctx.fns.settings.getString({ module: "embeddings", scopeType: "global", key: "model", fallback: "text-embedding-3-large" });
    const localizationModel = await ctx.fns.llm.localizationModel({});
    const locales = parseLocales(await ctx.fns.settings.getString({ module: "embeddings", scopeType: "global", key: "locales", fallback: "" }));
    const localesKey = locales.join(",");
    const canonical: Array<{ doc: any; namespace: string; text: string; hash: string }> = docs.map((doc: any) => {
        const namespace = doc.name.split(".").slice(0, -1).join(".");
        const text = [doc.name, splitName(doc.name), doc.summary, doc.doc, doc.signature, JSON.stringify(doc.paramsSchema ?? {})].filter(Boolean).join("\n").slice(0, 30_000);
        return { doc, namespace, text, hash: Bun.hash(text).toString(16) };
    });
    // No locales (the default) = translation off: nothing is pending, nothing is sent to an LLM.
    const localizationTodo = !locales.length ? [] : canonical.filter(item => {
        const old: any = previous.get(item.doc.name);
        const wanted = localizationIdentity(item.hash, localizationModel, localesKey);
        return opts.force || old?.localization_hash !== wanted || !validLocalizedText(old?.localized_text);
    });
    const localizationBatch = localizationTodo.slice(0, Math.max(1, Math.min(100, Number(opts.localizationBatch ?? 25))));
    let localized = 0;
    const generated = new Map<string, string>();
    const localizationFailed = new Set<string>();
    if (opts.localize !== false && locales.length && localizationBatch.length) {
        try {
            const result = await ctx.fns.llm.localize({ functions: localizationBatch.map(item => ({ name: item.doc.name, text: item.text })), locales, model: localizationModel });
            for (const [name, text] of Object.entries(result.localized)) generated.set(name, text);
            for (const name of result.failed ?? []) localizationFailed.add(name);
            localized = generated.size;
        } catch (error: any) {
            return { indexed: 0, localized: 0, pendingLocalization: localizationTodo.length, embedded: 0, deleted, provider, failed: String(error?.message ?? error) };
        }
    }
    const changed: Array<{ name: string; text: string; hash: string }> = [];
    const rows: any[] = [];
    const now = Date.now();
    for (const item of canonical) {
        const { doc, namespace, hash } = item;
        const old: any = previous.get(doc.name);
        const oldLocalized = validLocalizedText(old?.localized_text) ? String(old.localized_text) : "";
        const generatedText = generated.get(doc.name);
        const localizedText = generatedText ?? oldLocalized;
        const localizedIsCurrent = Boolean(generatedText) || (!localizationFailed.has(doc.name) && old?.localization_hash === localizationIdentity(hash, localizationModel, localesKey));
        const searchText = [item.text, localizedText].filter(Boolean).join("\n").slice(0, 38_000);
        const localizationHash = localizedIsCurrent && localizedText ? localizationIdentity(hash, localizationModel, localesKey) : null;
        const retrievalHash = Bun.hash(searchText).toString(16);
        const row = { name: doc.name, namespace, summary: doc.summary ?? "", doc: doc.doc ?? "", signature: doc.signature ?? "", opts_type: doc.optsType ?? "",
            return_type: doc.returnType ?? "", params_schema: doc.paramsSchema ?? {}, rel: doc.rel ?? "", line: doc.line ?? null, search_text: searchText,
            content_hash: retrievalHash, localized_text: localizedText, localization_provider: localizedText ? localizationModel.split(":")[0] : null,
            localization_model: localizedText ? localizationModel : null, localization_locales: localizedText ? localesKey : null,
            localization_hash: localizationHash, tags: canonicalTags(doc.tags), updated_at: now };
        // content_hash covers name, summary, doc, signature, params schema and localized text; the rest is
        // compared field by field. An unchanged row is not rewritten: no write, no BM25 reindex of 1300+ rows.
        if (opts.force || !unchanged(old, row)) rows.push(row);
        if (opts.force || old?.content_hash !== retrievalHash || !old?.embedded || old?.embedding_provider !== provider || old?.embedding_model !== model) changed.push({ name: doc.name, text: searchText, hash: retrievalHash });
    }
    // One statement per 500 functions instead of one round trip each (1400+ functions: ~0.7s → ~0.1s).
    for (let offset = 0; offset < rows.length; offset += 500) {
        await ctx.fns.procs.db.run({
            sql: `INSERT INTO functions (name, namespace, summary, doc, signature, opts_type, return_type, params_schema, rel, line,
                        search_text, content_hash, localized_text, localization_provider, localization_model, localization_locales, localization_hash, tags, updated_at)
                  SELECT name, namespace, summary, doc, signature, opts_type, return_type, params_schema, rel, line,
                        search_text, content_hash, localized_text, localization_provider, localization_model, localization_locales, localization_hash, tags, updated_at
                  FROM jsonb_to_recordset(?::jsonb) AS r(name text, namespace text, summary text, doc text, signature text, opts_type text, return_type text,
                        params_schema jsonb, rel text, line int, search_text text, content_hash text, localized_text text, localization_provider text,
                        localization_model text, localization_locales text, localization_hash text, tags jsonb, updated_at bigint)
                  ON CONFLICT (name) DO UPDATE SET namespace=excluded.namespace, summary=excluded.summary, doc=excluded.doc,
                    signature=excluded.signature, opts_type=excluded.opts_type, return_type=excluded.return_type,
                    params_schema=excluded.params_schema, rel=excluded.rel, line=excluded.line, search_text=excluded.search_text,
                    content_hash=excluded.content_hash, localized_text=excluded.localized_text,
                    localization_provider=excluded.localization_provider, localization_model=excluded.localization_model,
                    localization_locales=excluded.localization_locales, localization_hash=excluded.localization_hash, tags=excluded.tags, updated_at=excluded.updated_at,
                    embedding=CASE WHEN functions.content_hash = excluded.content_hash THEN functions.embedding ELSE NULL END,
                    embedding_provider=CASE WHEN functions.content_hash = excluded.content_hash THEN functions.embedding_provider ELSE NULL END,
                    embedding_model=CASE WHEN functions.content_hash = excluded.content_hash THEN functions.embedding_model ELSE NULL END`,
            params: [JSON.stringify(rows.slice(offset, offset + 500))],
        });
    }
    if (provider === "off" || !changed.length) return { indexed: docs.length, localized, pendingLocalization: Math.max(0, localizationTodo.length - localized), embedded: 0, deleted, provider };
    let embedded = 0;
    try {
        for (let offset = 0; offset < changed.length; offset += 64) {
            const batch = changed.slice(offset, offset + 64);
            const result = await ctx.fns.embeddings.embed({ input: batch.map(item => item.text), model: model ?? undefined });
            for (let i = 0; i < batch.length; i++) {
                const vector = result.vectors[i];
                if (!vector) continue;
                await ctx.fns.procs.db.run({ sql: "UPDATE functions SET embedding=?::public.halfvec, embedding_provider=?, embedding_model=? WHERE name=? AND content_hash=?", params: [JSON.stringify(vector), result.provider, result.model, batch[i]!.name, batch[i]!.hash] });
                embedded++;
            }
        }
        return { indexed: docs.length, localized, pendingLocalization: Math.max(0, localizationTodo.length - localized), embedded, deleted, provider };
    } catch (error: any) {
        return { indexed: docs.length, localized, pendingLocalization: Math.max(0, localizationTodo.length - localized), embedded, deleted, provider, failed: String(error?.message ?? error) };
    }
}

// Every stored column except search_text/summary/doc/signature/params_schema (all inside content_hash), tags (compared
// separately in unchanged) and updated_at.
const COMPARED = ["content_hash", "namespace", "opts_type", "return_type", "rel", "line", "localized_text", "localization_provider", "localization_model", "localization_locales", "localization_hash"] as const;
function unchanged(old: any, row: Record<string, any>): boolean {
    // Tags are jsonb: compared as their canonical JSON text (sorted names, sorted unique values), not by identity.
    return !!old && COMPARED.every(key => (old[key] ?? null) === (row[key] ?? null)) && tagsKey(old.tags) === tagsKey(row.tags);
}
// `{ live: ["memory"], view: [] }` in one order whatever the source order, so an unchanged function compares equal.
function canonicalTags(tags: any): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const name of Object.keys(tags ?? {}).sort()) out[name] = [...new Set((Array.isArray(tags[name]) ? tags[name] : []).map(String))].sort();
    return out;
}
function tagsKey(tags: any): string { return JSON.stringify(canonicalTags(typeof tags === "string" ? JSON.parse(tags) : tags)); }
function splitName(name: string): string { return name.replaceAll(".", " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase(); }
function parseLocales(value: string | undefined): string[] { return [...new Set(String(value ?? "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean))]; }
function localizationIdentity(contentHash: string, model: string, locales: string): string { return Bun.hash(`${contentHash}|openai|v7|${model}|${locales}`).toString(16); }
function validLocalizedText(value: any): boolean {
    const text = String(value ?? "").trim();
    return text.length >= 120 && text !== "[object Object]" && !/requests:\s*$/i.test(text);
}
