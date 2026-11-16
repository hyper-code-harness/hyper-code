/**
 * Says where this Hyper publishes its own plugins inside its private network: the git server, the owner its repositories go under and the shared listing — asked from the server, not typed by the author
 *
 * Use before publishing without an address (plugins.publish({ name }) does) and to show a person or an agent whether
 * "share in the network" is available here. It reads the plugins.home setting (the server address, optionally an
 * owner and a listing) and asks that server who this Hyper is (GET /api/whoami of a hyper-git server): a Hyper the
 * network knows as a server gets its own team as the owner; a Hyper that reaches the server as a person (several
 * Hypers of one machine look like one person) must have `owner` in the setting, and what it publishes is marked
 * with the person as `publishedBy`. Nothing here grants anything: the server checks every create and push again.
 * `ready` is true when a repository address can be formed; `problems` says what is missing in plain words.
 * `offline: true` only reads the setting — for a page render that must not wait for the network.
 * @param opts.offline Only read the setting; do not ask the server. @default false
 * @param opts.fresh Ask the server again instead of using the answer of the last few minutes. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Only read the setting; do not ask the server. @default false */
    offline?: boolean;
    /** Ask the server again instead of using the answer of the last few minutes. @default false */
    fresh?: boolean;
}): Promise<{
    /** plugins.home is set. */
    configured: boolean;
    /** A repository address can be formed: publish without an address works. */
    ready: boolean;
    /** Origin of the git server, https://host. */
    server?: string;
    /** Owner (first path segment) this Hyper's plugins are published under. */
    owner?: string;
    /** Repository address of a plugin, with `<name>` for its name. */
    repo?: string;
    /** Address of the shared listing repository, when there is one. */
    listing?: string;
    /** Who the server sees: a server of the network or a person. */
    identity?: { kind: 'server' | 'person'; id: string };
    /** Recorded in the listing entry as the publisher: the server's id, or the person's email. */
    publishedBy?: string;
    /** What stops publishing here, or what to know; empty when all is well. */
    problems: string[];
}> {
    const raw: unknown = await ctx.fns.settings.get({ module: 'plugins', scopeType: 'global', key: 'home' });
    let value: unknown = raw;
    if (typeof raw === 'string') { const t = raw.trim(); try { value = t.startsWith('{') ? JSON.parse(t) : t; } catch { value = t; } }
    if (value == null || value === '') return { configured: false, ready: false, problems: ['plugins.home is not set: this Hyper has no place of its own to publish to'] };
    const cfg = typeof value === 'string' ? { server: value } : value as { server?: unknown; owner?: unknown; listing?: unknown };
    const server = String(cfg.server ?? '').trim().replace(/\/+$/, '');
    if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::\d{1,5})?$/.test(server))
        return { configured: true, ready: false, problems: ['plugins.home.server must be the https address of the git server, like https://git.example.org'] };
    const OWNER = /^[a-z0-9][a-z0-9_-]{0,63}$/;
    const setOwner = cfg.owner == null || cfg.owner === '' ? undefined : String(cfg.owner);
    if (setOwner !== undefined && !OWNER.test(setOwner))
        return { configured: true, ready: false, server, problems: ['plugins.home.owner must be a lowercase name (letters, digits, - and _)'] };
    let setListing: string | undefined;
    if (cfg.listing != null && cfg.listing !== '') {
        try { setListing = (await ctx.fns.plugins.repoUrl({ repo: String(cfg.listing) })).url; }
        catch { return { configured: true, ready: false, server, problems: ['plugins.home.listing is not a repository address'] }; }
    }
    const shape = (owner: string | undefined, listing: string | undefined, extra: Record<string, unknown>, problems: string[]) => ({
        configured: true, ready: !!owner, server,
        ...(owner ? { owner, repo: `${server}/git/${owner}/plugins/<name>.git` } : {}),
        ...(listing ? { listing } : {}), ...extra, problems,
    });
    if (opts.offline) return shape(setOwner, setListing, {}, []);

    type Who = { kind?: unknown; id?: unknown; email?: unknown; owners?: unknown; anyOwner?: unknown; publicUrl?: unknown; pluginCatalog?: { url?: unknown; push?: unknown } | null };
    const state = ctx.state as { pluginHome?: { at: number; server: string; who: Who | null; error?: string } };
    let seen = state.pluginHome;
    if (opts.fresh || !seen || seen.server !== server || Date.now() - seen.at > 5 * 60_000) {
        let who: Who | null = null, error: string | undefined;
        try {
            const res = await fetch(`${server}/api/whoami`, { redirect: 'error', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
            if (res.status === 404) error = `${server} does not answer /api/whoami (not a hyper-git server, or an older one)`;
            else if (!res.ok) error = `${server} refused to say who this Hyper is (HTTP ${res.status}): the network does not let this Hyper reach it`;
            else { const body = await res.json().catch(() => null) as Who | null; if (body && (body.kind === 'server' || body.kind === 'person') && typeof body.id === 'string') who = body; else error = `${server} did not answer as a hyper-git server`; }
        } catch (e) { error = `Cannot reach ${server}: ${e instanceof Error ? e.message : 'request failed'}`; }
        seen = state.pluginHome = { at: Date.now(), server, who, ...(error ? { error } : {}) };
    }
    const who = seen.who;
    if (!who) {
        // Without the server's word the setting alone still works when it names everything — unverified, and said so.
        return shape(setOwner, setListing, {}, [seen.error!, ...(setOwner ? [`publishing under "${setOwner}" as set in plugins.home, not confirmed by the server`] : ['set owner in plugins.home, or fix the access'])]);
    }
    const problems: string[] = [];
    // The address the server gives for itself wins over what a client would guess; it must be the one configured.
    if (typeof who.publicUrl === 'string' && who.publicUrl !== server) problems.push(`the server calls itself ${who.publicUrl}, plugins.home says ${server}: use the server's own address`);
    const identity = { kind: who.kind as 'server' | 'person', id: String(who.id) };
    const owners = Array.isArray(who.owners) ? who.owners.map(String).filter(o => OWNER.test(o)) : [];
    let owner: string | undefined;
    if (identity.kind === 'server') {
        if (setOwner && !owners.includes(setOwner)) problems.push(`this Hyper is ${identity.id} and may publish under ${owners.map(o => `"${o}"`).join(', ') || 'nothing'}, not under "${setOwner}": remove owner from plugins.home`);
        else owner = setOwner ?? owners[0];
        if (!owner && !problems.length) problems.push(`the server lets ${identity.id} create no plugin repositories`);
    } else {
        // A person may create anywhere, so the server cannot say where this Hyper's plugins belong: the setting does.
        owner = setOwner;
        if (!owner) problems.push(`this Hyper reaches ${server} as the person ${String(who.email ?? identity.id)}, not as a server of its own: set owner in plugins.home to the name its plugins are published under`);
    }
    const catalog = who.pluginCatalog && typeof who.pluginCatalog.url === 'string' ? who.pluginCatalog : null;
    const listing = setListing ?? (catalog ? String(catalog.url) : undefined);
    if (!listing) problems.push('the server names no shared listing: a plugin is published to its repository and others install it by address');
    else if (catalog && !setListing && catalog.push === false) problems.push('the server does not let this Hyper write to the shared listing');
    const publishedBy = identity.kind === 'person' ? String(who.email ?? identity.id.replace(/^user:/, '')) : identity.id;
    return shape(owner, listing, { identity, publishedBy }, problems);
}
