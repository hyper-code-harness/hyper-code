/**
 * Adds the current session CSRF field to every POST form in trusted HTML
 *
 * Injects one cookie-bound hidden CSRF input into each server-rendered method=post form that does not already contain one. Use on trusted HTML fragments before returning them to the browser.
 * @param opts.req Incoming page request carrying the session cookie.
 * @param opts.html Trusted server-rendered HTML containing forms.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Incoming page request carrying the session cookie. */
        req: Request;
        /** Trusted server-rendered HTML containing forms. */
        html: string;
    },
): Promise<string> {
    const field = await ctx.fns.auth.csrfField({ req: opts.req });
    if (!field || /\bname=["']_csrf["']/i.test(opts.html)) return opts.html;
    return opts.html.replace(/<form\b([^>]*\bmethod=["']?post["']?[^>]*)>/gi, (form) => form + field);
}
