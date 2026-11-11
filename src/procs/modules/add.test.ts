// UNIT test: modules/add.test.ts ↔ modules/add.ts and modules/remove.ts — the
// manifest edit, which is what installing a module IS. Mounting is somebody
// else's job, so `reload` is stubbed: a stub is one assignment into the registry
// here, exactly like a hot-swap.
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { testCtx } from "../../$test";

const ROOT = resolve(import.meta.dir, "..", "..", "..", "test-proc");

async function workspace(manifest: any): Promise<{ ctx: Context; file: string }> {
    const dir = mkdtempSync(join(tmpdir(), "modules-add-"));
    const file = join(dir, "workspace.json");
    writeFileSync(file, JSON.stringify(manifest, null, 2));
    const ctx = await testCtx({ root: ROOT, workdir: dir, env: { PROCS_PATH: "./modules" } });
    // What a mounted module looks like to add/remove — nothing here is fetched.
    (ctx.state.registry as any).procs.modules.reload = () => [{ name: "labs", provides: [] }];
    return { ctx, file };
}

test("add writes `modules`, and folds a pre-rename `plugins` into it", async () => {
    // Regression: add wrote whichever key the file already had, so a workspace
    // written before the rename kept growing a `plugins` list that everything
    // reading `modules` ignored — mounting a module never started its service.
    const { ctx, file } = await workspace({ plugins: { greeter: {} } });
    await ctx.fns.procs.modules.add({ name: "labs", config: { license: "x" } });

    const written = JSON.parse(readFileSync(file, "utf8"));
    expect(written).toEqual({ modules: { greeter: {}, labs: { license: "x" } } });
    expect(written.plugins).toBeUndefined();
    rmSync(join(file, ".."), { recursive: true, force: true });
});

test("remove drops a module declared under the old key, and leaves one list", async () => {
    const { ctx, file } = await workspace({ plugins: { greeter: {}, labs: {} } });
    await ctx.fns.procs.modules.remove({ name: "labs" });

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ modules: { greeter: {} } });
    await expect(ctx.fns.procs.modules.remove({ name: "labs" })).rejects.toThrow(/not declared/);
    rmSync(join(file, ".."), { recursive: true, force: true });
});

test("add refuses a git URL and leaves workspace.json alone: git plugins come through plugins.install", async () => {
    const { ctx, file } = await workspace({ modules: { greeter: {} } });
    const before = readFileSync(file, "utf8");
    await expect(ctx.fns.procs.modules.add({ name: "billing", git: "https://github.com/acme/x" }))
        .rejects.toThrow('install billing with plugins.install({ name: "billing" })');
    expect(readFileSync(file, "utf8")).toBe(before);
    rmSync(join(file, ".."), { recursive: true, force: true });
});

test("fetch clones nothing, whatever workspace.json declares", async () => {
    const { ctx, file } = await workspace({ modules: { billing: { git: "https://example.invalid/acme/x" } } });
    expect(await ctx.fns.procs.modules.fetch({})).toEqual({ fetched: [] });
    expect(await ctx.fns.procs.modules.fetch({ name: "billing" })).toEqual({ fetched: [] });
    expect(require("node:fs").existsSync(join(file, "..", ".claude"))).toBe(false);
    rmSync(join(file, ".."), { recursive: true, force: true });
});

test("add refuses a folder path and leaves workspace.json alone: a private plugin is a folder in USER_PLUGINS", async () => {
    const { ctx, file } = await workspace({ modules: { greeter: {} } });
    const before = readFileSync(file, "utf8");
    await expect(ctx.fns.procs.modules.add({ name: "labs", path: "./tools/labs" }))
        .rejects.toThrow("modules.add no longer mounts a folder by path: put the labs folder into USER_PLUGINS");
    expect(readFileSync(file, "utf8")).toBe(before);
    rmSync(join(file, ".."), { recursive: true, force: true });
});

test("an npm package declared in workspace.json is not mounted: it is named in a warning and skipped", async () => {
    // A complete plugin package on disk, declared the way `"npm"` mounts used to be resolved.
    const dir = mkdtempSync(join(tmpdir(), "modules-npm-"));
    const pkg = join(dir, "pkg");
    mkdirSync(join(pkg, "src", "vitalsns"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "measures", procs: { src: "src", plugin: true } }));
    writeFileSync(join(pkg, "src", "vitalsns", "ping.ts"), "export default async function () { return 'pong'; }\n");
    writeFileSync(join(dir, "workspace.json"), JSON.stringify({ modules: { vitals: { npm: pkg } } }));
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };
    try {
        const ctx = await testCtx({ root: ROOT, workdir: dir, env: { PROCS_PATH: "./modules" } });
        expect(ctx.fns.procs.modules.list({}).some((m: any) => m.name === "vitals")).toBe(false);
        expect((ctx.fns as any).vitalsns).toBeUndefined();
        expect(warnings.some(w => w.includes("vitals: npm packages are not mounted any more") && w.includes('plugins.install({ name: "vitals" })'))).toBe(true);
    } finally {
        console.warn = warn;
        rmSync(dir, { recursive: true, force: true });
    }
});
