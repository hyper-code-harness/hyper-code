import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readlink, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareHost } from "./plugin-test";

async function plugin(dir: string, name: string, requires: string[] = [], devDependencies: Record<string, string> = {}) {
    await mkdir(join(dir, "src", name), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ name, procs: { requires }, devDependencies }));
}

test("mounts the plugin and what it requires, plus plugin devDependencies, transitively, from node_modules then PLUGIN_HOST", async () => {
    const root = await mkdtemp(join(tmpdir(), "plugin-test-"));
    try {
        const me = join(root, "me"), machine = join(root, "machine");
        await plugin(me, "vegalite", ["duckdb"], { chartkit: "^1", lodash: "^4" });
        await plugin(join(me, "node_modules", "chartkit"), "chartkit");
        await mkdir(join(me, "node_modules", "lodash"), { recursive: true });
        await writeFile(join(me, "node_modules", "lodash", "package.json"), JSON.stringify({ name: "lodash" }));
        await plugin(join(me, "node_modules", "duckdb"), "duckdb", ["pg"]);
        await plugin(join(machine, "node_modules", "pg"), "pg");
        const { host, plugins } = await prepareHost(me, { PLUGIN_HOST: machine });
        expect(Object.keys(plugins).sort()).toEqual(["chartkit", "duckdb", "pg", "vegalite"]);
        expect(await readlink(join(host, "node_modules", "pg"))).toBe(join(machine, "node_modules", "pg"));
        expect(Object.keys(JSON.parse(await readFile(join(host, "package.json"), "utf8")).dependencies).sort()).toEqual(["chartkit", "duckdb", "pg", "vegalite"]);
        await rm(host, { recursive: true, force: true });
        await expect(prepareHost(me, {})).rejects.toThrow("duckdb requires pg");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
