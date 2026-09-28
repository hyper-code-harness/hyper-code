/**
 * Returns the Google sign-in configuration, or null when Google sign-in is off.
 *
 * Google sign-in is optional: it is enabled only when both the client ID and the client secret
 * are configured. The secret may be an op:// or secret:// reference resolved through secrets.get.
 * Password sign-in always keeps working regardless of this configuration.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<{
    clientId: string;
    clientSecret: string;
    domain: string;
    autoCreate: boolean;
} | null> {
    const setting = (key: string) => ctx.fns.settings.get({ module: "auth", scopeType: "global", key });
    const clientId = String((await setting("googleClientId")) ?? "").trim();
    const rawSecret = String((await setting("googleClientSecret")) ?? "").trim();
    if (!clientId || !rawSecret) return null;
    const clientSecret = /^(op|secret|env):\/\//.test(rawSecret)
        ? String((await ctx.fns.secrets.get({ ref: rawSecret, namespace: "auth", name: "googleClientSecret" })) ?? "")
        : rawSecret;
    if (!clientSecret) return null;
    const domain = String((await setting("googleDomain")) ?? "health-samurai.io").trim().toLowerCase().replace(/^@/, "");
    const auto = await setting("googleAutoCreate");
    return { clientId, clientSecret, domain, autoCreate: auto === undefined || auto === null ? true : auto === true || auto === "true" };
}
