import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import route from "./$route_dirs_GET";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(path => rm(path, { recursive: true, force: true }))); });

describe("GET /agent/dirs", () => {
    test("suggests folders using Node filesystem APIs when fd is unavailable", async () => {
        const root = await mkdtemp(join(tmpdir(), "hyper-dirs-"));
        roots.push(root);
        await Promise.all([mkdir(join(root, "alpha-project")), mkdir(join(root, "beta-project"))]);
        const ctx: any = { env: { HOME: root }, fns: { procs: { ui: { escape: ({ text }: any) => String(text) } } } };

        const response = await route(ctx, null, { req: new Request(`http://localhost/agent/dirs?workspaceDir=${encodeURIComponent(root + "/")}`) });
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain(join(root, "alpha-project"));
        expect(html).toContain(join(root, "beta-project"));
    });
});
