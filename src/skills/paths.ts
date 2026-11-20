/**
 * Resolves where Agent Skills live on this instance: installed packs, the lock file, staging and the operation mutex
 *
 * Use from skills.* functions instead of building paths by hand. Everything sits under the Hyper home (memory.home:
 * ~/.hyper, or HYPER_HOME in tests) and outside USER_PLUGINS, so the module loader never scans a skill pack as code.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<{ home: string; packs: string; lock: string; staging: string; mutex: string }> {
    const { join } = await import("node:path");
    const home = await ctx.fns.memory.home({});
    return {
        home,
        packs: join(home, "skills"),
        lock: join(home, "skills.lock.json"),
        staging: join(home, ".skills-staging"),
        mutex: join(home, ".skills-operation-lock"),
    };
}
