// Run tsc --noEmit over the project and return diagnostics. The runtime
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

/**
 * Type-checks the whole project with tsc and returns the diagnostics
 *
 * Runs `tsc --noEmit` from the project's node_modules on the server's own bun (never a node or bunx from PATH) against the app root tsconfig. Use after writing typed code: the runtime only strips types, so type errors surface only here. A compiler that cannot run at all is reported as a failure, never as a clean result.
 * @param opts.filter Keep only diagnostic lines containing this text, such as a project-relative path like "notes/".
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Keep only diagnostic lines containing this text, such as a project-relative path like "notes/". */
    filter?: string;
}): Promise<{ ok: boolean; errors: string[] }> {
    const root = ctx.fns.procs.project.projectRoot({}); // the app's root (its tsconfig), not proc's
    const proc = Bun.spawn([process.execPath, await tscPath(root), "--noEmit", "--pretty", "false"], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, BUN_BE_BUN: "1" },
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    const all = out.split('\n').filter(l => l.trim());
    // tsc exits 1/2 when it found diagnostics. A non-zero exit with none on
    // stdout means the compiler itself did not run — that must not read as
    // "no type errors".
    if (code !== 0 && all.length === 0) return { ok: false, errors: [`tsc failed to run (exit ${code}): ${(err.trim() || "no output").slice(0, 2000)}`] };
    const lines = opts?.filter ? all.filter(l => l.includes(opts.filter!)) : all;
    return { ok: lines.length === 0, errors: lines };
}
