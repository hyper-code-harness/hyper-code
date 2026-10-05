// Build-time equivalent of the scan. Dev discovers the file list at runtime and
// imports each file dynamically — un-bundleable by design, which is what powers
// hot reload. This freezes the same list into an EXPLICIT static import graph a
// bundler can follow: every entry keeps the fields the scan gave it, plus `fn`,
// the default export, and `mod`, the whole module — a loader that reads a named
// export (such as a fence's `hint`) has no dynamic import to fall back on here.
//
// What it does NOT do any more is decide what any of those files MEAN — that is
// `boot.apply`, the same code the dev boot runs. One implementation, two worlds.
//   ctx.fns.procs.dev.manifest({ out: ".runtime/build/manifest.ts" })
import { resolve, relative } from "node:path";

/**
 * Generate manifest for the dev subsystem.
 * @param opts.out The out value used by the operation.
 */
export default async function (ctx: Context, _session: Session | null, opts?: { out?: string }) {
    const entries = await ctx.fns.procs.project.scan({});
    const modules = await ctx.fns.procs.modules.discover({});
    const out = opts?.out ?? ".runtime/build/manifest.ts";
    // Import paths are relative to the generated file, from the REAL file — so
    // module files (in node_modules / outside src/) are bundled too.
    const buildDir = resolve(out, "..");
    const rel = (abs: string) => {
        const p = relative(buildDir, abs).replace(/\.ts$/, "");
        return p.startsWith(".") ? p : "./" + p;
    };

    const imports: string[] = [];
    const literals: string[] = [];
    let n = 0;
    for (const entry of entries) {
        // Types are not loaded and nothing else is imported: keep the entry so
        // the build sees the same list, just without a function.
        const runnable = entry.kind !== "type" && entry.kind !== "skip" && entry.abs.endsWith(".ts");
        let fn = "undefined";
        let mod = "undefined";
        if (runnable) {
            const local = "m" + (n++);
            imports.push(`import * as ${local} from "${rel(entry.abs)}";`);
            fn = `${local}.default`;
            mod = local;
        }
        const { fn: _drop, ...fields } = entry as any;
        literals.push(`  { ...${JSON.stringify(fields)}, fn: ${fn}, mod: ${mod} },`);
    }

    const src = `// AUTO-GENERATED build manifest - do not edit
${imports.join("\n")}

// The scan's own output, frozen. boot.apply turns it into a running process.
export const entries: any[] = [
${literals.join("\n")}
];
export const modules: any[] = ${JSON.stringify(modules, null, 2)};
export const startOrder: string[] = ${JSON.stringify(await ctx.fns.procs.lifecycle.order({}))};
`;
    await Bun.write(out, src);
    return { out, entries: entries.length, imported: n };
}
