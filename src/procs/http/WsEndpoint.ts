// A `$ws_<path>.ts` file default-exports this object. Every handler is called
// the way every other handler is: (ctx, session, opts). `ctx` and `session`
// are the request ctx of the upgrade, so the signed-in user is on the session.
export type WsEndpoint = {
    /** Before upgrading: return a Response to refuse, anything else becomes ws.data.state. */
    upgrade?: (ctx: Context, session: Session | null, opts: { req: Request; params: Record<string, string> }) => unknown;
    open?: (ctx: Context, session: Session | null, opts: { ws: any }) => unknown;
    message?: (ctx: Context, session: Session | null, opts: { ws: any; message: string | Buffer }) => unknown;
    close?: (ctx: Context, session: Session | null, opts: { ws: any; code: number; reason: string }) => unknown;
    drain?: (ctx: Context, session: Session | null, opts: { ws: any }) => unknown;
    /** Source file, set by the loader. */
    from?: string;
};
