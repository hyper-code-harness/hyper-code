/** Stop the experimental HTTPS/HTTP2 listener. */
export default async function (ctx: Context, _session: Session | null, _state?: any) {
    const s = (ctx.state as any).h2?.server;
    if (s) await new Promise<void>(r => s.close(() => r()));
}
