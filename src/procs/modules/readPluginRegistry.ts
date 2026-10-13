import { resolve } from "node:path";
import { realpath, readFile, stat } from "node:fs/promises";
// Bootstrap exception: discovery precedes ctx.fns registration.
import workdir, { expandHome } from "../project/workdir";

/**
 * Validate the opt-in workspace plugin path registry and reject live composition changes.
 *
 * Bootstrap-safe reader for workspace.json pluginRegistry. Absent keeps legacy discovery; an explicit ordered path allowlist requires restart when changed. Does not import plugins, fetch dependencies, or modify configuration.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{ version: 1; entries: Array<{ path: string; enabled: boolean; dir: string }> } | null> {
    const base = workdir(ctx, session, {});
    let workspace: Record<string, unknown> = {};
    let text = "";
    try {
        text = await readFile(resolve(base, "workspace.json"), "utf8");
        workspace = JSON.parse(text);
    } catch (error) {
        // Match legacy readDeclared's tolerant parsing unless a registry is
        // visible or this process has already opted in (then fail closed).
        const prior = (ctx.state as any).procs?.pluginRegistryFingerprint;
        if (text.includes("pluginRegistry") || (prior !== undefined && prior !== "null")) throw new Error("Invalid workspace.json for plugin registry", { cause: error });
    }
    const value = workspace?.pluginRegistry;
    const state = ((ctx.state as any).procs ??= {});
    const fingerprint = JSON.stringify(value === undefined ? null : value);
    const previous = state.pluginRegistryFingerprint ?? (state.boot?.entries ? "null" : undefined);
    if (previous !== undefined && previous !== fingerprint) throw new Error("pluginRegistry changed: restart required; live plugin switching is not supported");
    if (value === undefined) {
        state.pluginRegistryFingerprint = fingerprint;
        return null;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("pluginRegistry must be an object");
    const registry = value as Record<string, unknown>;
    if (Object.keys(registry).some(key => !["version", "entries"].includes(key)) || registry.version !== 1 || !Array.isArray(registry.entries)) throw new Error("pluginRegistry requires version: 1 and entries: [{path, enabled}]");
    const entries: Array<{ path: string; enabled: boolean; dir: string }> = [];
    for (const item of registry.entries) {
        if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => !["path", "enabled"].includes(key)) || typeof item.path !== "string" || !item.path.trim() || typeof item.enabled !== "boolean" || item.path.includes("*")) throw new Error("pluginRegistry entries require a concrete path and explicit boolean enabled only");
        const absolute = resolve(base, expandHome(item.path));
        let dir: string;
        try {
            dir = await realpath(absolute);
            if (!(await stat(dir)).isDirectory()) throw new Error("not a directory");
        } catch (error) {
            if (item.enabled || (error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Invalid pluginRegistry path: ${item.path}`, { cause: error });
            dir = absolute;
        }
        const prior = entries.find(entry => entry.dir === dir);
        if (prior && prior.enabled !== item.enabled) throw new Error(`Conflicting pluginRegistry entries for ${dir}`);
        if (!prior) entries.push({ path: item.path, enabled: item.enabled, dir });
    }
    const resolved = JSON.stringify(entries.map(({ dir, enabled }) => ({ dir, enabled })));
    if (state.pluginRegistryResolved !== undefined && state.pluginRegistryResolved !== resolved) throw new Error("pluginRegistry paths changed: restart required");
    if (state.boot?.baked?.length) throw new Error("pluginRegistry is not supported with baked production entries");
    state.pluginRegistryFingerprint = fingerprint;
    state.pluginRegistryResolved = resolved;
    return { version: 1, entries };
}
