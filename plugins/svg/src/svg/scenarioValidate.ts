/**
 * Compatibility entry point for diagrams.scenarioValidate. Prefer ctx.fns.diagrams.scenarioValidate for new diagrams.
 * Requires the official diagrams plugin; retained for existing SVG TSX fences.
 *
 * Validate typed scenario actors, messages, actions and nested phases before rendering
 *
 * Use before storing or rendering small JSON interaction models. Throws on unsupported fields or step types (including check and stop), invalid XML text, duplicate global IDs, missing actors, cycles, more than 30 actors or 200 total steps, or more than eight phase levels. Empty scenarios, labels and phases are accepted. Does not execute actions or verify protocol semantics. Input is not mutated.
 * @param opts.model Strict JSON scenario with ordered actors and discriminated steps; IDs up to 128 characters and labels/titles up to 300 characters.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Strict JSON scenario with ordered actors and discriminated steps; IDs up to 128 characters and labels/titles up to 300 characters. */
        model: types.svg.Scenario;
    },
): Promise<{ valid: true; actors: number; steps: number; phases: number; messages: number; actions: number }> {
    return await ctx.fns.diagrams.scenarioValidate({...opts});
}
