/**
 * Renders a hidden CSRF input bound to the current session
 *
 * Returns escaped hidden input markup for cookie-authenticated state-changing forms. Use while rendering a form; verification belongs in auth.verifyCsrf. Returns an empty string when no session cookie exists.
 * @param opts.req Incoming page request carrying the session cookie.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Incoming page request carrying the session cookie. */
        req: Request;
    },
): Promise<string> {
    const token = await ctx.fns.auth.csrfToken({ req: opts.req });
    return token ? `<input type="hidden" name="_csrf" value="${Bun.escapeHTML(token)}">` : "";
}
