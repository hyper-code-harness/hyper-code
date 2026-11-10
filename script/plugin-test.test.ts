import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readlink, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareHost } from "./plugin-test";

async function plugin(dir: string, name: string, requires: string[] = [], devDependencies: Record<string, string> = {}) {
    await mkdir(join(dir, "src", name), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ name, procs: { requires }, devDependencies }));
}

test("mounts the plugin and what it requires, plus plugin devDependencies, transitively, from node_modules then USER_PLUGINS", async () => {
    const root = await mkdtemp(join(tmpdir(), "plugin-test-"));
    try {
        const me = join(root, "me"), machine = join(root, "machine");
        await plugin(me, "vegalite", ["duckdb"], { chartkit: "^1", lodash: "^4" });
        await plugin(join(me, "node_modules", "chartkit"), "chartkit");
        await mkdir(join(me, "node_modules", "lodash"), { recursive: true });
        await writeFile(join(me, "node_modules", "lodash", "package.json"), JSON.stringify({ name: "lodash" }));
        await plugin(join(me, "node_modules", "duckdb"), "duckdb", ["pg"]);
        await plugin(join(machine, "pg"), "pg");
        const { host, plugins } = await prepareHost(me, { USER_PLUGINS: machine });
        expect(Object.keys(plugins).sort()).toEqual(["chartkit", "duckdb", "pg", "vegalite"]);
        expect(await readlink(join(host, "pg"))).toBe(join(machine, "pg"));
        expect((await readdir(host)).sort()).toEqual(["chartkit", "duckdb", "pg", "vegalite"]);
        await rm(host, { recursive: true, force: true });
        await expect(prepareHost(me, {})).rejects.toThrow("duckdb requires pg");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
