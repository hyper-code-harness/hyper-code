import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const framework = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");

// The check runs in a child process with broken `node`/`bunx`/`tsc` first on
// PATH: PATH is read when a process starts, as for a server under launchd.
test("procs.dev.typecheck runs tsc on this bun, not on a node or bunx from PATH; reports type errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "typecheck-"));
    try {
        const bin = join(dir, "bin");
        for (const name of ["node", "bunx", "tsc"]) {
            await Bun.write(join(bin, name), `#!/bin/sh\necho broken-${name} >&2; exit 7\n`);
            await chmod(join(bin, name), 0o755);
        }
        const app = join(dir, "app");
        await Bun.write(join(app, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["*.ts"] }));
        await writeFile(join(app, "bad.ts"), `export const n: number = "not a number";\n`);
        await writeFile(join(app, "good.ts"), `export const s: string = "ok";\n`);
        const script = `
            import typecheck from ${JSON.stringify(join(framework, "src/procs/dev/typecheck.ts"))};
            const ctx = { fns: { procs: { project: { projectRoot: () => ${JSON.stringify(app)} } } } };
            console.log(JSON.stringify({
                all: await typecheck(ctx, null, {}), good: await typecheck(ctx, null, { filter: "good.ts" }),
                tsc: await typecheck(ctx, null, { engine: "tsc" }), tsgo: await typecheck(ctx, null, { engine: "tsgo" }),
            }));`;
        await Bun.write(join(dir, "run.ts"), script);
        const proc = Bun.spawn([process.execPath, join(dir, "run.ts")], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe" });
        const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        expect(err).not.toContain("broken-");
        expect(code).toBe(0);
        const result = JSON.parse(out);
        expect(result.all.ok).toBe(false);
        expect(result.all.errors.join("\n")).toContain("bad.ts");
        expect(result.all.errors.join("\n")).toContain("TS2322");
        expect(result.all.engine).toBe("tsgo");   // auto prefers the native compiler when it is installed
        expect(result.good).toEqual({ ok: true, errors: [], engine: "tsgo" });
        // Both engines find the same diagnostics, line for line.
        expect(result.tsc.engine).toBe("tsc");
        expect(result.tsgo.engine).toBe("tsgo");
        expect(result.tsgo.errors).toEqual(result.tsc.errors);
        expect(result.tsc.errors.join("\n")).toContain("bad.ts(1,14): error TS2322");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}, 120_000);

test("a project tsc cannot check is not reported as clean", async () => {
    const dir = await mkdtemp(join(tmpdir(), "typecheck-empty-"));
    try {
        // No tsconfig and no sources: tsc exits non-zero; that must not read as ok.
        const typecheck = (await import("./typecheck")).default;
        const ctx: any = { fns: { procs: { project: { projectRoot: () => dir } } } };
        const result = await typecheck(ctx, null, {});
        expect(result.ok).toBe(false);
        // tsgo prints its help and exits 1 here: that is a failure to run, not diagnostics —
        // auto falls back to tsc, which fails too, and both reasons are reported.
        expect(result.engine).toBe("tsc");
        expect(result.errors[0]).toStartWith("tsc failed to run");
        expect(result.errors.join("\n")).toContain("tsgo failed to run");
        const forced = await typecheck(ctx, null, { engine: "tsgo" });
        expect(forced.ok).toBe(false);
        expect(forced.errors[0]).toStartWith("tsgo failed to run");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}, 120_000);
