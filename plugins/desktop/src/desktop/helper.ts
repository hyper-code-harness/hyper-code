import path from "node:path";
import { mkdir, stat } from "node:fs/promises";

/**
 * Runs one command of the native desktop helper and returns its parsed JSON output.
 *
 * Low-level bridge to the plugin's Swift helper (script/desktop-helper.swift), compiled on first use into plugins/desktop/.build and rebuilt when the source changes. Commands: check, apps, windows, tree, action, set, activate, click, move, scroll, type, key, cursor. macOS only. Prefer the typed wrappers such as desktop.snapshot, desktop.press or desktop.click.
 * @param opts.args Helper command followed by its positional string arguments, e.g. ["tree", "Finder", "f", "12", "400"].
 * @param opts.timeoutMs Kill the helper after this many milliseconds. @default 15000 @minimum 1000 @maximum 120000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Helper command followed by its positional string arguments, e.g. ["tree", "Finder", "f", "12", "400"]. */
        args: string[];
        /** Kill the helper after this many milliseconds. @default 15000 @minimum 1000 @maximum 120000 */
        timeoutMs?: number;
    },
): Promise<Record<string, unknown>> {
    if (process.platform !== "darwin") throw new Error("desktop: macOS only");
    const root = path.join(import.meta.dir, "..", "..");
    const src = path.join(root, "script", "desktop-helper.swift");
    const bin = path.join(root, ".build", "desktop-helper");
    const [s, b] = await Promise.all([stat(src), stat(bin).catch(() => null)]);
    if (!b || b.mtimeMs < s.mtimeMs) {
        await mkdir(path.dirname(bin), { recursive: true });
        const c = await Bun.$`swiftc -O -o ${bin} ${src}`.quiet().nothrow();
        if (c.exitCode !== 0) throw new Error(`desktop: swiftc failed: ${c.stderr.toString().slice(0, 2000)}`);
    }
    const proc = Bun.spawn([bin, ...opts.args], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), opts.timeoutMs ?? 15000);
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(stdout.trim().split("\n").pop() || "{}"); }
    catch { throw new Error(`desktop: helper ${opts.args[0]} returned non-JSON (exit ${proc.exitCode}): ${(stdout + stderr).slice(0, 500)}`); }
    if (typeof parsed.error === "string") throw new Error(`desktop.${opts.args[0]}: ${parsed.error}`);
    return parsed;
}
