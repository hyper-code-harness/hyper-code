/** Start the passkey guard on the shared Chrome at boot, without delaying startup (off with BROWSER_VIRTUAL_PASSKEYS=0). */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<void> {
    queueMicrotask(() => {
        void (async () => {
            const on = await ctx.fns.settings.get({ module: "browser", scopeType: "global", key: "virtualPasskeys" }) as boolean | undefined;
            if (on === false) return;
            await ctx.fns.browser.passkeyGuard({});
        })().catch((e: any) => ctx.fns.procs.log.debug({ event: "browser.passkeyGuard", msg: e?.message ?? String(e) }));
    });
}
