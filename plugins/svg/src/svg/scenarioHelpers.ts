/**
 * Compatibility entry point for diagrams.scenarioHelpers. Prefer ctx.fns.diagrams.scenarioHelpers for new diagrams.
 * Requires the official diagrams plugin; retained for existing SVG TSX fences.
 *
 * Create synchronous typed positional helpers for composing scenario actors and steps
 *
 * Await this factory once per scenario inside a trusted svg tsx fence, then destructure actor, request, reply, send, redirect, action and phase. Call reusable Step[] functions repeatedly without ID prefixes. All step helpers share a factory-local counter generating step-1, step-2, etc.; identical construction order produces identical IDs, but changing call order changes them. An optional final { id } reserves a stable ID; duplicate allocated IDs throw and generated IDs skip reservations. Separate factories have independent ID scopes: do not assume their steps can be merged without collisions. Actor handles become string IDs; phases copy their array. No execution or automatic actor registration occurs. scenarioValidate/scenarioDiagram remain authoritative for root/actor collisions, references, ID syntax and limits. Function-valued results are for in-process use, not HTTP JSON transport.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<types.svg.ScenarioConstructors> {
    return await ctx.fns.diagrams.scenarioHelpers({});
}
