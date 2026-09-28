/**
 * Says whether this Hyper accepts sign-in only through the OIDC provider (Hyper Control Plane).
 *
 * On when the `auth.oidcOnly` setting (env HYPER_OIDC_ONLY) is true. Then password sign-in, the legacy
 * shared password, first-user setup and the open no-user mode are all off, and only server-side OIDC
 * sessions count. Use before offering or accepting any non-OIDC way in.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<boolean> {
    const v = await ctx.fns.settings.get({ module: "auth", scopeType: "global", key: "oidcOnly" });
    return v === true || v === "true" || v === "1";
}
