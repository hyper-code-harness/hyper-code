// Runs the tests of a plugin that lives in its own repository, against this Hyper.
//
//   bun /path/to/hyper-code/script/plugin-test.ts <plugin dir> [bun test flags…] [paths…]
//
// A plugin test does `import { testCtx } from "hyper:test"` and gets the same booted ctx core tests get, with
// only that plugin mounted — plus the plugins its package.json lists in procs.requires and the plugins among its
// devDependencies (ones it uses when present), taken from the plugin's own node_modules or this machine's USER_PLUGINS. They are mounted the way an
// installed plugin is: a throwaway USER_PLUGINS folder that links to each of them. No official plugins, no
// USER_PLUGINS and no workspace.json of the machine take part. The test database is Hyper's (its .env).
// Plugin migrations are not run.

import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { timeoutFlag } from "./test";

const ROOT = resolve(import.meta.dir, "..");

async function manifest(dir: string): Promise<{ name: string; requires: string[]; devPlugins: string[] }> {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    if (!pkg.procs) throw new Error(`${dir} is not a plugin: package.json has no procs block`);
    // devDependencies that are plugins themselves: what a plugin uses when present (duckdb for vegalite's sql).
    const devPlugins: string[] = [];
    for (const name of Object.keys(pkg.devDependencies ?? {})) {
        const dev = await readFile(join(dir, "node_modules", name, "package.json"), "utf8").then(JSON.parse, () => null);
        if (dev?.procs) devPlugins.push(name);
    }
    // procs.requires is a list of names, or { name: range } when the plugin asks for a version: the names are what gets mounted.
    const r = pkg.procs.requires;
    const requires = Array.isArray(r) ? r.map(String) : r && typeof r === "object" ? Object.keys(r) : [];
    return { name: String(pkg.name), requires, devPlugins };
}

/** Builds a throwaway USER_PLUGINS folder linking the plugin, its plugin devDependencies and, transitively, every plugin they require. */
export async function prepareHost(dir: string, env: Record<string, string | undefined> = process.env): Promise<{ host: string; plugins: Record<string, string> }> {
    const root = resolve(dir);
    const own = await manifest(root);
    const machine = (env.USER_PLUGINS ?? "").trim().replace(/^~(?=\/)/, env.HOME ?? "");
    const plugins: Record<string, string> = { [own.name]: root };
    const queue = [...own.requires, ...own.devPlugins].map(name => ({ name, by: own.name }));
    while (queue.length) {
        const { name, by } = queue.shift()!;
        if (plugins[name]) continue;
        const found = [join(root, "node_modules", name), ...(machine ? [join(machine, name)] : [])]
            .find(d => existsSync(join(d, "package.json")));
        if (!found) throw new Error(`${by} requires ${name}: add it to devDependencies and run bun install`);
        plugins[name] = found;
        queue.push(...(await manifest(found)).requires.map(n => ({ name: n, by: name })));
    }
    const host = await mkdtemp(join(tmpdir(), "hyper-plugin-test-"));
    for (const [name, path] of Object.entries(plugins)) await symlink(path, join(host, name), "dir");
    return { host, plugins };
}

if (import.meta.main) {
    const [dir, ...args] = process.argv.slice(2);
    if (!dir) { console.error("usage: bun script/plugin-test.ts <plugin dir> [bun test flags…] [paths…]"); process.exit(2); }
    const { host, plugins } = await prepareHost(dir);
    console.error(`[plugin-test] mounted: ${Object.keys(plugins).join(", ")}`);
    const envFile = join(ROOT, ".env");
    const p = Bun.spawn({
        cmd: ["bun", "test", "--no-isolate",
            "--preload", join(ROOT, "src/_testPreload.entry.ts"), "--preload", join(ROOT, "script/plugin-test-preload.ts"),
            ...(existsSync(envFile) ? [`--env-file=${envFile}`] : []), ...timeoutFlag(args), ...args],
        cwd: resolve(dir), stdio: ["inherit", "inherit", "inherit"],
        env: { ...process.env, HYPER_PLUGIN_TEST_HOST: host },
    });
    const code = await p.exited;
    await rm(host, { recursive: true, force: true });
    process.exit(code);
}
