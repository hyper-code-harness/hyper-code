import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import tmp from "./tmp";

async function withRoot(fn: (root: string, ctx: any) => Promise<void>) {
    const root = await mkdtemp(join(tmpdir(), "hyper-tmp-"));
    const ctx: any = { fns: { procs: { project: { projectRoot: () => root } } } };
    try { await fn(root, ctx); } finally { await rm(root, { recursive: true, force: true }); }
}

test("workspace.tmp gives each agent its own .hyper/tmp/<agent-id>/ and creates the parent", async () => {
    await withRoot(async (root, ctx) => {
        const path = await tmp(ctx, { agentId: "ab", agent: { id: "ab" } } as any, { path: "dumps/x.json" });
        expect(path).toBe(join(root, ".hyper/tmp/ab/dumps/x.json"));
        expect((await stat(join(root, ".hyper/tmp/ab/dumps"))).isDirectory()).toBe(true);
        expect(await tmp(ctx, { agentId: "cd" } as any, {})).toBe(join(root, ".hyper/tmp/cd"));
        expect(await tmp(ctx, null, { path: "a.txt", mkdir: false })).toBe(join(root, ".hyper/tmp/shared/a.txt"));
    });
});

test("workspace.tmp rejects paths that leave the agent directory and unsafe ids", async () => {
    await withRoot(async (_root, ctx) => {
        const session: any = { agentId: "ab", agent: { id: "ab" } };
        await expect(tmp(ctx, session, { path: "../cd/x" })).rejects.toThrow("escapes");
        await expect(tmp(ctx, session, { path: "/etc/passwd" })).rejects.toThrow("escapes");
        await expect(tmp(ctx, { agentId: "../x" } as any, {})).rejects.toThrow("unsafe");
    });
});
