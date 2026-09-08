import { dirname, join } from "node:path";
import { mkdir, rename, rm, realpath } from "node:fs/promises";

/** Creates a documented runtime function through a validated, type-checked pipeline. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Source root: src, .hyper, plugin:<mounted-name> (official/user), or plugins/<name>/src (official). @default src */
        root?: string;
        /** Slash-separated module path, such as `gmail` or `runtime/docs`. */
        module: string;
        /** Function file and runtime name in lower camelCase. */
        name: string;
        /** One-sentence concrete action summary. */
        summary: string;
        /** Capability description, including when this function is appropriate. */
        description: string;
        /** Explicit option declarations; pass an empty array for no options. */
        params: Array<{ name: string; type: string; required: boolean; description: string; default?: string | number | boolean; minimum?: number; maximum?: number }>;
        /** Explicit TypeScript return type. */
        returnType: string;
        /** Function body without the outer function declaration. */
        body: string;
        /** Permit replacing an existing function. @default false */
        overwrite?: boolean;
        /** Generate and type-check without writing. @default false */
        dryRun?: boolean;
        /** Update the durable retrieval index after loading. @default false */
        index?: boolean;
    },
): Promise<any> {
    const root = opts.root ?? "src";
    const module = String(opts.module ?? "").trim();
    const name = String(opts.name ?? "").trim();
    assertInput(module, name, opts);
    const project = ctx.fns.procs.project.projectRoot({});
    let rootDir = join(project, root);
    if (root !== "src" && root !== ".hyper") {
        if (!/^(plugin:[a-z][a-z0-9-]*|plugins\/[a-z][a-z0-9-]*\/src)$/.test(root)) throw new TypeError("createFunction: invalid runtime root");
        const roots = await ctx.fns.procs.modules.discover({});
        const selected = roots.find(r => !r.prefix && (r.source === "official" || r.source === "user") && (root.startsWith("plugin:") ? r.name === root.slice(7) : r.source === "official" && r.dir === rootDir));
        if (!selected) throw new TypeError("createFunction: root must be a mounted official/user plugin source");
        rootDir = await realpath(selected.dir);
    }
    // Reject symlinked module directories: authoring must remain inside its selected source root.
    const canonicalRoot = await realpath(rootDir).catch(() => rootDir);
    for (let dir = join(rootDir, module); dir !== rootDir; dir = dirname(dir)) {
        const actual = await realpath(dir).catch(() => null);
        if (actual && actual !== join(canonicalRoot, dir.slice(rootDir.length + 1))) throw new TypeError("createFunction: module escapes source root through symlink");
    }
    const rel = `${root}/${module}/${name}.ts`;
    const path = join(rootDir, module, `${name}.ts`);
    const source = render(opts);
    const syntax = new Bun.Transpiler({ loader: "ts" }).scan(source);
    void syntax;
    if (opts.dryRun) return { ok: true, name: `${module.replaceAll("/", ".")}.${name}`, path: rel, source, written: false };
    if (await Bun.file(path).exists() && !opts.overwrite) throw new Error(`createFunction: ${rel} already exists; use edit for updates or pass overwrite explicitly`);
    const previous = await Bun.file(path).exists() ? await Bun.file(path).text() : null;
    // Staging lives under host src so the host tsconfig also checks user-plugin functions.
    const temp = join(project, "src", ".authoring", module, `${name}.${crypto.randomUUID()}.ts`);
    await mkdir(dirname(temp), { recursive: true });
    await Bun.write(temp, source);
    const filter = temp.startsWith(project + "/") ? temp.slice(project.length + 1) : temp;
    const preflight = await ctx.fns.procs.dev.typecheck({ filter });
    if (!preflight.ok) { await rm(temp, { force: true }); throw new Error(`createFunction typecheck failed:\n${preflight.errors.join("\n")}`); }
    await mkdir(dirname(path), { recursive: true });
    try {
        await rename(temp, path);
        await ctx.fns.procs.dev.genTypes({});
        const runtimeName = `${module.replaceAll("/", ".")}.${name}`;
        await ctx.fns.procs.repl.load({ name: runtimeName });
        const validation = await ctx.fns.runtime.docs.validate({ name: runtimeName, strict: true, typecheck: true });
        if (!validation.ok) throw new Error(`createFunction validation failed: ${JSON.stringify(validation.errors)}`);
        const index = opts.index ? await ctx.fns.runtime.docs.index({ localizationBatch: 1 }) : null;
        return { ok: true, name: runtimeName, path: rel, created: previous == null, typecheck: preflight, validation, index };
    } catch (error) {
        if (previous == null) await rm(path, { force: true }); else await Bun.write(path, previous);
        await ctx.fns.procs.dev.genTypes({});
        throw error;
    } finally { await rm(temp, { force: true }); }
}

function assertInput(module: string, name: string, opts: any): void {
    if (!/^[a-z][A-Za-z0-9]*(\/[a-z][A-Za-z0-9]*)*$/.test(module)) throw new TypeError("createFunction: module must be a safe slash-separated identifier");
    if (!/^[a-z][A-Za-z0-9]*$/.test(name)) throw new TypeError("createFunction: name must be lower camelCase");
    if (String(opts.summary ?? "").trim().length < 12) throw new TypeError("createFunction: summary must be concrete and at least 12 characters");
    if (String(opts.description ?? "").trim().length < 24) throw new TypeError("createFunction: description must explain the capability");
    if (!Array.isArray(opts.params)) throw new TypeError("createFunction: params must be explicit, including []");
    if (!String(opts.returnType ?? "").trim() || !String(opts.body ?? "").trim()) throw new TypeError("createFunction: returnType and body are required");
    const seen = new Set<string>();
    for (const param of opts.params) {
        if (!/^[$A-Z_a-z][$\w]*$/.test(param.name) || seen.has(param.name)) throw new TypeError(`createFunction: invalid or duplicate parameter ${param.name}`);
        seen.add(param.name);
        if (!param.type || String(param.description ?? "").trim().length < 8 || typeof param.required !== "boolean") throw new TypeError(`createFunction: parameter ${param.name} requires type, required, and description`);
    }
}

function render(opts: any): string {
    const tags = opts.params.map((p: any) => ` * @param opts.${p.name} ${p.description}${p.default !== undefined ? ` @default ${p.default}` : ""}${p.minimum !== undefined ? ` @minimum ${p.minimum}` : ""}${p.maximum !== undefined ? ` @maximum ${p.maximum}` : ""}`);
    const fields = opts.params.map((p: any) => `        /** ${p.description}${p.default !== undefined ? ` @default ${p.default}` : ""}${p.minimum !== undefined ? ` @minimum ${p.minimum}` : ""}${p.maximum !== undefined ? ` @maximum ${p.maximum}` : ""} */\n        ${p.name}${p.required ? "" : "?"}: ${p.type};`).join("\n");
    const optsType = fields ? `{\n${fields}\n    }` : "{}";
    const body = String(opts.body).trim().split("\n").map((line: string) => `    ${line}`).join("\n");
    return `/**\n * ${String(opts.summary).trim()}\n *\n * ${String(opts.description).trim()}\n${tags.join("\n")}${tags.length ? "\n" : ""} */\nexport default async function (\n    ctx: Context,\n    session: Session | null,\n    opts: ${optsType},\n): ${String(opts.returnType).trim()} {\n${body}\n}\n`;
}
