/**
 * Lists the Hyper instances (and other services) registered in the Hyper Control Plane.
 *
 * Service discovery: name, URL, owner, description, metadata and last heartbeat for each service.
 * Returns an empty list when this Hyper is not connected to a control plane or it is unreachable.
 * @param opts.kind Only services of this kind, e.g. hyper.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Only services of this kind, e.g. hyper. */
        kind?: string;
    },
): Promise<Array<{ id: string; name: string; kind: string; url: string; ownerEmail: string | null; description: string; metadata: Record<string, unknown>; lastSeenAt: number | null }>> {
    const cfg = await ctx.fns.auth.oidcConfig({});
    const token = cfg ? await ctx.fns.controlPlane.token({}) : null;
    if (!cfg || !token) return [];
    const url = new URL(`${cfg.issuer}/services`);
    if (opts?.kind) url.searchParams.set("kind", opts.kind);
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    if (!res?.ok) return [];
    const body: any = await res.json();
    return Array.isArray(body.services) ? body.services : [];
}
