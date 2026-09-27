/** Resolves the absolute path of the local LiteParse `lit` executable.
 * Honours the LITEPARSE_BIN environment variable first, then the uv/pip user bin directory,
 * the Cargo bin directory, Homebrew, and finally the login shell PATH. Use before calling
 * pdf.needsOcr or pdf.parseLite to check that LiteParse is installed; returns null when it is not.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    _opts: {},
): Promise<string | null> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const exists = async (candidate: string) => await fs.access(candidate).then(() => true, () => false);
    const configured = ctx.env.LITEPARSE_BIN;
    if (configured && (await exists(configured))) return configured;
    const home = process.env.HOME;
    const candidates = [
        home ? path.join(home, ".local/bin/lit") : null,
        home ? path.join(home, ".cargo/bin/lit") : null,
        "/opt/homebrew/bin/lit",
        "/usr/local/bin/lit",
    ].filter((candidate): candidate is string => Boolean(candidate));
    for (const candidate of candidates) if (await exists(candidate)) return candidate;
    const which = Bun.spawn(["/bin/sh", "-lc", "command -v lit"], { stdout: "pipe", stderr: "ignore" });
    const [found] = await Promise.all([new Response(which.stdout).text(), which.exited]);
    const resolved = found.trim().split("\n")[0];
    return resolved && (await exists(resolved)) ? resolved : null;
}
