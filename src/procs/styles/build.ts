// Compile one `$style_<name>.css` with Tailwind into a cached file and return
// its path. The input carries theme tokens and rules; this wraps it with the
// framework import, the typography module and an `@source` per scan root — so the
// same file compiles whether it lives in the workspace or in a project under
// WORKDIR, and it is scanned against every class the whole workspace can render.
//
// Both the wrapper and the output live inside this repo (next to node_modules),
// because the Tailwind CLI resolves `tailwindcss` from the input file's
// directory — a style file under WORKDIR could not resolve it on its own. It is
// compiled once per run and cached for the rest of it; `styles.rebuild` forces
// another after a hot reload.
//
// A failed build keeps the site styled: the last good sheet is served and the
// failure is logged, instead of a 500 that leaves every page unstyled.
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

// The Tailwind CLI entry inside the framework's own node_modules, run by the
// SAME bun binary that runs this server (process.execPath). Neither `bunx` nor
// `node` is looked up on PATH: a Homebrew `bunx` ignored `--bun` and started a
// Homebrew node whose libllhttp had been upgraded under it — every *.css
// answered 500 after a restart.
async function tailwindCli(framework: string): Promise<string> {
    const pkgPath = Bun.resolveSync("@tailwindcss/cli/package.json", framework);
    const pkg = await Bun.file(pkgPath).json();
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.tailwindcss;
    if (!bin) throw new Error(`@tailwindcss/cli at ${pkgPath} declares no tailwindcss bin`);
    return join(dirname(pkgPath), bin);
}

/**
 * Compiles one module stylesheet with Tailwind and returns the served CSS file path
 *
 * Wraps a `$style_<name>.css` input with the Tailwind import, the typography plugin and a source line per scanned module root, then runs the Tailwind CLI on the same bun binary as the server (never a node or bunx from PATH). Builds once per process unless forced; a failed rebuild keeps serving the last good stylesheet and logs a warning, and only a first build that fails throws.
 * @param opts.abs Absolute path of the `$style_<name>.css` source file to compile.
 * @param opts.key Stable file-safe identifier of the stylesheet, used for the cached input and output file names.
 * @param opts.force Rebuild even when this process already compiled the stylesheet. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Absolute path of the `$style_<name>.css` source file to compile. */
    abs: string;
    /** Stable file-safe identifier of the stylesheet, used for the cached input and output file names. */
    key: string;
    /** Rebuild even when this process already compiled the stylesheet. @default false */
    force?: boolean;
}): Promise<string> {
    const repo = ctx.fns.procs.project.projectRoot({});
    // What this run already compiled. Not a file check: the sheet is generated
    // from every class in the tree, so one left over from an earlier run is only
    // right by accident — and being right by accident is how a workspace served
    // a stylesheet with no `flex-col-reverse` in it and laid a conversation out
    // sideways. Once per process, and `styles.rebuild` asks for another.
    const record = (ctx.state.procs.styles ?? []).find((s: any) => s.key === opts.key);
    const modules = await ctx.fns.procs.modules.discover({});
    const sources = [...new Set(modules.map((r: any) => r.dir))].map(dir => `@source ${JSON.stringify(dir)};`).join("\n");

    // Tailwind resolves `@import "tailwindcss"` from the INPUT FILE's directory
    // upward — not from the process's cwd — so the generated input lives inside
    // the framework's own package, where the dependency is. Keyed by the app, so
    // two apps built by one framework never share a file.
    const framework = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
    const dir = `${framework}/.runtime-tw/${repo.split("/").pop()}`;
    await mkdir(dir, { recursive: true });
    const input = `${dir}/${opts.key}.in.css`;
    const output = `${dir}/${opts.key}.css`;
    // `@plugin`, not `@module`: the latter is not a Tailwind directive, so it
    // compiled to nothing and every `prose` class in the tree — the chat's
    // markdown, the file browser's — had no rules behind it.
    // Tailwind and Typography provide utilities and prose styling. Application
    // components and light/dark tokens live in $style_app.css so the project has
    // no external component-theme runtime or generated component layer.
    const wrapper = `@import "tailwindcss";\n@plugin "@tailwindcss/typography";\n${sources}\n@import ${JSON.stringify(opts.abs)};\n`;
    if (!opts.force && record?.built === output && await Bun.file(output).exists()) return output;
    await Bun.write(input, wrapper);

    // Tailwind resolves `@import "tailwindcss"` from the input file's directory
    // upward, so the build runs where the dependency actually is — the framework's
    // own package. (An app that installs procs has it hoisted above both, and an
    // app whose node_modules is elsewhere would otherwise fail with "can't
    // resolve tailwindcss" and no stylesheet at all.)
    // Running on bun (not a node from PATH) also means the native lightningcss
    // it loads is the one bun installed, for bun's own architecture.
    // The CLI writes to a temp file renamed over the output only on success, so
    // a broken build never replaces the last good sheet.
    const temp = `${output}.${process.pid}.tmp`;
    let failure = "";
    try {
        const proc = Bun.spawn([process.execPath, await tailwindCli(framework), "-i", input, "-o", temp, "--minify"], { cwd: framework, stdout: "pipe", stderr: "pipe", env: { ...process.env, BUN_BE_BUN: "1" } });
        const err = await new Response(proc.stderr).text();
        if (await proc.exited !== 0 || !(await Bun.file(temp).exists())) failure = err.trim() || "no output written";
        else await rename(temp, output);
    } catch (error: any) {
        failure = String(error?.message ?? error);
    }
    if (failure) {
        await Bun.file(temp).delete().catch(() => undefined);
        const message = `tailwind build failed for ${opts.abs}:\n${failure}`;
        if (!(await Bun.file(output).exists())) throw new Error(message);
        ctx.fns.procs.log.warn({ event: "styles.build", msg: `${message}\nserving the last good stylesheet ${output}` });
        return output;
    }
    if (record) record.built = output;
    return output;
}
