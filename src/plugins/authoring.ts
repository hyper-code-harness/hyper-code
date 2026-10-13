/**
 * Reads the canonical guide for creating and configuring Hyper plugins.
 *
 * Use before authoring a plugin to learn metadata, source layout, runtime functions, declared settings, security boundaries and validation. Resolves the guide beside this loaded core function, independently of the agent workspace and process working directory.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<string> {
    const metadata = await ctx.fns.runtime.docs.get({ name: "plugins.authoring" });
    if (!metadata?.abs) throw new Error("plugins.authoring: loaded source path unavailable");
    const path = await import("node:path");
    return Bun.file(path.join(path.dirname(metadata.abs), "SKILL.md")).text();
}
