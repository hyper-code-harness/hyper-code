/** Generates multilingual retrieval text through provider-neutral `llm.call`. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Function or plugin records with stable names and canonical retrieval text. */
        functions: Array<{ name: string; text: string }>;
        /** BCP-47-like target locale codes. */
        locales: string[];
        /** Provider-qualified model override; empty uses llm.defaultModel. */
        model?: string;
    },
): Promise<{ provider: string; model: string; localized: Record<string, string>; failed: string[] }> {
    const model = String(opts.model ?? "").trim() || await ctx.fns.settings.modelDefault({});
    if (!opts.functions.length || !opts.locales.length) return { provider: model.split(":")[0] ?? "default", model, localized: {}, failed: [] };
    const localized: Record<string, string> = {};
    const failed: string[] = [];
    for (let offset = 0; offset < opts.functions.length; offset += 5) {
        const group = opts.functions.slice(offset, offset + 5);
        const settled = await Promise.allSettled(group.map(item => retryLocalize(ctx, model, opts.locales, item)));
        for (const row of settled) {
            if (row.status === "fulfilled") localized[row.value.name] = row.value.text;
            else failed.push(group[settled.indexOf(row)]!.name);
        }
    }
    return { provider: model.split(":")[0] ?? "default", model, localized, failed };
}

async function retryLocalize(ctx: Context, model: string, locales: string[], item: { name: string; text: string }): Promise<{ name: string; text: string }> {
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        try { return await localizeOne(ctx, model, locales, item); }
        catch (error) { last = error; }
    }
    throw last;
}


async function localizeOne(ctx: Context, model: string, locales: string[], item: { name: string; text: string }): Promise<{ name: string; text: string }> {
    const schema = {
        type: "object", additionalProperties: false, required: ["name", "text"],
        properties: { name: { type: "string" }, text: { type: "string" } },
    };
    const call = await ctx.fns.llm.call({
        model,
        temperature: 0,
        max_tokens: 3000,
        response_format: { type: "json_schema", json_schema: { name: "localized_retrieval_text", strict: true, schema } },
        system: "Return one JSON object with exactly two keys: name and text. Create multilingual retrieval text for one runtime capability. Preserve the exact name. The text value must exceed 120 characters. For every requested locale write a precise capability description, synonyms, grammatical forms, colloquial wording, and 8 natural user requests this exact capability can satisfy. Include broad intent and parameter-specific requests. Name the general subject area the capability belongs to using the plain everyday word for it, not only the vendor or product name, because people ask by subject: mail for a Gmail capability, calendar for a scheduling one, chat or messages for a messenger one. Describe only the source capability; never invent adjacent behavior. Do not use markdown fences.",
        user: JSON.stringify({ locales, capability: { name: item.name, source: item.text.slice(0, 6000) } }),
        sessionId: `localize-${Bun.hash(item.name).toString(16)}`,
    });
    let body: any;
    try { body = JSON.parse(stripFence(call.text)); } catch { throw new Error(`localization returned invalid JSON for ${item.name}`); }
    const name = String(body?.name ?? "");
    const text = String(body?.text ?? body?.source ?? body?.retrieval_text ?? "").trim();
    if (name !== item.name || text.length < 120 || text === "[object Object]") throw new Error(`localization returned invalid content for ${item.name}`);
    return { name, text: text.slice(0, 8000) };
}

function stripFence(text: string): string {
    const trimmed = String(text ?? "").trim();
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}
