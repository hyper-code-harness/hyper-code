/**
 * Create a native mobile session handoff token after browser sign-in
 *
 * Creates a short-lived single-use handoff code for an authenticated user so an iOS ASWebAuthenticationSession can transfer the completed web SSO session into URLSession without exposing the normal HttpOnly browser cookie.
 * @param opts.userId Authenticated Hyper user identifier to bind to the handoff.
 * @param opts.sid Control-plane (OIDC) session id of the browser sign-in, when it was one; the exchanged app cookie then joins that session.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Authenticated Hyper user identifier to bind to the handoff. */
        userId: string;
        /** Control-plane (OIDC) session id ("s_…") of the browser sign-in; null for password/Google sign-ins. @default null */
        sid?: string | null;
    },
): Promise<{ code: string }> {
    const code = "m_" + Bun.randomUUIDv7().replace(/-/g, "");
    const state: Map<string, { userId: string; sid: string | null; expiresAt: number }> = ((ctx.state as any).mobileAuthHandoffs ??= new Map());
    const now = Date.now();
    for (const [key, value] of state) if (value.expiresAt <= now) state.delete(key);
    state.set(code, { userId: opts.userId, sid: opts.sid ?? null, expiresAt: now + 2 * 60_000 });
    return { code };
}
