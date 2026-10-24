import { expect, test } from "bun:test";
import scan from "./scan";
import { chmod, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const fixture = (dir: string) => ({ fns: { procs: { modules: { discover: async () => [{ dir, name: "fixture" }] } } } }) as unknown as Context;

test("a folder the scan may not read is skipped, the rest of the root is still found", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hyper-scan-eacces-"));
    try {
        await mkdir(join(dir, "aa/locked"), { recursive: true });
        await mkdir(join(dir, "zz"));
        await writeFile(join(dir, "aa/locked/hidden.ts"), "export default () => 0;");
        await writeFile(join(dir, "aa/one.ts"), "export default () => 1;");
        await writeFile(join(dir, "zz/two.ts"), "export default () => 2;");
        await chmod(join(dir, "aa/locked"), 0o000);
        const entries = await scan(fixture(dir), null, {});
        expect(entries.map(e => e.projectRel).sort()).toEqual(["aa/one.ts", "zz/two.ts"]);
    } finally {
        await chmod(join(dir, "aa/locked"), 0o755).catch(() => {});
        await rm(dir, { recursive: true, force: true });
    }
});

test("scratch folders are not entered at all: an unreadable one inside tmp costs nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hyper-scan-scratch-"));
    try {
        for (const d of ["tmp/agent/backups", "_runtime/logs", "node_modules/pkg", "mod"]) await mkdir(join(dir, d), { recursive: true });
        await writeFile(join(dir, "tmp/agent/draft.ts"), "export default () => 0;");
        await writeFile(join(dir, "_runtime/logs/x.ts"), "export default () => 0;");
        await writeFile(join(dir, "node_modules/pkg/index.ts"), "export default () => 0;");
        await writeFile(join(dir, "mod/fn.ts"), "export default () => 1;");
        await chmod(join(dir, "tmp/agent/backups"), 0o000);
        const warn = console.warn; const warned: string[] = [];
        console.warn = (...a: any[]) => { warned.push(a.join(" ")); };
        try {
            const entries = await scan(fixture(dir), null, {});
            expect(entries.map(e => e.projectRel)).toEqual(["mod/fn.ts"]);
        } finally { console.warn = warn; }
        expect(warned).toEqual([]);   // never even tried to open tmp/agent/backups
    } finally {
        await chmod(join(dir, "tmp/agent/backups"), 0o755).catch(() => {});
        await rm(dir, { recursive: true, force: true });
    }
});
