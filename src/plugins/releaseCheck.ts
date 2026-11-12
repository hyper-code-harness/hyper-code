/**
 * Checks that a plugin clone is fit to be released: the package checks of an install, a committed bun.lock that matches package.json, and its own tests
 *
 * Use before tagging a version — plugins.release and plugins.publish both call it, so a first release and a later one are held to the same rules as an install. Runs plugins.inspectPackage on the clone (name equals the folder, procs block, no symlinks or credential-like files, well-formed procs.requires and trustedDependencies), then, when the plugin has npm dependencies, demands a committed bun.lock that matches package.json (`bun install --frozen-lockfile --dry-run`), then runs the plugin's *.test.ts files through Hyper's script/plugin-test.ts. Throws on the first failure with what to fix and the words "nothing released"; changes nothing in the clone.
 * @param opts.name Installed plugin name (folder under USER_PLUGINS).
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Installed plugin name (folder under USER_PLUGINS). */
        name: string;
    },
): Promise<{ plugin: types.plugins.PackageInspection; tests: { ran: boolean; output: string } }> {
    const path = await import('node:path');
    const git = (args: string[], allowFailure = false) => ctx.fns.plugins.cloneDir({ name: opts.name, args, allowFailure, timeoutMs: 300_000 });
    const { dir } = await ctx.fns.plugins.cloneDir({ name: opts.name });
    // 1. The structural checks of an install: a tree plugins.install would refuse must not become a release.
    const plugin = await ctx.fns.plugins.inspectPackage({ dir });
    if (plugin.name !== opts.name) throw new Error(`Package is ${plugin.name}, not ${opts.name}; nothing released`);
    // 2. npm dependencies come from a committed, current bun.lock — plugins.install installs exactly from it.
    const fs = await import('node:fs/promises');
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    if (Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).length) {
        if (!(await git(['ls-files', '--error-unmatch', 'bun.lock'], true)).ok)
            throw new Error(`${opts.name} has npm dependencies but bun.lock is not committed: run \`bun install\` in the clone and commit bun.lock; nothing released`);
        const frozen = Bun.spawn([process.execPath, 'install', '--frozen-lockfile', '--dry-run'], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, BUN_BE_BUN: '1' } });
        const [err, code] = [await new Response(frozen.stderr).text(), await frozen.exited];
        const note = /note: (dependencies[^\n]*)/.exec(err)?.[1];
        if (code) throw new Error(`bun.lock of ${opts.name} does not match package.json${note ? ` (${note.slice(0, 200)})` : ''}: run \`bun install\` in the clone and commit bun.lock; nothing released`);
    }
    // 3. Its own tests, against this Hyper.
    const tests: { ran: boolean; output: string } = { ran: false, output: '' };
    if ((await git(['ls-files', '*.test.ts', '**/*.test.ts'])).stdout.length > 0) {
        const script = path.join(ctx.fns.procs.project.projectRoot({}), 'script', 'plugin-test.ts');
        const p = Bun.spawn([process.execPath, script, dir], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, BUN_BE_BUN: '1' } });
        const timer = setTimeout(() => p.kill(), 600_000);
        const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
        clearTimeout(timer);
        tests.ran = true;
        tests.output = (out + err).trim().split('\n').slice(-15).join('\n').slice(0, 3000);
        if (code) throw new Error(`Tests of ${opts.name} failed; nothing released.\n${tests.output}`);
    }
    return { plugin, tests };
}
