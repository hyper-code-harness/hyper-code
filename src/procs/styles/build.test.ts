import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import build from "./build";

const framework = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");

// A ctx with just what build reads; the app name keys the output folder, so a
// unique one keeps this test's files apart from the running server's.
async function setup() {
    const dir = await mkdtemp(join(tmpdir(), "styles-build-"));
    const app = `styles-test-${crypto.randomUUID()}`;
    const warnings: string[] = [];
    const ctx: any = {
        state: { procs: { styles: [] } },
        fns: { procs: {
            project: { projectRoot: () => `/nonexistent/${app}` },
            modules: { discover: async () => [{ dir }] },
            log: { warn: (o: any) => warnings.push(String(o.msg)) },
        } },
    };
    const cleanup = async () => {
        await rm(dir, { recursive: true, force: true });
        await rm(join(framework, ".runtime-tw", app), { recursive: true, force: true });
    };
    return { dir, ctx, warnings, cleanup };
}

test("styles.build runs Tailwind on this bun, not on a node or bunx from PATH", async () => {
    const { dir, cleanup } = await setup();
    const bin = join(dir, "bin");
    try {
        await Bun.write(join(bin, "node"), "#!/bin/sh\necho broken-node >&2; exit 7\n");
        await Bun.write(join(bin, "bunx"), "#!/bin/sh\necho broken-bunx >&2; exit 7\n");
        await chmod(join(bin, "node"), 0o755); await chmod(join(bin, "bunx"), 0o755);
        const abs = join(dir, "app.css");
        await writeFile(join(dir, "page.html"), `<div class="flex-col-reverse"></div>`);
        await writeFile(abs, `.marker-rule { color: red; }`);
        // A child process: PATH is read when a process starts, so the broken
        // node/bunx must be first on PATH for the whole server-like process.
        const script = `
            import build from ${JSON.stringify(join(framework, "src/procs/styles/build.ts"))};
            const app = "styles-test-" + crypto.randomUUID();
            const ctx = { state: { procs: { styles: [] } }, fns: { procs: {
                project: { projectRoot: () => "/nonexistent/" + app },
                modules: { discover: async () => [{ dir: ${JSON.stringify(dir)} }] },
                log: { warn: () => {} } } } };
            try { const out = await build(ctx, null, { abs: ${JSON.stringify(abs)}, key: "probe" }); console.log(await Bun.file(out).text()); }
            finally { (await import("node:fs/promises")).rm(${JSON.stringify(join(framework, ".runtime-tw"))} + "/" + app, { recursive: true, force: true }); }`;
        await Bun.write(join(dir, "run.ts"), script);
        const proc = Bun.spawn([process.execPath, join(dir, "run.ts")], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe" });
        const [css, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        expect(err).not.toContain("broken-");
        expect(code).toBe(0);
        expect(css).toContain("flex-col-reverse");
        expect(css).toContain("marker-rule");
    } finally {
        await cleanup();
    }
}, 60_000);

test("a failed rebuild serves the last good stylesheet; with none it throws", async () => {
    const { dir, ctx, warnings, cleanup } = await setup();
    try {
        const abs = join(dir, "app.css");
        await writeFile(abs, `.good-rule { color: red; }`);
        const out = await build(ctx, null, { abs, key: "probe" });
        await writeFile(abs, `.bad { @apply no-such-utility-xyz; }`);
        expect(await build(ctx, null, { abs, key: "probe", force: true })).toBe(out);
        expect(await Bun.file(out).text()).toContain("good-rule");
        expect(warnings.join("\n")).toContain("last good stylesheet");

        await expect(build(ctx, null, { abs, key: "never-built", force: true })).rejects.toThrow("tailwind build failed");
    } finally {
        await cleanup();
    }
}, 60_000);
