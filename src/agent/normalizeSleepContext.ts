/** Normalize sleep context for the runtime.  * @param opts.sleepContext Persisted sleep context.
*/
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Sleep context used by the operation. */
    sleepContext: any },
): { mode: "full" | "compact"; activeRevision: number | null; draftRevision: number | null; draftOwner?: string | null; generations: any[] } | null {
    const sleep = opts.sleepContext;
    if (!sleep || typeof sleep !== "object") return null;
    if (Array.isArray(sleep.generations)) {
        const generations = sleep.generations.filter((x: any) => x && Number.isFinite(Number(x.revision)));
        return {
            mode: sleep.mode === "compact" ? "compact" : "full",
            activeRevision: sleep.activeRevision == null ? null : Number(sleep.activeRevision),
            draftRevision: sleep.draftRevision == null ? null : Number(sleep.draftRevision),
            draftOwner: sleep.draftOwner == null ? null : String(sleep.draftOwner),
            generations,
        };
    }
    const generation = { ...sleep };
    delete generation.active;
    return {
        mode: sleep.active === true ? "compact" : "full",
        activeRevision: sleep.active === true ? Number(sleep.revision ?? 1) : null,
        draftRevision: sleep.active === true ? null : Number(sleep.revision ?? 1),
        draftOwner: null,
        generations: [generation],
    };
}
