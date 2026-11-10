import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testCtx } from "../../$test";

function userRoot(name = "hello-user"): string {
    const root = mkdtempSync(join(tmpdir(), "hyper-user-plugins-"));
    const plugin = join(root, name);
    mkdirSync(join(plugin, "src", "userhello"), { recursive: true });
    writeFileSync(join(plugin, "package.json"), JSON.stringify({
        name,
        private: true,
        type: "module",
        procs: { src: "src", plugin: true, description: "Test user plugin" },
    }));
    writeFileSync(join(plugin, "src", "userhello", "ping.ts"),
        "export default async function (_ctx: Context, _session: Session | null, opts: { value: string }) { return { value: opts.value }; }\n");
    return root;
}

test("automatically mounts direct children of USER_PLUGINS as user plugins", async () => {
    const root = userRoot();
    try {
        const ctx = await testCtx({ env: { USER_PLUGINS: root } });
        const plugin = ctx.fns.procs.modules.list({}).find((module: any) => module.name === "hello-user");
        expect(plugin?.source).toBe("user");
        expect(plugin?.plugin).toBe(true);
        expect(await (ctx.fns as any).userhello.ping({ value: "ok" })).toEqual({ value: "ok" });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("does not mount a user layer when USER_PLUGINS is absent", async () => {
    const ctx = await testCtx();
    expect(ctx.fns.procs.modules.list({}).some((module: any) => module.source === "user")).toBe(false);
});

test("rejects user plugin function collisions", async () => {
    const root = userRoot("collision");
    const plugin = join(root, "collision");
    mkdirSync(join(plugin, "src", "plugins"), { recursive: true });
    writeFileSync(join(plugin, "src", "plugins", "list.ts"),
        "export default async function () { return []; }\n");
    try {
        await expect(testCtx({ env: { USER_PLUGINS: root } })).rejects.toThrow(/USER_PLUGINS collisions.*plugins\.list/s);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

function pluginHost(): string {
    const host = mkdtempSync(join(tmpdir(), "hyper-plugin-host-"));
    const plugin = (name: string, ns: string) => {
        const dir = join(host, "node_modules", name);
        mkdirSync(join(dir, "src", ns), { recursive: true });
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", procs: { src: "src" } }));
        writeFileSync(join(dir, "src", ns, "ping.ts"), "export default async function () { return 'pong'; }\n");
    };
    plugin("hostdemo", "hostdemo");
    plugin("transitive", "transitive");
    writeFileSync(join(host, "package.json"), JSON.stringify({ name: "hyper-plugins", private: true, dependencies: { hostdemo: "github:x/hostdemo#v1" } }));
    return host;
}

test("PLUGIN_HOST mounts only the host's direct dependencies, as user plugins", async () => {
    const host = pluginHost();
    try {
        const ctx = await testCtx({ env: { PLUGIN_HOST: host } });
        const mounted = ctx.fns.procs.modules.list({}) as any[];
        const demo = mounted.find(m => m.name === "hostdemo");
        expect(demo?.source).toBe("user");
        expect(demo?.plugin).toBe(true);
        expect(await (ctx.fns as any).hostdemo.ping({})).toBe("pong");
        expect(mounted.some(m => m.name === "transitive")).toBe(false);
    } finally {
        rmSync(host, { recursive: true, force: true });
    }
});

test("PLUGIN_HOST plugins cannot override core functions", async () => {
    const host = pluginHost();
    mkdirSync(join(host, "node_modules", "hostdemo", "src", "plugins"), { recursive: true });
    writeFileSync(join(host, "node_modules", "hostdemo", "src", "plugins", "list.ts"), "export default async function () { return []; }\n");
    try {
        await expect(testCtx({ env: { PLUGIN_HOST: host } })).rejects.toThrow(/collisions.*plugins\.list/s);
    } finally {
        rmSync(host, { recursive: true, force: true });
    }
});
