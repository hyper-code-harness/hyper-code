// Run tsgo (or tsc) --noEmit over the project and return diagnostics. The runtime
// (Bun.Transpiler) only STRIPS types — def/sync catch syntax errors but not
// type errors. This is the missing half: call after defining typed code.
//   ctx.fns.procs.dev.typecheck({})            → whole project
//   ctx.fns.procs.dev.typecheck({ filter: "notes/" }) → only matching diagnostics
import { dirname, join } from "node:path";

// The TypeScript compiler from the app's own node_modules (falling back to the
// framework's), run by the SAME bun binary as this server. Neither `bunx` nor
// `node` is looked up on PATH: a Homebrew bunx/node broken by an upgrade must
// not take type checking down with it (the styles build had that incident).
async function tscPath(root: string): Promise<string> {
    const framework = new URL("../../..", import.meta.url).pathname;
    // Explicit node_modules paths, not Bun.resolveSync: outside a package bun
    // auto-installs a missing module from its global cache — a different, maybe
    // unrunnable TypeScript than the one package.json pins.
    let pkgPath = "";
    for (const from of [root, framework]) {
        const candidate = join(from, "node_modules", "typescript", "package.json");
        if (await Bun.file(candidate).exists()) { pkgPath = candidate; break; }
    }
    if (!pkgPath) throw new Error(`typescript is not installed in ${root} or ${framework}`);
    const pkg = await Bun.file(pkgPath).json();
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.tsc;
    if (!bin) throw new Error(`typescript at ${pkgPath} declares no tsc bin`);
    return join(dirname(pkgPath), bin);
}

// tsgo — the native TypeScript compiler (@typescript/native-preview) — checks this
// project in ~0.65 s where tsc takes ~3.4 s, with the same diagnostics. Its npm `bin`
// is a node shim, so we run the platform binary itself, again never through PATH.
// null when the platform package is not installed: the caller falls back to tsc.
async function tsgoPath(root: string): Promise<string | null> {
    const framework = new URL("../../..", import.meta.url).pathname;
    for (const from of [root, framework]) {
        const exe = join(from, "node_modules", "@typescript", `native-preview-${process.platform}-${process.arch}`, "lib", process.platform === "win32" ? "tsgo.exe" : "tsgo");
        if (await Bun.file(exe).exists()) return exe;
    }
    return null;
}

type Run = { out: string[]; err: string; code: number };
async function run(cmd: string[], root: string): Promise<Run> {
    const proc = Bun.spawn(cmd, { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, BUN_BE_BUN: "1" } });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { out: out.split('\n').filter(l => l.trim()), err, code };
}
// A compiler exits non-zero when it found diagnostics. A non-zero exit without a
// single `error TSnnnn` line means the compiler itself did not run — that must not
// read as clean, nor pass its output off as diagnostics (tsgo without a tsconfig
// prints its help to stdout and exits 1).
const failed = (r: Run) => r.code !== 0 && !r.out.some(l => /error TS\d+/.test(l));

/**
 * Type-checks the whole project and returns the diagnostics
 *
 * Runs tsgo (the native TypeScript compiler, ~5x faster) or `tsc --noEmit` from the project's node_modules — never a node, bunx or tsc from PATH — against the app root tsconfig. Use after writing typed code: the runtime only strips types, so type errors surface only here. `auto` uses tsgo when its platform binary is installed and falls back to tsc when it is missing or cannot run. A compiler that cannot run at all is reported as a failure, never as a clean result.
 * @param opts.filter Keep only diagnostic lines containing this text, such as a project-relative path like "notes/".
 * @param opts.engine Compiler to use: tsgo, tsc, or auto (tsgo with a tsc fallback). @default auto
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Keep only diagnostic lines containing this text, such as a project-relative path like "notes/". */
    filter?: string;
    /** Compiler to use: tsgo, tsc, or auto (tsgo with a tsc fallback). @default auto */
    engine?: "auto" | "tsgo" | "tsc";
}): Promise<{ ok: boolean; errors: string[]; engine: "tsgo" | "tsc" }> {
    const root = ctx.fns.procs.project.projectRoot({}); // the app's root (its tsconfig), not proc's
    const engine = opts?.engine ?? "auto";
    let used: "tsgo" | "tsc" = "tsc";
    let result: Run | null = null;
    let tsgoFailure = "";
    if (engine !== "tsc") {
        const exe = await tsgoPath(root);
        if (exe) {
            const r = await run([exe, "--noEmit", "--pretty", "false"], root);
            if (!failed(r)) { result = r; used = "tsgo"; }
            else tsgoFailure = `tsgo failed to run (exit ${r.code}): ${(r.err.trim() || r.out.slice(0, 5).join(" ") || "no output").slice(0, 2000)}`;
        } else tsgoFailure = "tsgo is not installed";
        if (engine === "tsgo" && !result) return { ok: false, errors: [tsgoFailure], engine: "tsgo" };
    }
    if (!result) {
        const r = await run([process.execPath, await tscPath(root), "--noEmit", "--pretty", "false"], root);
        if (failed(r)) return { ok: false, errors: [`tsc failed to run (exit ${r.code}): ${(r.err.trim() || r.out.slice(0, 5).join(" ") || "no output").slice(0, 2000)}`, ...(tsgoFailure ? [tsgoFailure] : [])], engine: "tsc" };
        result = r;
    }
    const lines = opts?.filter ? result.out.filter(l => l.includes(opts.filter!)) : result.out;
    return { ok: lines.length === 0, errors: lines, engine: used };
}
