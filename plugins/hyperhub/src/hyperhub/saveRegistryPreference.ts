/**
 * Saves a credential-free default registry origin for the HyperHub browser
 *
 * Use after an explicit same-origin preferences form submission. Stores only a validated HTTPS origin, or clears it with an empty string; never contacts the registry or installs code.
 * @param opts.baseUrl Credential-free HTTPS origin without path, query or fragment; empty clears the saved origin.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Credential-free HTTPS origin without path, query or fragment; empty clears the saved origin. */
        baseUrl: string;
    },
): Promise<{saved: true}> {
    const raw = opts.baseUrl.trim();
    let value = '';
    if (raw) {
     const u = new URL(raw);
     if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || raw.includes('?') || raw.includes('#')) throw new Error('Use a credential-free HTTPS origin');
     value = u.origin;
    }
    await ctx.fns.settings.set({module:'hyperhub',scopeType:'global',key:'registryUrl',value});
    return {saved:true};
}
