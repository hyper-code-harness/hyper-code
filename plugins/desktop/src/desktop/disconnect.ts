/**
 * Closes the persistent Cua Driver connection to one host or to all hosts.
 *
 * Use after changing Cua Driver permissions or versions, when a remote SSH link hangs, or to release resources when desktop work is finished; the next desktop call reconnects automatically.
 * @param opts.host Host alias to disconnect (local for this machine); omit to close every connection.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Host alias to disconnect (local for this machine); omit to close every connection. */
        host?: string;
    },
): Promise<{ closed: string[] }> {
    const pool: Map<string, { proc: { kill: () => void } }> = (globalThis as any).__desktopCuaPool ?? new Map();
    const closed: string[] = [];
    for (const [h, c] of [...pool]) {
        if (opts.host && h !== opts.host) continue;
        try { c.proc.kill(); } catch {}
        pool.delete(h); closed.push(h);
    }
    return { closed };
}
