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
            console.log(JSON.stringify({ all: await typecheck(ctx, null, {}), good: await typecheck(ctx, null, { filter: "good.ts" }) }));`;
        await Bun.write(join(dir, "run.ts"), script);
        const proc = Bun.spawn([process.execPath, join(dir, "run.ts")], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe" });
        const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        expect(err).not.toContain("broken-");
        expect(code).toBe(0);
        const result = JSON.parse(out);
        expect(result.all.ok).toBe(false);
        expect(result.all.errors.join("\n")).toContain("bad.ts");
        expect(result.all.errors.join("\n")).toContain("TS2322");
        expect(result.good).toEqual({ ok: true, errors: [] });
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
        expect(result.errors.length).toBeGreaterThan(0);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}, 120_000);
