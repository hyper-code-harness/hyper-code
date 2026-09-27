// Typecheck one eval body against the live project's declarations before it runs.
//
// hyper-code2: tsgo first. The in-process TypeScript Language Service below runs
// on the event loop and stalls every agent and request for 100–800 ms per eval;
// the tsgo language server (src/tsgo) checks out of process in a few ms. The
// in-process service stays as the fallback when tsgo is off, not installed,
// crashed or timed out — a missing tsgo must never make eval unusable.
import { join } from "node:path";

/**
 * Typechecks an eval body against the project's types before it runs.
 *
 * Uses the out-of-process tsgo language server when enabled and available
 * (non-blocking, a few ms warm); otherwise the in-process TypeScript Language
 * Service. Returns only error-severity diagnostics with lines relative to the
 * eval body.
 * @param opts.code Eval source: the body of an async function.
 * @param opts.bindings Extra named values the eval code receives; only their names matter.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Eval source: the body of an async function. */
        code: string;
        /** Extra named values the eval code receives; only their names matter. */
        bindings?: Record<string, any>;
    },
): Promise<{ ok: boolean; errors: string[]; engine?: "tsgo" | "tsserver" }> {
    const tsgo = (ctx.fns as any).tsgo;
    if (tsgo?.check) {
        let enabled = true;
        try { enabled = (await ctx.fns.settings.get({ module: "tsgo", scopeType: "global", key: "enabled" })) !== false; } catch { /* settings unavailable: keep default */ }
        if (enabled) {
            try {
                const r = await tsgo.check({ code: opts.code, bindings: opts.bindings });
                return { ok: r.ok, errors: r.errors, engine: "tsgo" };
            } catch (e: any) {
                const st = ((ctx.state as any).tsgo ??= {});
                (st.stats ??= { checks: 0, totalMs: 0, maxMs: 0, timeouts: 0, fallbacks: 0 }).fallbacks++;
                ctx.fns.procs.log.warn({ event: "repl.typecheck.fallback", msg: String(e?.message ?? e) });
            }
        }
    }
    return { ...(await inProcess(ctx, opts)), engine: "tsserver" };
}

async function inProcess(ctx: Context, opts: { code: string; bindings?: Record<string, any> }): Promise<{ ok: boolean; errors: string[] }> {
    const root = ctx.fns.procs.project.projectRoot({});
    const procs = ctx.state.procs as any;
    const state = (procs.repl ??= {});
    let holder = state.typecheck as {
        root: string; configPath: string; configMtime: number;
        service: any; ts: any; evalFile: string; source: string; version: number;
    } | undefined;
    const currentConfigPath = holder?.root === root && holder.configPath
        ? holder.configPath
        : join(root, "tsconfig.json");
    const currentConfigMtime = Bun.file(currentConfigPath).lastModified;

    if (!holder || holder.root !== root || holder.configMtime !== currentConfigMtime) {
        holder?.service?.dispose();
        const ts = await import("typescript");
        const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
        if (!configPath) return { ok: false, errors: [`typecheck: no tsconfig.json under ${root}`] };
        const config = ts.readConfigFile(configPath, ts.sys.readFile);
        if (config.error) return { ok: false, errors: [formatDiagnostic(ts, config.error, 0)] };
        const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
        const evalFile = join(root, ".hyper", "_runtime", "eval", "__virtual_eval.ts");
        holder = { root, configPath, configMtime: Bun.file(configPath).lastModified, ts, evalFile, source: "", version: 0, service: null };
        const h = holder;
        const projectFiles = parsed.fileNames.filter((file: string) => file !== evalFile);
        const host = {
            getCompilationSettings: () => parsed.options,
            getScriptFileNames: () => [...projectFiles, evalFile],
            getScriptVersion: (file: string) => file === evalFile
                ? String(h.version)
                : String(ts.sys.getModifiedTime?.(file)?.getTime() ?? 0),
            getScriptSnapshot: (file: string) => {
                if (file === evalFile) return ts.ScriptSnapshot.fromString(h.source);
                const text = ts.sys.readFile(file);
                return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
            },
            getCurrentDirectory: () => root,
            getDefaultLibFileName: (options: any) => ts.getDefaultLibFilePath(options),
            fileExists: ts.sys.fileExists,
            readFile: ts.sys.readFile,
            readDirectory: ts.sys.readDirectory,
            directoryExists: ts.sys.directoryExists,
            getDirectories: ts.sys.getDirectories,
        };
        h.service = ts.createLanguageService(host, ts.createDocumentRegistry());
        state.typecheck = holder;
    }

    const bindingParams = Object.keys(opts.bindings ?? {}).map(name => {
        if (!/^[$A-Z_a-z][$\w]*$/.test(name)) throw new TypeError(`eval: invalid binding name ${JSON.stringify(name)}`);
        return `${name}: ${name === "agent" ? "types.agent.Agent" : "any"}`;
    });
    const standardParams = [
        "ctx: Context",
        "session: Session | null",
        "console: Console",
        "print: (...args: any[]) => void",
    ];
    const headerLines = 2;
    holder.source = `export {};\nasync function __repl(${[...standardParams, ...bindingParams].join(", ")}) {\n${opts.code}\n}`;
    holder.version++;

    const syntactic = holder.service.getSyntacticDiagnostics(holder.evalFile)
        .filter((d: any) => d.category === holder.ts.DiagnosticCategory.Error);
    if (syntactic.length) {
        const errors = syntactic.map((d: any) => formatDiagnostic(holder!.ts, d, headerLines));
        return { ok: false, errors };
    }
    const errors = holder.service.getSemanticDiagnostics(holder.evalFile)
        .filter((d: any) => d.category === holder.ts.DiagnosticCategory.Error)
        .map((d: any) => formatDiagnostic(holder!.ts, d, headerLines));
    return { ok: errors.length === 0, errors };
}

function formatDiagnostic(ts: any, diagnostic: any, headerLines: number): string {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (!diagnostic.file || diagnostic.start == null) return message;
    const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return `${Math.max(1, pos.line + 1 - headerLines)}:${pos.character + 1} ${message}`;
}
