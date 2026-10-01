// Fifteen call sites resolve paths through this, so its exact behaviour decides
// where files.* can read and write. The confinement it is named after was
// removed on purpose; these tests record what it ACTUALLY does, so that nobody
// reintroduces a guard by accident and nobody keeps believing in one.
import { test, expect } from "bun:test";
import { testCtx } from "../$test";
import { makeRequestCtx } from "../$main";

const base = await testCtx();
const inWorkspace = (dir: string) => makeRequestCtx(base, { kind: "test", agent: { id: "ab", workspaceDir: dir } } as unknown as Session);

test("a relative path resolves against the agent's workspace", () => {
    const ctx = inWorkspace("/tmp/ws");
    expect(ctx.fns.files.resolveSafe({ path: "src/a.ts" })).toBe("/tmp/ws/src/a.ts");
});

test("an empty path is the workspace itself", () => {
    const ctx = inWorkspace("/tmp/ws");
    expect(ctx.fns.files.resolveSafe({ path: "" })).toBe("/tmp/ws");
});

test("an absolute path passes through untouched", () => {
    const ctx = inWorkspace("/tmp/ws");
    expect(ctx.fns.files.resolveSafe({ path: "/etc/hosts" })).toBe("/etc/hosts");
});

test("`..` DOES escape the workspace — the result is not validated", () => {
    // This is the whole reason the docs had to be corrected: the name promises a
    // check that no longer exists. A caller that needs confinement must do it.
    const ctx = inWorkspace("/tmp/ws/project");
    expect(ctx.fns.files.resolveSafe({ path: "../../../etc/passwd" })).toBe("/etc/passwd");
    expect(ctx.fns.files.resolveSafe({ path: "../sibling/x" })).toBe("/tmp/ws/sibling/x");
});

test("redundant segments are collapsed", () => {
    const ctx = inWorkspace("/tmp/ws");
    expect(ctx.fns.files.resolveSafe({ path: "./a/./b/../c" })).toBe("/tmp/ws/a/c");
});

test("a remote workspace resolves against the local cwd, not the remote dir", () => {
    // The remote directory is not a path on this machine, so joining it here
    // would produce something that exists nowhere.
    const ctx = makeRequestCtx(base, { kind: "test", agent: { id: "ab", workspaceHost: "box", workspaceDir: "/srv/app" } } as unknown as Session);
    expect(ctx.fns.files.resolveSafe({ path: "a.ts" })).toBe(`${process.cwd()}/a.ts`);
});

test("with no agent it falls back to the process cwd", () => {
    const ctx = makeRequestCtx(base, { kind: "test" } as unknown as Session);
    expect(ctx.fns.files.resolveSafe({ path: "a.ts" })).toBe(`${process.cwd()}/a.ts`);
});
