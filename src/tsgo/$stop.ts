/** Stops the tsgo language server on graceful shutdown. */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<void> {
    await ((ctx.state as any).tsgo as types.tsgo.State | undefined)?.client?.close();
}
