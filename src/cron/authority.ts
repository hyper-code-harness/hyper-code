/**
 * Resolves a scoped cron service identity for the current invocation
 *
 * Use inside background delivery functions to obtain the durable owner grant. Ordinary sessions and unsupported scopes return null; identities exist only during a worker run.
 * @param opts.scope Required capability; only notification.enqueue is supported.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Required capability; only notification.enqueue is supported. */
        scope: string;
    },
): Promise<{ ownerId: string; runId: number; taskName: string; targetFn: string; transportActor: string; scopes: string[] } | null> {
    if (opts.scope !== "notification.enqueue" || !session) return null;
    const value = (ctx.state as any).cron?.notificationServices?.get(session);
    if (!value || !value.scopes.includes(opts.scope)) return null;
    return { ...value, scopes: [...value.scopes] };
}
