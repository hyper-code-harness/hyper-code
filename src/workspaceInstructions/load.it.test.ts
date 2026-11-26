import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkTestCtx } from "../_testCtx.entry";

let ctx: Context;
let root: string;
let serial = 0;
beforeAll(async () => {
    ctx = await mkTestCtx();
    root = await mkdtemp(join(tmpdir(), "hyper-instructions-"));
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
async function fixture() {
    const base = join(root, String(++serial)), dir = join(base, "repo"), globalDir = join(base, "global");
    await mkdir(dir, { recursive: true }); await mkdir(globalDir);
    return { base, dir, globalDir };
}
const included = (s: types.workspaceInstructions.InstructionsSnapshot) => s.sources.filter(r => r.status === "loaded" || r.status === "truncated").map(r => r.content);
const project = (s: types.workspaceInstructions.InstructionsSnapshot) => s.sources.filter(r => r.scope === "project");
type RemoteOpts = { host: string; command: string; stdin?: string; timeout?: number; maxOutput?: number };
type RemoteResult = { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; ms: number };
// Keep the production loader on the real procedure proxy, replacing only its transport.
async function withRemote(fn: (o: RemoteOpts) => Promise<RemoteResult>, run: () => Promise<void>) {
    const registry = (ctx.state as any).registry;
    const original = registry.remote.exec;
    registry.remote.exec = async (_ctx: Context, _session: Session | null, opts: RemoteOpts) => fn(opts);
    try { await run(); } finally { registry.remote.exec = original; }
}
const reply = (stdout: string, extra: Partial<RemoteResult> = {}): RemoteResult => ({ stdout, stderr: "", exitCode: 0, timedOut: false, ms: 1, ...extra });

async function executePython(o: RemoteOpts, home?: string, cwd?: string): Promise<RemoteResult> {
    const child = Bun.spawn(["bash", "-c", o.command], { stdin: "pipe", stdout: "pipe", stderr: "pipe", cwd, env: { ...process.env, ...(home ? { HOME: home } : {}) } });
    child.stdin.write(o.stdin ?? ""); await child.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe("");
    return reply(stdout, { stderr, exitCode });
}

describe("workspaceInstructions.load local discovery", () => {
    test("nearest lexical .git boundary, root-to-cwd order, global/project separation", async () => {
        const { base, dir, globalDir } = await fixture();
        const cwd = join(dir, "packages", "app"); await mkdir(cwd, { recursive: true }); await mkdir(join(dir, ".git"));
        await writeFile(join(base, "AGENTS.md"), "outside");
        await writeFile(join(globalDir, "AGENTS.md"), "same");
        await writeFile(join(globalDir, "CLAUDE.md"), "global B");
        await writeFile(join(dir, "AGENTS.md"), "same");
        await writeFile(join(dir, "packages", "CLAUDE.md"), "middle");
        await writeFile(join(cwd, "AGENTS.md"), "specific");
        const got = await ctx.fns.workspaceInstructions.load({ dir: cwd, globalDir });
        expect(got.root).toBe(dir); expect(got.dir).toBe(cwd); expect(got.host).toBe("");
        expect(included(got)).toEqual(["same", "global B", "same", "middle", "specific"]);
        expect(got.warnings).toEqual([]);
    });
    test(".git regular worktree file stops at nearest boundary", async () => {
        const { dir, globalDir } = await fixture();
        const nested = join(dir, "worktree", "src"); await mkdir(nested, { recursive: true }); await mkdir(join(dir, ".git"));
        await writeFile(join(dir, "AGENTS.md"), "outer");
        await writeFile(join(dir, "worktree", ".git"), "gitdir: /not/read/by/loader");
        await writeFile(join(dir, "worktree", "CLAUDE.md"), "worktree");
        const got = await ctx.fns.workspaceInstructions.load({ dir: nested, globalDir });
        expect(got.root).toBe(join(dir, "worktree")); expect(included(got)).toEqual(["worktree"]);
    });
    test("no marker uses cwd only; override/local names never load", async () => {
        const { base, dir, globalDir } = await fixture();
        await writeFile(join(base, "AGENTS.md"), "outside");
        await writeFile(join(dir, "AGENTS.md"), "cwd");
        await writeFile(join(dir, "AGENTS.override.md"), "not approved");
        await writeFile(join(dir, "CLAUDE.local.md"), "not approved");
        const got = await ctx.fns.workspaceInstructions.load({ dir, globalDir });
        expect(got.root).toBe(dir); expect(included(got)).toEqual(["cwd"]);
    });
    test("distinct pair loads both; trimmed identical/whitespace pair deduplicates only within directory", async () => {
        const { dir, globalDir } = await fixture(); const child = join(dir, "nested");
        await mkdir(child); await mkdir(join(dir, ".git"));
        await writeFile(join(globalDir, "AGENTS.md"), "first");
        await writeFile(join(globalDir, "CLAUDE.md"), "second");
        await writeFile(join(dir, "AGENTS.md"), " \n shared\n ");
        await writeFile(join(dir, "CLAUDE.md"), "\ufeffshared\u00a0");
        await writeFile(join(child, "AGENTS.md"), "shared");
        await writeFile(join(child, "CLAUDE.md"), "shared\n");
        const got = await ctx.fns.workspaceInstructions.load({ dir: child, globalDir });
        expect(included(got)).toEqual(["first", "second", "shared", "shared"]);
        expect(got.sources.filter(r => r.status === "duplicate").map(r => r.directory)).toEqual([dir, child]);
        expect(got.sources.filter(r => r.status === "duplicate").every(r => r.bytes === 0 && r.content === "" && r.duplicateOf?.endsWith("AGENTS.md"))).toBe(true);
        await writeFile(join(dir, "AGENTS.md"), " \r\n "); await writeFile(join(dir, "CLAUDE.md"), "\t");
        const blank = await ctx.fns.workspaceInstructions.load({ dir, globalDir });
        expect(project(blank).map(r => [r.status, r.content, r.bytes])).toEqual([["loaded", "", 0], ["duplicate", "", 0]]);
    });
    test("instruction symlinks deduplicate; broken symlink is visible as omitted with bounded warning", async () => {
        const { dir, globalDir } = await fixture();
        await writeFile(join(dir, "AGENTS.md"), "canonical"); await symlink("AGENTS.md", join(dir, "CLAUDE.md"));
        let got = await ctx.fns.workspaceInstructions.load({ dir, globalDir });
        expect(project(got).map(r => r.status)).toEqual(["loaded", "duplicate"]);
        await rm(join(dir, "CLAUDE.md")); await symlink("absent", join(dir, "CLAUDE.md"));
        got = await ctx.fns.workspaceInstructions.load({ dir, globalDir });
        expect(project(got).map(r => r.status)).toEqual(["loaded", "omitted"]);
        expect(got.warnings.join(" ")).toContain("CLAUDE.md"); expect(got.warnings.join(" ")).not.toContain("canonical");
    });
    test("symlink targets must stay in the canonical directory scope, including on remote", async () => {
        const { base, dir, globalDir } = await fixture(); const inner = join(dir, "instructions"); await mkdir(inner);
        await writeFile(join(base, "private.txt"), "PRIVATE OUTSIDE FILE");
        await writeFile(join(inner, "shared.md"), "allowed descendant");
        await symlink(join(base, "private.txt"), join(dir, "AGENTS.md"));
        await symlink(join(inner, "shared.md"), join(dir, "CLAUDE.md"));
        await symlink(join(inner, "shared.md"), join(globalDir, "AGENTS.md"));
        const local = await ctx.fns.workspaceInstructions.load({ dir, globalDir });
        expect(included(local)).toEqual(["allowed descendant"]);
        expect(local.sources.map(r => r.status)).toEqual(["omitted", "omitted", "loaded"]);
        expect(local.warnings.every(w => w.includes("symlink target escapes"))).toBe(true);
        expect(JSON.stringify(local)).not.toContain("PRIVATE OUTSIDE FILE");
        await withRemote(o => executePython(o), async () => {
            const remote = await ctx.fns.workspaceInstructions.load({ dir, globalDir, host: "mock-host" });
            expect({ ...remote, host: "" }).toEqual(local);
        });
    });
    test("symlink cwd preserves lexical ancestors instead of scanning target parents", async () => {
        const { base, dir, globalDir } = await fixture();
        const elsewhere = join(base, "elsewhere"), target = join(elsewhere, "app"), alias = join(dir, "alias");
        await mkdir(target, { recursive: true }); await mkdir(join(elsewhere, ".git"));
        await writeFile(join(elsewhere, "AGENTS.md"), "must not load target ancestor");
        await writeFile(join(target, "AGENTS.md"), "cwd file"); await symlink(target, alias);
        const got = await ctx.fns.workspaceInstructions.load({ dir: alias, globalDir });
        expect(got.dir).toBe(alias); expect(got.root).toBe(alias); expect(included(got)).toEqual(["cwd file"]);
    });
    test("tracked nested files add only applicable ancestors; outside paths and symlink directories ignored", async () => {
        const { base, dir, globalDir } = await fixture(); const sub = join(dir, "packages", "one"), other = join(dir, "packages", "two");
        await mkdir(sub, { recursive: true }); await mkdir(other); const external = join(base, "external"); await mkdir(external);
        await writeFile(join(dir, "AGENTS.md"), "root"); await writeFile(join(dir, "packages", "CLAUDE.md"), "packages");
        await writeFile(join(sub, "AGENTS.md"), "one"); await writeFile(join(other, "AGENTS.md"), "two not tracked");
        await writeFile(join(external, "AGENTS.md"), "external not tracked"); await symlink(external, join(dir, "escape"));
        const got = await ctx.fns.workspaceInstructions.load({ dir, globalDir, paths: [join(sub, "file.ts"), join(sub, "other.ts"), join(external, "file.ts"), join(dir, "escape", "file.ts"), "packages/two/file.ts"] });
        expect(included(got)).toEqual(["root", "packages", "one"]);
        expect(project(got).map(r => r.directory)).toEqual([dir, join(dir, "packages"), sub]);
        expect(got.warnings.join(" ")).toContain("Nested symlink");
    });
    test("missing paths are quiet; I/O errors, nonregular files, invalid UTF-8 and >1MiB files are actionable", async () => {
        const { dir, globalDir } = await fixture();
        expect((await ctx.fns.workspaceInstructions.load({ dir, globalDir })).sources).toEqual([]);
        await mkdir(join(globalDir, "AGENTS.md")); await writeFile(join(globalDir, "CLAUDE.md"), Buffer.from([0xff, 0xfe]));
        await writeFile(join(dir, "AGENTS.md"), "x".repeat(1048577));
        await writeFile(join(dir, "CLAUDE.md"), "SECRET FILE CONTENT"); await chmod(join(dir, "CLAUDE.md"), 0);
        try {
            const got = await ctx.fns.workspaceInstructions.load({ dir, globalDir });
            expect(got.sources.filter(r => r.status === "omitted").length).toBe(process.getuid?.() === 0 ? 3 : 4);
            expect(got.warnings.join(" ")).toContain("non-regular"); expect(got.warnings.join(" ")).toContain("invalid UTF-8");
            expect(got.warnings.join(" ")).toContain("1 MiB"); expect(got.warnings.join(" ")).not.toContain("SECRET FILE CONTENT");
            if (process.getuid?.() !== 0) expect(got.warnings.join(" ")).toContain("EACCES");
        } finally { await chmod(join(dir, "CLAUDE.md"), 0o600); }
    });
    test("FIFO and symlink to FIFO never block", async () => {
        const { dir, globalDir } = await fixture();
        const fifo = join(dir, "pipe"); const child = Bun.spawn(["mkfifo", fifo], { stdout: "ignore", stderr: "pipe" }); expect(await child.exited).toBe(0);
        await symlink("pipe", join(dir, "AGENTS.md")); await symlink("pipe", join(dir, "CLAUDE.md"));
        const started = Date.now(); const got = await ctx.fns.workspaceInstructions.load({ dir, globalDir });
        expect(Date.now() - started).toBeLessThan(2000); expect(project(got).map(r => r.status)).toEqual(["omitted", "omitted"]);
    });
    test("specific text gets budget first but output remains broad to specific; UTF-8 is not split", async () => {
        const { dir, globalDir } = await fixture(); const nested = join(dir, "nested"); await mkdir(nested); await mkdir(join(dir, ".git"));
        await writeFile(join(globalDir, "AGENTS.md"), "GLOBAL");
        await writeFile(join(dir, "AGENTS.md"), "ééé"); await writeFile(join(dir, "CLAUDE.md"), "ignored broad");
        await writeFile(join(nested, "AGENTS.md"), "hi");
        const got = await ctx.fns.workspaceInstructions.load({ dir: nested, globalDir, maxBytes: 5 });
        expect(got.sources.map(r => [r.content, r.status, r.bytes])).toEqual([["GLOBA", "truncated", 5], ["é", "truncated", 2], ["i", "truncated", 1], ["hi", "loaded", 2]]);
        expect(got.warnings.some(w => w.includes("Truncated"))).toBe(true);
        const exhausted = await ctx.fns.workspaceInstructions.load({ dir: nested, globalDir, maxBytes: 2 });
        expect(project(exhausted).map(r => r.status)).toEqual(["omitted", "omitted", "loaded"]);
        expect(exhausted.warnings.some(w => w.includes("Omitted") && w.includes("budget"))).toBe(true);
    });
    test("defaults cap each global/project chain independently at 64KiB", async () => {
        const { dir, globalDir } = await fixture();
        await writeFile(join(dir, "AGENTS.md"), "p".repeat(65537)); await writeFile(join(globalDir, "AGENTS.md"), "g".repeat(65537));
        const got = await ctx.fns.workspaceInstructions.load({ dir, globalDir });
        expect(got.sources.map(r => [r.status, r.bytes])).toEqual([["truncated", 65536], ["truncated", 65536]]);
        await expect(ctx.fns.workspaceInstructions.load({ dir, globalDir, maxBytes: 65537 })).rejects.toThrow("maxBytes");
        await expect(ctx.fns.workspaceInstructions.load({ dir, globalDir, maxBytes: -1 })).rejects.toThrow("maxBytes");
    });
    test("64 tracked paths and 32 warnings are hard caps", async () => {
        const { dir, globalDir } = await fixture(); const paths: string[] = [];
        for (let i = 0; i < 65; i++) {
            const sub = join(dir, String(i)); await mkdir(sub); await symlink("missing", join(sub, "AGENTS.md")); paths.push(join(sub, "file.ts"));
        }
        const got = await ctx.fns.workspaceInstructions.load({ dir, globalDir, paths });
        expect(got.sources).toHaveLength(64); expect(got.sources.some(r => r.directory === join(dir, "64"))).toBe(false);
        expect(got.warnings).toHaveLength(32); expect(got.warnings[0]).toContain("capped at 64"); expect(got.warnings[31]).toContain("Additional");
    });
    test("ancestor and nested discovery stop at 128 directories without reading outside known boundaries", async () => {
        const { dir, globalDir } = await fixture();
        const deep = join(dir, ...Array.from({ length: 130 }, () => "d")); await mkdir(deep, { recursive: true });
        await mkdir(join(dir, ".git")); await writeFile(join(dir, "AGENTS.md"), "too distant root"); await writeFile(join(deep, "AGENTS.md"), "deep cwd");
        const ancestor = await ctx.fns.workspaceInstructions.load({ dir: deep, globalDir });
        expect(ancestor.root).toBe(deep); expect(included(ancestor)).toEqual(["deep cwd"]); expect(ancestor.warnings.join(" ")).toContain("depth 128");
        const nested = await ctx.fns.workspaceInstructions.load({ dir, globalDir, paths: [join(deep, "file.ts")] });
        expect(included(nested)).toEqual(["too distant root"]); expect(nested.warnings.join(" ")).toContain("depth 128");
        const maximum = join(dir, ...Array.from({ length: 128 }, () => "d")); await writeFile(join(maximum, "AGENTS.md"), "beyond total scope cap");
        const bounded = await ctx.fns.workspaceInstructions.load({ dir, globalDir, paths: [join(maximum, "file.ts")] });
        expect(included(bounded)).toEqual(["too distant root"]); expect(bounded.warnings.join(" ")).toContain("directories capped at 128");
    });
    test("overlong path diagnostics remain individually bounded", async () => {
        const { dir, globalDir } = await fixture();
        const got = await ctx.fns.workspaceInstructions.load({ dir: join(dir, "long".repeat(600)), globalDir });
        expect(got.warnings.length).toBeGreaterThan(0); expect(got.warnings.every(w => Buffer.byteLength(w) <= 1024)).toBe(true);
        await expect(ctx.fns.workspaceInstructions.load({ dir, globalDir, host: "a".repeat(257) })).rejects.toThrow("host");
    });
    test("JSON output is capped even when control characters expand encoding", async () => {
        const { dir, globalDir } = await fixture();
        await writeFile(join(dir, "AGENTS.md"), "\u0001".repeat(65536)); await writeFile(join(globalDir, "AGENTS.md"), "\u0002".repeat(65536));
        const got = await ctx.fns.workspaceInstructions.load({ dir, globalDir });
        expect(Buffer.byteLength(JSON.stringify({ version: 1, snapshot: got }))).toBeLessThanOrEqual(262144);
        expect(got.warnings.join(" ")).toContain("output capped");
    });
});

describe("workspaceInstructions.load remote protocol", () => {
    test("one fixed Python call sends paths as stdin JSON and uses explicit timeout/output limits", async () => {
        const { dir, globalDir } = await fixture(); let calls = 0;
        const hostile = join(dir, "a'; echo REPO_COMMAND_EXECUTED; #"); await mkdir(hostile); await writeFile(join(hostile, "AGENTS.md"), "remote content");
        await withRemote(async o => {
            calls++; expect(o.host).toBe("mock-host"); expect(o.timeout).toBeLessThanOrEqual(15); expect(o.maxOutput).toBe(262144);
            expect(o.command).toStartWith("python3 -I -c '"); expect(o.command).not.toContain(hostile); expect(JSON.parse(o.stdin!).dir).toBe(hostile);
            return executePython(o);
        }, async () => {
            const got = await ctx.fns.workspaceInstructions.load({ dir: hostile, globalDir, host: "mock-host" });
            expect(got.host).toBe("mock-host"); expect(included(got)).toEqual(["remote content"]); expect(got.warnings).toEqual([]);
        });
        expect(calls).toBe(1);
    });
    test("isolated Python never imports modules from the workspace", async () => {
        const { dir, globalDir } = await fixture();
        await writeFile(join(dir, "json.py"), "raise RuntimeError('REPOSITORY_CODE_EXECUTED')");
        await writeFile(join(dir, "AGENTS.md"), "safe instructions");
        await withRemote(o => executePython(o, undefined, dir), async () => {
            const got = await ctx.fns.workspaceInstructions.load({ dir, globalDir, host: "mock-host" });
            expect(included(got)).toEqual(["safe instructions"]); expect(got.warnings).toEqual([]);
        });
    });
    test("Python collector matches local ordering, directory dedup, malformed bytes and budgets", async () => {
        const { dir, globalDir } = await fixture(); const child = join(dir, "nested"); await mkdir(child); await mkdir(join(dir, ".git"));
        await writeFile(join(dir, "AGENTS.md"), "broad text"); await symlink("AGENTS.md", join(dir, "CLAUDE.md"));
        await writeFile(join(child, "AGENTS.md"), "\ufeffééé\u00a0"); await writeFile(join(child, "CLAUDE.md"), "ééé");
        await writeFile(join(globalDir, "AGENTS.md"), "global"); await writeFile(join(globalDir, "CLAUDE.md"), Buffer.from([0xff]));
        const args = { dir, globalDir, paths: [join(child, "file.ts")], maxBytes: 7 };
        const local = await ctx.fns.workspaceInstructions.load(args);
        await withRemote(o => executePython(o), async () => {
            const remote = await ctx.fns.workspaceInstructions.load({ ...args, host: "mock-host" });
            expect({ ...remote, host: "" }).toEqual(local);
        });
    });
    test("remote default globals use remote HOME, not server HOME", async () => {
        const { base, dir } = await fixture(); const remoteHome = join(base, "home"); await mkdir(join(remoteHome, ".hyper"), { recursive: true });
        await writeFile(join(remoteHome, ".hyper", "AGENTS.md"), "remote global only");
        await withRemote(o => executePython(o, remoteHome), async () => {
            const got = await ctx.fns.workspaceInstructions.load({ dir, host: "mock-host" });
            expect(got.sources.map(r => r.directory)).toEqual([join(remoteHome, ".hyper")]); expect(included(got)).toEqual(["remote global only"]);
        });
    });
    test("transport failure, timeout, malformed/oversized protocol never fall back to local files or expose stderr", async () => {
        const { dir, globalDir } = await fixture(); await writeFile(join(dir, "AGENTS.md"), "LOCAL SECRET");
        const cases = [reply("", { exitCode: 127, stderr: "SECRET STDERR" }), reply("", { timedOut: true }), reply("not json"), reply("x".repeat(262145)), reply(JSON.stringify({ version: 1, snapshot: { dir, root: dir, host: "mock-host", sources: [{ path: "/bad", content: "SECRET" }], warnings: [] } }))];
        for (const response of cases) await withRemote(async () => response, async () => {
            const got = await ctx.fns.workspaceInstructions.load({ dir, globalDir, host: "mock-host" });
            expect(got.sources).toEqual([]); expect(got.warnings.length).toBeGreaterThan(0); expect(JSON.stringify(got)).not.toContain("SECRET");
        });
        await withRemote(async () => { throw new Error("SECRET TRANSPORT"); }, async () => {
            const got = await ctx.fns.workspaceInstructions.load({ dir, globalDir, host: "mock-host" }); expect(got.sources).toEqual([]); expect(JSON.stringify(got)).not.toContain("SECRET");
        });
    });
});
