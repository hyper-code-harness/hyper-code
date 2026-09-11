/**
 * Synchronizes mounted plugin metadata and SKILL.md workflows into the durable
 * multilingual BM25/vector plugin index. Function docs remain in `functions`.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Maximum changed plugins localized now. @default 10 @minimum 1 @maximum 50 */
        localizationBatch?: number;
        /** Rebuild localization and embeddings even when content is unchanged. @default false */
        force?: boolean;
        /** Generate missing localized retrieval text. Disable for cheap reload-time reindexing. @default true */
        localize?: boolean;
    } = {},
): Promise<{ indexed: number; localized: number; embedded: number; deleted: number; provider: string; failed?: string }> {
    const state = ((ctx.state as any).pluginDocsIndex ??= {});
    // A cheap `localize:false` pass must not satisfy a caller that wants the
    // expensive localization, so the in-flight guard is keyed by that flag.
    const key = opts.localize === false ? "runningPlain" : "running";
    if (state[key]) return state[key];
    const running = runIndex(ctx, opts).finally(() => { if (state[key] === running) delete state[key]; });
    state[key] = running;
    return running;
}

async function runIndex(
    ctx: Context,
    opts: { localizationBatch?: number; force?: boolean; localize?: boolean },
): Promise<{ indexed: number; localized: number; embedded: number; deleted: number; provider: string; failed?: string }> {
    const mounted = (ctx.fns.procs.modules.list({}) as any[]).filter((module: any) => module.plugin);
    const canonical = await Promise.all(mounted.map(async plugin => {
        const skill = plugin.skill ? await Bun.file(plugin.skill).text().catch(() => "") : "";
        const text = [plugin.name, plugin.label, plugin.description, (plugin.namespaces ?? []).join(" "), skill].filter(Boolean).join("\n").slice(0, 30_000);
        return { plugin, skill, text, hash: Bun.hash(text).toString(16) };
    }));
    const names = canonical.map(item => item.plugin.name);
    let deleted = 0;
    if (names.length) {
        const placeholders = names.map(() => "?").join(",");
        deleted = (await ctx.fns.procs.db.run({ sql: `DELETE FROM plugin_docs WHERE name NOT IN (${placeholders})`, params: names })).changes;
    } else {
        deleted = (await ctx.fns.procs.db.run({ sql: "DELETE FROM plugin_docs", params: [] })).changes;
    }
    const existing = await ctx.fns.procs.db.select({ sql: "SELECT * FROM plugin_docs", params: [] });
    const previous = new Map(existing.map((row: any) => [row.name, row]));
    const provider = await ctx.fns.embeddings.provider({});
    const model = provider === "off" ? null : await ctx.fns.settings.getString({ module: "embeddings", scopeType: "global", key: "model", fallback: "text-embedding-3-large" });
    const localizationModel = await ctx.fns.llm.localizationModel({});
    const locales = [...new Set(String(await ctx.fns.settings.getString({ module: "embeddings", scopeType: "global", key: "locales", fallback: "ru" }) || "ru").split(",").map(x => x.trim()).filter(Boolean))];
    const localesKey = locales.join(",");
    const localizationIdentity = (hash: string) => Bun.hash(`${hash}|${localizationModel}|${localesKey}`).toString(16);
    const todo = canonical.filter(item => opts.force || previous.get(item.plugin.name)?.localization_hash !== localizationIdentity(item.hash) || !valid(previous.get(item.plugin.name)?.localized_text));
    const batch = todo.slice(0, Math.max(1, Math.min(50, Number(opts.localizationBatch ?? 10))));
    const generated = new Map<string, string>();
    const localizationFailed = new Set<string>();
    let failed: string | undefined;
    if (opts.localize !== false && locales.length && batch.length) {
        try {
            const localized = await ctx.fns.llm.localize({ functions: batch.map(item => ({ name: item.plugin.name, text: item.text })), locales, model: localizationModel });
            for (const [name, text] of Object.entries(localized.localized)) generated.set(name, text);
            for (const name of localized.failed ?? []) localizationFailed.add(name);
        } catch (error: any) {
            // Canonical English BM25 rows are still useful. Localization is a
            // cache enrichment and must not prevent plugin discovery/indexing.
            failed = String(error?.message ?? error);
        }
    }
    const changed: Array<{ name: string; text: string; hash: string }> = [];
    const now = Date.now();
    for (const item of canonical) {
        const plugin = item.plugin;
        const old: any = previous.get(plugin.name);
        const generatedText = generated.get(plugin.name);
        const oldLocalized = valid(old?.localized_text) ? String(old.localized_text) : "";
        const localizedText = generatedText ?? oldLocalized;
        const localizedIsCurrent = Boolean(generatedText) || (!localizationFailed.has(plugin.name) && old?.localization_hash === localizationIdentity(item.hash));
        const searchText = [item.text, localizedText].filter(Boolean).join("\n").slice(0, 38_000);
        const retrievalHash = Bun.hash(searchText).toString(16);
        await ctx.fns.procs.db.run({
            sql: `INSERT INTO plugin_docs (name,label,description,namespaces,skill_text,search_text,content_hash,localized_text,localization_provider,localization_model,localization_locales,localization_hash,updated_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT (name) DO UPDATE SET label=excluded.label,description=excluded.description,namespaces=excluded.namespaces,skill_text=excluded.skill_text,search_text=excluded.search_text,content_hash=excluded.content_hash,localized_text=excluded.localized_text,localization_provider=excluded.localization_provider,localization_model=excluded.localization_model,localization_locales=excluded.localization_locales,localization_hash=excluded.localization_hash,updated_at=excluded.updated_at`,
            params: [plugin.name, plugin.label ?? "", plugin.description ?? "", JSON.stringify(plugin.namespaces ?? []), item.skill, searchText, retrievalHash, localizedText, localizedText ? localizationModel.split(":")[0] : null, localizedText ? localizationModel : null, localizedText ? localesKey : null, localizedIsCurrent && localizedText ? localizationIdentity(item.hash) : null, now],
        });
        if (opts.force || old?.content_hash !== retrievalHash || !old?.embedding || old?.embedding_provider !== provider || old?.embedding_model !== model) changed.push({ name: plugin.name, text: searchText, hash: retrievalHash });
    }
    let embedded = 0;
    if (provider !== "off" && changed.length) {
        try {
            const result = await ctx.fns.embeddings.embed({ input: changed.map(item => item.text), model: model ?? undefined });
            for (let i = 0; i < changed.length; i++) if (result.vectors[i]) {
                await ctx.fns.procs.db.run({ sql: "UPDATE plugin_docs SET embedding=?::public.halfvec,embedding_provider=?,embedding_model=? WHERE name=? AND content_hash=?", params: [JSON.stringify(result.vectors[i]), result.provider, result.model, changed[i]!.name, changed[i]!.hash] });
                embedded++;
            }
        } catch (error: any) {
            return { indexed: canonical.length, localized: generated.size, embedded, deleted, provider, failed: String(error?.message ?? error) };
        }
    }
    return { indexed: canonical.length, localized: generated.size, embedded, deleted, provider, ...(failed ? { failed } : {}) };
}

function valid(value: unknown): boolean { return String(value ?? "").trim().length >= 120; }
