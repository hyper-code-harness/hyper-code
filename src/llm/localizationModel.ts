/** Returns the model used for background retrieval-text localization. */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<string> {
    const configured = await ctx.fns.settings.getString({
        module: "llm", scopeType: "global", key: "localizationModel",
        fallback: ctx.env.LOCALIZATION_MODEL ?? "google/gemma-4-31b",
    });
    return String(configured ?? "").trim() || await ctx.fns.settings.modelDefault({});
}
