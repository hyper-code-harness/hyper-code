/**
 * Brings a running macOS application to the front, or launches it when it is not running.
 *
 * Use before keyboard input or coordinate clicks, which go to the frontmost app. Element actions via desktop.press usually work without activation.
 * @param opts.app Application name, bundle id or pid.
 * @param opts.waitMs Pause after activation so the UI settles. @default 400 @minimum 0 @maximum 10000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Application name, bundle id or pid. */
        app: string;
        /** Pause after activation so the UI settles. @default 400 @minimum 0 @maximum 10000 */
        waitMs?: number;
    },
): Promise<{ ok: boolean; app: string; pid: number; launched: boolean }> {
    let launched = false;
    let r: { ok: boolean; app: string; pid: number };
    try {
        r = await ctx.fns.desktop.helper({ args: ["activate", opts.app] }) as { ok: boolean; app: string; pid: number };
    } catch (e) {
        if (!String(e).includes("app not found")) throw e;
        const open = await Bun.$`open -a ${opts.app}`.quiet().nothrow();
        if (open.exitCode !== 0) throw new Error(`desktop.activate: cannot find or launch ${opts.app}`);
        launched = true;
        await Bun.sleep(1500);
        r = await ctx.fns.desktop.helper({ args: ["activate", opts.app] }) as { ok: boolean; app: string; pid: number };
    }
    await Bun.sleep(opts.waitMs ?? 400);
    return { ...r, launched };
}
