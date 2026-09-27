import { join } from "node:path";

/**
 * Locates the tsgo (TypeScript 7 native preview) executable for this platform.
 *
 * Checks TSGO_BIN first, then the platform package installed next to
 * `@typescript/native-preview` in the project's node_modules. Returns null when
 * tsgo is not installed, so callers can fall back to the in-process TypeScript
 * service.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<string | null> {
    const fromEnv = String(ctx.env.TSGO_BIN ?? "").trim();
    if (fromEnv) return (await Bun.file(fromEnv).exists()) ? fromEnv : null;
    const root = ctx.fns.procs.project.projectRoot({});
    const exe = process.platform === "win32" ? "tsgo.exe" : "tsgo";
    const bin = join(root, "node_modules", "@typescript", `native-preview-${process.platform}-${process.arch}`, "lib", exe);
    return (await Bun.file(bin).exists()) ? bin : null;
}
