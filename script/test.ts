// Runs one kind of tests. The kind is in the file name:
//
//   *.test.ts        fast         code, stubs, the test Postgres — run on every change
//   *.it.test.ts     integration  real processes: git, docker sshd, tsgo, duckdb, headless Chrome
//   *.live.test.ts   live         the real network and real accounts — only on demand
//
//   bun script/test.ts [fast|it|live|all] [bun test flags…] [paths…]
//
// "all" = fast + it (never live). Paths default to src, plugins and script. The files are
// listed here and passed to bun explicitly, so bun never walks the tree itself.
// code.runTests (the Tests page) starts this same script.

import { Glob } from "bun";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const KINDS = ["fast", "it", "live", "all"] as const;
export type Kind = typeof KINDS[number];

const ROOT = resolve(import.meta.dir, "..");

export function kindOf(file: string): "fast" | "it" | "live" {
    return file.endsWith(".live.test.ts") ? "live" : file.endsWith(".it.test.ts") ? "it" : "fast";
}

export function testFiles(kind: Kind, paths: string[] = ["src", "plugins", "script"]): string[] {
    const want = (f: string) => kind === "all" ? kindOf(f) !== "live" : kindOf(f) === kind;
    const out: string[] = [];
    for (const p of paths) {
        const abs = resolve(ROOT, p);
        if (!existsSync(abs)) continue;
        if (statSync(abs).isFile()) { if (want(p)) out.push(p); continue; }
        for (const f of new Glob("**/*.test.{ts,tsx}").scanSync({ cwd: abs })) {
            if (f.split("/").some(seg => seg === "node_modules" || seg.startsWith("."))) continue;
            const rel = `${p.replace(/\/$/, "")}/${f}`;
            if (want(rel)) out.push(rel);
        }
    }
    return out.sort();
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const kind = (KINDS as readonly string[]).includes(args[0]!) ? args.shift() as Kind : "fast";
    const flags = args.filter(a => a.startsWith("-"));
    const paths = args.filter(a => !a.startsWith("-"));
    const files = testFiles(kind, paths.length ? paths : undefined);
    if (!files.length) { console.error(`no ${kind} tests under ${paths.join(" ") || "src plugins script"}`); process.exit(0); }
    const p = Bun.spawn({
        cmd: ["bun", "test", "--parallel=16", "--no-isolate", ...flags, ...files.map(f => "./" + f)],
        cwd: ROOT, stdio: ["inherit", "inherit", "inherit"],
    });
    process.exit(await p.exited);
}
