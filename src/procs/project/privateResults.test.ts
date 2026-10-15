import { expect, test } from "bun:test";
import scan from "./scan";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("runtime scanner excludes result payloads and symlink aliases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hyper-scan-results-"));
    try {
        const root = join(dir, ".hyper");
        await mkdir(join(root, "results"), { recursive: true });
        await mkdir(join(root, "safe"));
        await writeFile(join(root, "results/payload.ts"), "export default () => 1;");
        await writeFile(join(root, "safe/normal.ts"), "export default () => 2;");
        await symlink(join(root, "results/payload.ts"), join(root, "safe/alias.ts"));
        const ctx = { fns: { procs: { modules: { discover: async () => [{ dir: root, name: "fixture" }] } } } } as unknown as Context;
        const entries = await scan(ctx, null, {});
        expect(entries.map(e => e.projectRel)).toEqual(["safe/normal.ts"]);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
