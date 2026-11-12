/**
 * Creates a new plugin in USER_PLUGINS from a starter: package.json, SKILL.md, one documented function with its test, under local git and mounted
 *
 * Use to start a plugin instead of writing the folder by hand. Writes USER_PLUGINS/<name> with a package.json (version 0.1.0, the procs block from label, icon and description), a SKILL.md to fill in, .gitignore, and src/<namespace>/hello.ts with hello.test.ts as a working example of the one-function-per-file grammar; then puts the folder under git as a local repository with one commit (plugins.gitInit — no remote, nothing is published) and remounts, so ctx.fns.<namespace>.hello is callable at once and a save under src/ goes live. Refuses a name that already exists in USER_PLUGINS, a name or namespace a mounted module owns, and a name the plugin catalog already lists; on any failure it removes what it wrote. Next: add functions (procs.dev.createFunction with root `plugin:<name>`), then plugins.publish for the first release.
 * @param opts.name Plugin name: the folder under USER_PLUGINS and the package.json name — lowercase letters, digits and single dashes.
 * @param opts.description One concrete sentence saying what the plugin does; shown in the catalog and used for discovery (10–300 characters).
 * @param opts.label Display name; defaults to the name in title case.
 * @param opts.icon Phosphor icon class for menus and the catalog. @default ph-puzzle-piece
 * @param opts.namespace Runtime namespace of its functions (ctx.fns.<namespace>); defaults to the name in camelCase.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Plugin name: the folder under USER_PLUGINS and the package.json name — lowercase letters, digits and single dashes. */
        name: string;
        /** One concrete sentence saying what the plugin does; shown in the catalog and used for discovery (10–300 characters). */
        description: string;
        /** Display name; defaults to the name in title case. */
        label?: string;
        /** Phosphor icon class for menus and the catalog. @default ph-puzzle-piece */
        icon?: string;
        /** Runtime namespace of its functions (ctx.fns.<namespace>); defaults to the name in camelCase. */
        namespace?: string;
    },
): Promise<{ name: string; dir: string; namespace: string; version: string; files: string[]; commit: string; functions: string[]; mounted: boolean }> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const name = String(opts.name ?? '').trim();
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name) || name.endsWith('-') || name.includes('--')) throw new Error('Plugin name must be lowercase letters, digits and single dashes, starting with a letter');
    const description = String(opts.description ?? '').trim().replace(/\s+/g, ' ');
    if (description.length < 10 || description.length > 300) throw new Error('description is required: one sentence (10–300 characters) saying what the plugin does');
    const label = String(opts.label ?? '').trim() || name.split('-').map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ');
    if (label.length > 60) throw new Error('label must be at most 60 characters');
    const icon = String(opts.icon ?? 'ph-puzzle-piece');
    if (!/^ph-[a-z0-9-]+$/.test(icon)) throw new Error('icon must be a Phosphor class such as ph-puzzle-piece');
    // The namespace is what functions are called by: ctx.fns.<namespace>.<fn>. my-plugin → myPlugin.
    const namespace = String(opts.namespace ?? '').trim() || name.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
    if (!/^[a-zA-Z_$][\w$]*$/.test(namespace) || namespace === 'procs') throw new Error('Invalid or reserved namespace: ' + namespace);
    
    const configured = String(ctx.env.USER_PLUGINS ?? '').trim();
    if (!configured) throw new Error('USER_PLUGINS is not configured');
    const mount = path.resolve(configured.replace(/^~(?=\/)/, String(ctx.env.HOME || os.homedir())));
    const dir = path.join(mount, name);
    if (await fs.lstat(dir).catch(() => null)) throw new Error(`${name} already exists in USER_PLUGINS`);
    // Names and namespaces are global: one that a mounted module owns stays theirs.
    const taken = (ctx.state.procs.modules ?? []).find(m => m.name === name || m.namespaces.includes(namespace) || m.namespaces.includes(name));
    if (taken) throw new Error(`${taken.name === name ? 'Name ' + name : 'Namespace ' + namespace} is already used by ${taken.source ?? 'runtime'} module ${taken.name}`);
    if (namespace in ctx.fns) throw new Error(`Namespace ${namespace} is already used: ctx.fns.${namespace} exists`);
    // A name the catalog already knows would collide on the day this plugin is published. Best effort: an unreachable listing does not block.
    const listed = await ctx.fns.plugins.listing({}).then(l => l.plugins.find(p => p.name === name), () => undefined);
    if (listed) throw new Error(`A plugin named ${name} is already in the catalog (${listed.source}): install that one, or choose another name`);
    
    const pkg = { name, version: '0.1.0', type: 'module', procs: { src: 'src', label, icon, optional: true, description } };
    const skill = `---
    name: ${name}
    description: ${JSON.stringify(description)}
    ---
    
    # ${label}
    
    ${description}
    
    Write here what the plugin is for, what it needs (accounts, settings, secrets) and what it must never do.
    Keep signatures out of this file: \`plugins.read({ name: "${name}" })\` shows the functions from their JSDoc.
    
    ## Develop
    
    - Functions live in \`src/${namespace}/<fn>.ts\`, one per file: \`ctx.fns.${namespace}.<fn>({ ... })\`. A save goes live at once.
    - Tests: \`bun <hyper-code>/script/plugin-test.ts .\` in this folder.
    - Publish: \`plugins.publish({ name: "${name}", repo })\` — first release to a git repository of yours. Later versions: \`plugins.edit\`, commit, \`plugins.release\`.
    `;
    const hello = `/**
     * Says hello from the ${label} plugin — the starter function; replace it with the first real one
     *
     * Use to check that the plugin is mounted and callable. It reads nothing and changes nothing.
     * @param opts.to Who to greet. @default "world"
     */
    export default async function (_ctx: Context, _session: Session | null, opts: {
        /** Who to greet. @default "world" */
        to?: string;
    }): Promise<{ plugin: string; message: string }> {
        const to = String(opts?.to ?? "").trim() || "world";
        return { plugin: ${JSON.stringify(name)}, message: \`Hello, \${to}!\` };
    }
    `;
    const test = `import { expect, test } from "bun:test";
    import hello from "./hello";
    
    test("hello greets the given name, and the world by default", async () => {
        expect(await hello({} as any, null, {})).toEqual({ plugin: ${JSON.stringify(name)}, message: "Hello, world!" });
        expect((await hello({} as any, null, { to: " Ada " })).message).toBe("Hello, Ada!");
    });
    `;
    const files: Record<string, string> = {
        'package.json': JSON.stringify(pkg, null, 2) + '\n',
        'SKILL.md': skill,
        '.gitignore': 'node_modules\n',
        [`src/${namespace}/hello.ts`]: hello,
        [`src/${namespace}/hello.test.ts`]: test,
    };
    await fs.mkdir(mount, { recursive: true });
    try {
        for (const [rel, text] of Object.entries(files)) {
            await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
            await fs.writeFile(path.join(dir, rel), text, { flag: 'wx' });
        }
        // Under git from the first minute: the same check as an install, then one commit, no remote.
        const repo = await ctx.fns.plugins.gitInit({ name });
        let mounted = true;
        try { await ctx.fns.procs.modules.reload({}); } catch { mounted = false; }
        return { name, dir, namespace, version: pkg.version, files: repo.files, commit: repo.commit, functions: [`${namespace}.hello`], mounted };
    } catch (cause) {
        // Half a plugin would mount on the next reload: leave nothing behind.
        await fs.rm(dir, { recursive: true, force: true });
        throw cause;
    }
}
