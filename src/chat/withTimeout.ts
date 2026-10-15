/**
 * Runs one chat header part's render under a time budget; a throw or a timeout logs and returns null.
 *
 * The shared guard for badges, buttons and panel cards, so one slow or broken plugin only hides itself.
 * @param opts.id Part id, for the log line.
 * @param opts.run The render call.
 * @param opts.budgetMs Time it may take. @default 1500
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Part id, for the log line. */
        id: string;
        /** The render call. */
        run: () => unknown;
        /** Time it may take. @default 1500 */
        budgetMs?: number;
    },
): Promise<unknown> {
    const budget = Math.max(50, Number(opts.budgetMs ?? 1500) || 1500);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            Promise.resolve().then(opts.run),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${budget}ms`)), budget); }),
        ]);
    } catch (error: any) {
        ctx.fns.procs.log.warn({ event: "chat.part.failed", msg: `${opts.id}: ${String(error?.message ?? error)}` });
        return null;
    } finally {
        clearTimeout(timer);
    }
}
