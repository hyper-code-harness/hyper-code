/**
 * Returns the agent's workspace: directory, and the SSH host it lives on (empty = local).
 *
 * When host is set, dir is an absolute path on that host; tools without an
 * explicit host act there.
 */
export default function (
    _ctx: Context,
    session: Session | null,
    _opts?: {},
): { dir: string; host: string; agentId?: string } {
    return {
        dir: session?.agent?.workspaceDir ?? process.cwd(),
        host: session?.agent?.workspaceHost ?? "",
        agentId: session?.agent?.id,
    };
}
