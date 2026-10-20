/** Restrict SSH configuration and credential transport to owners or trusted internal execution. */
export default function (_ctx: Context, session: Session | null, _opts: {}): void {
    if (!session) return;
    if (session.user?.role === 'owner') return;
    if (!session.req && !session.user && (session.kind === 'agent' || session.kind === 'repl')) return;
    throw new Error('Only owners can use SSH CLI');
}
